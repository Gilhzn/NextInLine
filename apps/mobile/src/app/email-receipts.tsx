import { useState } from "react";
import { Platform, Share, Text, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import { router } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { InboxDto } from "@magiali/shared";
import { api, errorMessage } from "../api/client";
import { confirm } from "../lib/confirm";
import { colors, radius, space, type } from "../theme";
import { Body, Button, Card, ErrorView, Loading, Row, Screen, Title } from "../ui";

const STATUS: Record<InboxDto["recent"][number]["status"], string> = {
  processed: "נקלט",
  no_attachments: "בלי קבלה מצורפת",
  rejected: "לא נקלט",
};

/**
 * The family's private email address for receipts: forward any receipt that arrived by email, or give the address
 * to a clinic or therapist so their receipts arrive by themselves. Every attachment becomes a receipt to confirm.
 */
export default function EmailReceipts() {
  const qc = useQueryClient();
  const inbox = useQuery({ queryKey: ["inbox"], queryFn: () => api<InboxDto>("GET", "/v1/inbox") });
  const [copied, setCopied] = useState(false);
  const [message, setMessage] = useState<string>();

  if (inbox.isLoading) return <Loading />;
  if (inbox.error || !inbox.data) return <Screen><ErrorView message={errorMessage(inbox.error)} onRetry={() => void inbox.refetch()} /></Screen>;
  const { address, recent } = inbox.data;

  async function copy() {
    if (!address) return;
    await Clipboard.setStringAsync(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function rotate() {
    const ok = await confirm("כתובת חדשה", "הכתובת הנוכחית תפסיק לעבוד מיד. מי שקיבל אותה (למשל קליניקה) יצטרך את החדשה.");
    if (!ok) return;
    try {
      qc.setQueryData(["inbox"], await api<InboxDto>("POST", "/v1/inbox/rotate"));
    } catch (e) {
      setMessage(errorMessage(e));
    }
  }

  return (
    <Screen>
      <Title sub="כל קבלה שמגיעה לכתובת הזו נכנסת לאפליקציה לבד">קבלות במייל</Title>

      {!address ? (
        <Card tone="warning">
          <Body>קבלות במייל עוד לא זמינות. בינתיים אפשר לשמור את הקבלה מהמייל ולהעלות אותה במסך הצילום.</Body>
          <Button title="להעלאת קבלה" icon="📷" onPress={() => router.push("/capture")} />
        </Card>
      ) : (
        <>
          <Card tone="primary">
            <Text style={{ fontSize: type.small, color: colors.muted }}>הכתובת האישית שלכם</Text>
            <Text selectable style={addressStyle} accessibilityLabel={`הכתובת האישית שלכם ${address}`}>
              {address}
            </Text>
            <Row>
              <Button title={copied ? "הועתק ✓" : "העתקה"} icon="📋" onPress={() => void copy()} />
              {Platform.OS !== "web" ? (
                <Button title="שיתוף" icon="📤" variant="secondary" onPress={() => void Share.share({ message: address })} />
              ) : null}
            </Row>
          </Card>

          <Card>
            <Body style={{ fontWeight: "700" }}>איך משתמשים</Body>
            <Body>1. קיבלתם קבלה במייל? לחצו "העבר" ושלחו אותה לכתובת הזו.</Body>
            <Body>2. אפשר לתת את הכתובת לקליניקה, למטפל או למכון – והקבלות יגיעו ישר לכאן.</Body>
            <Body>3. אנחנו קוראים את הקבלה, ואתם רק מאשרים את הפרטים ב"מה עושים עכשיו".</Body>
            <Body muted>אנחנו שומרים רק את הקבצים המצורפים (PDF או תמונה) ואת כתובת השולח. תוכן המייל לא נשמר.</Body>
          </Card>

          <Card>
            <Body style={{ fontWeight: "700" }}>מה הגיע לאחרונה</Body>
            {recent.length === 0 ? <Body muted>עוד לא הגיעו מיילים.</Body> : null}
            {recent.map((r, i) => (
              <View key={i} style={{ paddingVertical: space.xs, borderTopWidth: i ? 1 : 0, borderTopColor: colors.border }}>
                <Body>
                  {new Date(r.receivedAt).toLocaleDateString("he-IL")} · {r.from ?? "שולח לא ידוע"}
                </Body>
                <Text style={{ fontSize: type.caption, color: r.status === "processed" ? colors.money : colors.warning }}>
                  {STATUS[r.status]}
                  {r.receipts ? ` – ${r.receipts === 1 ? "קבלה אחת" : `${r.receipts} קבלות`}` : ""}
                </Text>
              </View>
            ))}
          </Card>

          <Button title="החלפת הכתובת" variant="ghost" onPress={() => void rotate()} />
        </>
      )}
      {message ? <Body style={{ color: colors.danger }}>{message}</Body> : null}
    </Screen>
  );
}

const addressStyle = {
  fontSize: type.small,
  fontWeight: "800" as const,
  color: colors.text,
  backgroundColor: colors.surface,
  borderRadius: radius,
  padding: space.md,
  marginVertical: space.sm,
  textAlign: "center" as const,
  writingDirection: "ltr" as const,
};
