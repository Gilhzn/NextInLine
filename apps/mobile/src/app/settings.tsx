import { useState } from "react";
import { Alert, Platform } from "react-native";
import { router } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import { api, errorMessage } from "../api/client";
import { keys, useMe } from "../api/hooks";
import { useAuth } from "../state/auth";
import { colors, space } from "../theme";
import { Body, Button, Card, Loading, Screen, Spread, Title } from "../ui";
import { PaymentMethodForm } from "../ui/PaymentMethodForm";

function confirm(title: string, message: string): Promise<boolean> {
  if (Platform.OS === "web") return Promise.resolve(globalThis.confirm?.(`${title}\n\n${message}`) ?? false);
  return new Promise((resolve) =>
    Alert.alert(title, message, [
      { text: "ביטול", style: "cancel", onPress: () => resolve(false) },
      { text: "כן, למחוק", style: "destructive", onPress: () => resolve(true) },
    ]),
  );
}

export default function Settings() {
  const me = useMe();
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
    const ok = await confirm("מחיקת החשבון", "כל המידע והקבלות יימחקו. תביעות פתוחות יבוטלו. אי אפשר לבטל את הפעולה.");
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
        {me.data.hasPaymentMethod ? <Body>✓ שמור</Body> : <PaymentMethodForm onSaved={() => void qc.invalidateQueries({ queryKey: keys.me })} />}
      </Card>

      <Card>
        <Body style={{ fontWeight: "700" }}>🔒 הסכמות</Body>
        <Spread>
          <Body>תנאי שימוש ופרטיות</Body>
          <Body>{consents.has("terms") ? "✓" : "—"}</Body>
        </Spread>
        <Spread>
          <Body>ייפוי כוח להגשה ומעקב</Body>
          <Body>{consents.has("poa") ? "✓" : "—"}</Body>
        </Spread>
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
