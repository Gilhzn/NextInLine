import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { router } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import { FEE_POLICY } from "@magiali/shared";
import { api, errorMessage } from "../../api/client";
import { keys, useMe, useSetOnboardingStep } from "../../api/hooks";
import { colors, radius, space, type } from "../../theme";
import { Body, Button, Card, Screen, Title } from "../../ui";
import { PaymentMethodForm } from "../../ui/PaymentMethodForm";

const TERMS_VERSION = "1.0";

function Check({ checked, onToggle, children }: { checked: boolean; onToggle: () => void; children: React.ReactNode }) {
  return (
    <Pressable onPress={onToggle} accessibilityRole="checkbox" accessibilityState={{ checked }} style={{ flexDirection: "row", gap: space.md, alignItems: "flex-start", paddingVertical: space.sm }}>
      <View
        style={{
          width: 26,
          height: 26,
          borderRadius: 6,
          borderWidth: 2,
          borderColor: checked ? colors.primary : colors.border,
          backgroundColor: checked ? colors.primary : colors.surface,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {checked ? <Text style={{ color: "#fff", fontWeight: "800" }}>✓</Text> : null}
      </View>
      <View style={{ flex: 1 }}>{children}</View>
    </Pressable>
  );
}

export default function Agreements() {
  const me = useMe();
  const setStep = useSetOnboardingStep();
  const qc = useQueryClient();
  const [terms, setTerms] = useState(false);
  const [poa, setPoa] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();

  async function finish() {
    setSaving(true);
    setError(undefined);
    try {
      await api("POST", "/v1/consents", { kind: "terms", version: TERMS_VERSION });
      await api("POST", "/v1/consents", { kind: "privacy", version: TERMS_VERSION });
      if (poa) await api("POST", "/v1/consents", { kind: "poa", version: TERMS_VERSION });
      await qc.invalidateQueries({ queryKey: keys.me });
      await setStep.mutateAsync("done");
      router.replace("/home");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Screen footer={<Button title="סיימנו, בוא נתחיל" onPress={finish} loading={saving} disabled={!terms} />}>
      <Title sub="שלושה דברים קצרים, ואז מתחילים">כמעט סיימנו</Title>

      <Card>
        <Check checked={terms} onToggle={() => setTerms((v) => !v)}>
          <Body>קראתי ואני מסכים/ה לתנאי השימוש ולמדיניות הפרטיות</Body>
          <Body muted>המידע הרפואי שלך מוצפן, משמש רק להגשת ההחזרים, ואפשר למחוק אותו בכל רגע.</Body>
        </Check>
      </Card>

      <Card>
        <Check checked={poa} onToggle={() => setPoa((v) => !v)}>
          <Body>ייפוי כוח מצומצם להגשה ומעקב</Body>
          <Body muted>
            מאשר/ת ל״מגיע לי״ להגיש בשמי בקשות החזר ולקבל עדכוני סטטוס. ייפוי הכוח לא מאפשר לקבל כסף בשמי ולא לערער בשמי. אפשר לבטל בכל רגע.
          </Body>
        </Check>
      </Card>

      <Card tone="primary">
        <Text style={{ fontSize: type.body, fontWeight: "700", color: colors.text }}>💳 אמצעי תשלום לעמלה</Text>
        <Body>
          לא נחייב עכשיו. העמלה היא {FEE_POLICY.standardRateBps / 100}% מההחזר (עד {FEE_POLICY.capAgorot / 100} ₪ לתביעה), ונגבית רק אחרי שהכסף הגיע אליך.
        </Body>
        {me.data?.hasPaymentMethod ? (
          <View style={{ backgroundColor: colors.surface, borderRadius: radius, padding: space.md }}>
            <Body>✓ אמצעי תשלום נשמר</Body>
          </View>
        ) : (
          <PaymentMethodForm returnTo="/agreements" onSaved={() => void qc.invalidateQueries({ queryKey: keys.me })} />
        )}
      </Card>
      {error ? <Body style={{ color: colors.danger }}>{error}</Body> : null}
    </Screen>
  );
}
