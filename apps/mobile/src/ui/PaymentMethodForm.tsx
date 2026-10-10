import { useState } from "react";
import { View } from "react-native";
import { api, errorMessage } from "../api/client";
import { space } from "../theme";
import { Body, Button, Field } from ".";

/**
 * Development stand-in for the payment provider's hosted card fields.
 * In production the PSP SDK tokenizes the card on-device and only the token reaches our server.
 */
export function PaymentMethodForm({ onSaved }: { onSaved: () => void }) {
  const [card, setCard] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const digits = card.replace(/\D/g, "");

  async function save() {
    setSaving(true);
    setError(undefined);
    try {
      await api("POST", "/v1/payment-methods", {
        provider: "mock",
        token: `tok_dev_${digits.slice(-4)}_${Date.now()}`,
        brand: "card",
        last4: digits.slice(-4),
      });
      setCard("");
      onSaved();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <View style={{ gap: space.xs }}>
      <Field label="מספר כרטיס (סביבת פיתוח)" value={card} onChangeText={setCard} keyboardType="number-pad" placeholder="4580 0000 0000 0000" error={error} />
      <Button title="שמירת אמצעי תשלום" variant="secondary" onPress={save} loading={saving} disabled={digits.length < 12} />
      <Body muted>בגרסת הייצור: Apple Pay / Google Pay / Bit / כרטיס דרך ספק סליקה מאובטח.</Body>
    </View>
  );
}
