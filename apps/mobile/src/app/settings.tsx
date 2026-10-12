import { useState } from "react";
import { Switch } from "react-native";
import { router } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import { CATEGORY_INFO, formatILS, type FeeDto } from "@magiali/shared";
import { api, errorMessage } from "../api/client";
import { keys, useClaims, useFees, useMe } from "../api/hooks";
import { useAuth } from "../state/auth";
import { colors, space } from "../theme";
import { Badge, Body, Button, Card, Loading, Screen, Spread, Title } from "../ui";
import { PaymentMethodForm } from "../ui/PaymentMethodForm";
import { CONSENT_COPY, useConsents } from "../ui/Consents";
import { confirm } from "../lib/confirm";
import { openLegal } from "../lib/legal";
import { useQuery } from "@tanstack/react-query";

const FEE_STATUS: Record<FeeDto["status"], { label: string; tone: "primary" | "money" | "warning" | "danger" | "muted" }> = {
  pending: { label: "ממתינה", tone: "muted" },
  scheduled: { label: "מתוזמנת", tone: "primary" },
  charged: { label: "חויבה", tone: "money" },
  disputed: { label: "בבירור", tone: "warning" },
  waived: { label: "בוטלה", tone: "muted" },
  failed: { label: "החיוב נכשל", tone: "danger" },
  refunded: { label: "הוחזרה", tone: "muted" },
};

export default function Settings() {
  const me = useMe();
  const fees = useFees();
  const consentActions = useConsents();
  const legal = useQuery({
    queryKey: ["legal"],
    queryFn: () => api<{ dpoEmail: string | null; contactEmail: string | null }>("GET", "/v1/legal"),
    staleTime: 3_600_000,
  });
  const claims = useClaims();
  const qc = useQueryClient();
  const { refreshToken, signOut } = useAuth();
  const [message, setMessage] = useState<string>();

  async function logout() {
    if (refreshToken) await api("POST", "/v1/auth/logout", { refreshToken }).catch(() => {});
    await signOut();
    router.replace("/welcome");
  }

  async function exportData() {
    try {
      const data = await api<Record<string, unknown[]>>("GET", "/v1/privacy/export");
      const counts = Object.entries(data)
        .filter(([, v]) => Array.isArray(v))
        .map(([k, v]) => `${k}: ${(v as unknown[]).length}`)
        .join(" · ");
      setMessage(`הייצוא מוכן (${counts}). בגרסת הייצור הקובץ נשלח למייל שלך.`);
    } catch (e) {
      setMessage(errorMessage(e));
    }
  }

  async function deleteAccount() {
    const ok = await confirm("מחיקת החשבון", "כל המידע והקבלות יימחקו. תביעות פתוחות יבוטלו. אי אפשר לבטל את הפעולה.", "כן, למחוק");
    if (!ok) return;
    try {
      await api("DELETE", "/v1/me");
      await signOut();
      router.replace("/welcome");
    } catch (e) {
      setMessage(errorMessage(e));
    }
  }

  if (!me.data) return <Loading />;
  const consents = new Set(me.data.consents.map((c) => c.kind));

  return (
    <Screen>
      <Title sub={me.data.user.phone}>{me.data.user.displayName ?? "החשבון שלי"}</Title>

      <Card>
        <Body style={{ fontWeight: "700" }}>💳 אמצעי תשלום</Body>
        {me.data.hasPaymentMethod ? <Body>✓ שמור</Body> : <PaymentMethodForm returnTo="/settings" onSaved={() => void qc.invalidateQueries({ queryKey: keys.me })} />}
      </Card>

      <Card>
        <Body style={{ fontWeight: "700" }}>🧾 עמלות הצלחה</Body>
        <Body muted>משלמים רק על כסף שהגיע לחשבון: 15% (20% בתביעה רטרו), עד 150 ₪ לתביעה. החיוב 3 ימים אחרי התשלום.</Body>
        {fees.data?.length === 0 ? <Body muted>עדיין אין עמלות.</Body> : null}
        {fees.data?.map((f) => {
          const claim = claims.data?.find((c) => c.id === f.claimId);
          const st = FEE_STATUS[f.status];
          const date = f.chargedAt ?? f.scheduledFor;
          return (
            <Spread key={f.id} style={{ paddingVertical: space.sm, borderTopWidth: 1, borderTopColor: colors.border }}>
              <Body style={{ flex: 1 }}>
                {claim ? `${CATEGORY_INFO[claim.category].icon} ${claim.providerName ?? CATEGORY_INFO[claim.category].label}` : "תביעה"}
                {date ? ` · ${new Date(date).toLocaleDateString("he-IL")}` : ""}
              </Body>
              <Body style={{ fontWeight: "700" }}>{formatILS(f.amountAgorot)}</Body>
              <Badge label={st.label} tone={st.tone} />
            </Spread>
          );
        })}
      </Card>

      <Card>
        <Body style={{ fontWeight: "700" }}>📥 איך מידע נכנס לאפליקציה</Body>
        <Button title="קבלות במייל – הכתובת שלכם" icon="📧" variant="ghost" onPress={() => router.push("/email-receipts")} />
        <Button title="חיבור בנק וכרטיסי אשראי" icon="🏦" variant="ghost" onPress={() => router.push("/connect-bank")} />
        <Button title="ייבוא מהר הביטוח" icon="📥" variant="ghost" onPress={() => router.push("/import")} />
      </Card>

      <Card>
        <Body style={{ fontWeight: "700" }}>🔒 הסכמות</Body>
        <Body muted>כל הסכמה עומדת בפני עצמה. ביטול חל מעכשיו והלאה.</Body>
        {(["medical_data", "ai_processing", "financial_data", "poa", "marketing"] as const).map((kind) => (
          <Spread key={kind} style={{ paddingVertical: space.xs }}>
            <Body style={{ flex: 1 }}>{CONSENT_COPY[kind].label}</Body>
            <Switch
              value={consents.has(kind)}
              accessibilityLabel={CONSENT_COPY[kind].label}
              trackColor={{ true: colors.primary, false: colors.border }}
              onValueChange={(on) =>
                void (on ? consentActions.grant([kind]) : consentActions.revoke(kind)).catch((e) => setMessage(errorMessage(e)))
              }
            />
          </Spread>
        ))}
        <Body muted>תנאי השימוש ומדיניות הפרטיות: {consents.has("terms") ? "✓ אושרו" : "—"}</Body>
      </Card>

      <Card>
        <Body style={{ fontWeight: "700" }}>📄 מסמכים ופרטיות</Body>
        <Button title="תנאי שימוש" variant="ghost" onPress={() => openLegal("terms")} />
        <Button title="מדיניות פרטיות" variant="ghost" onPress={() => openLegal("privacy")} />
        <Button title="ייפוי הכוח" variant="ghost" onPress={() => openLegal("poa")} />
        <Button title="הצהרת נגישות" variant="ghost" onPress={() => openLegal("accessibility")} />
        {legal.data?.dpoEmail ? <Body muted>הממונה על הגנת הפרטיות: {legal.data.dpoEmail}</Body> : null}
        {legal.data?.contactEmail ? <Body muted>פניות ובקשות לתיקון מידע: {legal.data.contactEmail}</Body> : null}
      </Card>

      <Card>
        <Body style={{ fontWeight: "700" }}>המידע שלי</Body>
        <Button title="ייצוא כל המידע" variant="secondary" onPress={exportData} />
        <Button title="מחיקת החשבון" variant="danger" onPress={deleteAccount} />
      </Card>

      {message ? <Body style={{ color: colors.muted, marginBottom: space.md }}>{message}</Body> : null}
      <Button title="התנתקות" variant="ghost" onPress={logout} />
    </Screen>
  );
}
