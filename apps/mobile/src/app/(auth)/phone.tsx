import { useState } from "react";
import { router } from "expo-router";
import { normalizeIsraeliMobile } from "@magiali/shared";
import { api, errorMessage } from "../../api/client";
import { Body, Button, Field, Screen, Title } from "../../ui";

export default function Phone() {
  const [phone, setPhone] = useState("");
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);
  const valid = normalizeIsraeliMobile(phone) !== null;

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
      <Body muted>בהמשך נבקש הסכמה לתנאי השימוש ולמדיניות הפרטיות.</Body>
    </Screen>
  );
}
