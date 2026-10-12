import { useState } from "react";
import { Text, View } from "react-native";
import { router } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { BankConnectionDto } from "@magiali/shared";
import { api, errorMessage } from "../api/client";
import { usePublicConfig } from "../api/hooks";
import { confirm } from "../lib/confirm";
import { connectBank } from "../lib/open-banking";
import { colors, space, type } from "../theme";
import { Badge, Body, Button, Card, ErrorView, Loading, Row, Screen, Spread, Title } from "../ui";
import { ConsentChecklist, useConsents } from "../ui/Consents";

const STATUS: Record<BankConnectionDto["status"], { label: string; tone: "money" | "warning" | "muted" | "danger" }> = {
  active: { label: "מחובר", tone: "money" },
  pending: { label: "ממתין לאישור", tone: "warning" },
  expired: { label: "פג – צריך לחדש", tone: "danger" },
  revoked: { label: "נותק", tone: "muted" },
  failed: { label: "לא הושלם", tone: "muted" },
};

/**
 * Connect banks and credit cards once (read-only, through a licensed financial-information provider). From then on
 * every payment to a doctor, clinic or therapist without a receipt shows up by itself – no statements to download.
 */
export default function ConnectBank() {
  const qc = useQueryClient();
  const config = usePublicConfig();
  const consents = useConsents();
  const connections = useQuery({ queryKey: ["bank-connections"], queryFn: () => api<BankConnectionDto[]>("GET", "/v1/bank-connections") });
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string>();

  if (config.isLoading || connections.isLoading) return <Loading />;
  if (connections.error) return <Screen><ErrorView message={errorMessage(connections.error)} onRetry={() => void connections.refetch()} /></Screen>;

  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: ["bank-connections"] });
    await qc.invalidateQueries({ queryKey: ["money"] });
  };

  async function connect() {
    setBusy("connect");
    setMessage(undefined);
    try {
      const res = await connectBank();
      if (res.status === "cancelled") setMessage("החיבור לא הושלם. אפשר לנסות שוב בכל רגע.");
      await refresh();
    } catch (e) {
      setMessage(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  async function act(id: string, action: "sync" | "disconnect") {
    if (action === "disconnect" && !(await confirm("ניתוק", "נפסיק לקרוא תשלומים מהחשבונות והכרטיסים האלה. תשלומים שכבר מצאנו יישארו ברשימה.", "ניתוק"))) return;
    setBusy(id);
    setMessage(undefined);
    try {
      if (action === "sync") await api("POST", `/v1/bank-connections/${id}/sync`);
      else await api("DELETE", `/v1/bank-connections/${id}`);
      await refresh();
    } catch (e) {
      setMessage(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  const list = connections.data ?? [];
  const active = list.filter((c) => c.status === "active");

  return (
    <Screen>
      <Title sub="פעם אחת, ומאז כל תשלום לרופא או לטיפול בלי קבלה מופיע לבד">חיבור בנק וכרטיסי אשראי</Title>

      {!config.data?.openBanking ? (
        <Card tone="warning">
          <Body style={{ fontWeight: "700" }}>בקרוב</Body>
          <Body>אנחנו בתהליך חיבור לנותן שירות מידע פיננסי מורשה. עד אז אפשר להעלות את פירוט האשראי בעצמכם – זה לוקח דקה.</Body>
          <Button title="סריקת פירוט האשראי" icon="💳" onPress={() => router.push("/scan-card")} />
        </Card>
      ) : (
        <>
          <Card>
            <Body style={{ fontWeight: "700" }}>איך זה עובד</Body>
            <Body>1. בוחרים בנקים וכרטיסים ומאשרים קריאה בלבד, באתר של נותן שירות מידע פיננסי מורשה.</Body>
            <Body>2. פעם ביום אנחנו מחפשים תשלומים לרופאים, מכונים ומטפלים שאין עליהם קבלה.</Body>
            <Body>3. מה שנמצא מופיע תחת "פספסנו" – מבקשים קבלה מהמטפל ומגישים.</Body>
          </Card>
          <Card tone="primary">
            <Body>🔒 קריאה בלבד – אי אפשר להעביר כסף. אנחנו לא רואים סיסמאות. נשמרים רק תשלומים רפואיים; כל שאר העסקאות נמחקות מיד. אפשר לנתק בכל רגע.</Body>
          </Card>

          {consents.granted.has("financial_data") ? (
            <Button title={active.length ? "חיבור חשבון או כרטיס נוסף" : "חיבור בנק או כרטיס אשראי"} icon="🏦" onPress={() => void connect()} loading={busy === "connect"} />
          ) : (
            <Card>
              <ConsentChecklist kinds={["financial_data"]} required={["financial_data"]} submitTitle="מאשר/ת, נמשיך לחיבור" onDone={() => void connect()} />
            </Card>
          )}
        </>
      )}

      {list.map((c) => (
        <Card key={c.id}>
          <Spread>
            <Text style={{ fontSize: type.body, fontWeight: "700", color: colors.text, flex: 1 }}>{c.institutions.join(", ") || "חיבור"}</Text>
            <Badge label={STATUS[c.status].label} tone={STATUS[c.status].tone} />
          </Spread>
          <Body muted>
            {c.lastSyncedAt ? `נבדק לאחרונה ${new Date(c.lastSyncedAt).toLocaleDateString("he-IL")}` : "עוד לא נבדק"}
            {c.leadsFound ? ` · נמצאו ${c.leadsFound} תשלומים רפואיים` : ""}
          </Body>
          {c.status === "active" ? (
            <Row>
              <Button title="בדיקה עכשיו" variant="secondary" loading={busy === c.id} onPress={() => void act(c.id, "sync")} />
              <Button title="ניתוק" variant="ghost" onPress={() => void act(c.id, "disconnect")} />
            </Row>
          ) : null}
          {c.status === "expired" ? <Button title="חידוש החיבור" onPress={() => void connect()} /> : null}
        </Card>
      ))}

      {active.length ? (
        <View style={{ marginTop: space.sm }}>
          <Button title="לתשלומים שמצאנו" icon="🟠" variant="secondary" onPress={() => router.push({ pathname: "/money", params: { bucket: "missed" } })} />
        </View>
      ) : null}
      {message ? <Body style={{ color: colors.danger }}>{message}</Body> : null}
    </Screen>
  );
}
