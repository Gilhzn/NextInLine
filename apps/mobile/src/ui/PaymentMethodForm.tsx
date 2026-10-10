import { useState } from "react";
import { View } from "react-native";
import { errorMessage } from "../api/client";
import { saveCardWithProvider } from "../lib/payments";
import { space } from "../theme";
import { Body, Button } from ".";

/**
 * Saving a card for the success fee. The card is typed on the payment provider's secure page (Cardcom);
 * we only receive a token. Nothing is charged now.
 */
export function PaymentMethodForm({ onSaved, returnTo }: { onSaved: () => void; returnTo: string }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();

  async function start() {
    setBusy(true);
    setMessage(undefined);
    try {
      const res = await saveCardWithProvider(returnTo);
      if (res.status === "completed") onSaved();
      else if (res.status === "failed") setMessage("הכרטיס לא אושר. נסה כרטיס אחר.");
      else if (res.status === "cancelled") setMessage("לא נשמר כרטיס. אפשר לנסות שוב.");
    } catch (e) {
      setMessage(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={{ gap: space.xs }}>
      <Button title="הוספת כרטיס אשראי" icon="💳" variant="secondary" onPress={start} loading={busy} />
      <Body muted>🔒 הכרטיס מוזן בדף המאובטח של חברת הסליקה. לא יבוצע חיוב עכשיו.</Body>
      {message ? <Body>{message}</Body> : null}
    </View>
  );
}
