import { useState } from "react";
import { router } from "expo-router";
import { normalizeIsraeliMobile } from "@magiali/shared";
import { api, errorMessage } from "../../api/client";
import { usePublicConfig } from "../../api/hooks";
import { Body, Button, Card, Field, Screen, Title } from "../../ui";

export default function Phone() {
  const [phone, setPhone] = useState("");
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);
  const valid = normalizeIsraeliMobile(phone) !== null;
  const demo = usePublicConfig().data;

  async function send() {
    setError(undefined);
    setLoading(true);
    try {
      await api("POST", "/v1/auth/otp/request", { phone });
      router.push({ pathname: "/otp", params: { phone } });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Screen footer={<Button title="שלחו לי קוד" onPress={send} loading={loading} disabled={!valid} />}>
      <Title sub="נשלח קוד חד-פעמי ב-SMS. בלי סיסמאות.">מה מספר הנייד שלך?</Title>
      <Field
        label="מספר נייד"
        value={phone}
        onChangeText={setPhone}
        keyboardType="phone-pad"
        textContentType="telephoneNumber"
        autoComplete="tel"
        placeholder="050-0000000"
        autoFocus
        error={error}
      />
      {demo?.demoMode ? (
        <Card tone="primary">
          <Body>🧪 סביבת הדגמה: אפשר להזין כל מספר נייד ישראלי (למשל 050-1234567). לא יישלח SMS.</Body>
        </Card>
      ) : null}
      <Body muted>בהמשך נבקש הסכמה לתנאי השימוש ולמדיניות הפרטיות.</Body>
    </Screen>
  );
}
