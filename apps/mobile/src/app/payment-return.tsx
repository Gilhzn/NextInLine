import { useEffect, useState } from "react";
import { Platform } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import { errorMessage } from "../api/client";
import { keys } from "../api/hooks";
import { takeWebReturnPath, waitForCardSetup } from "../lib/payments";
import { Body, Button, Card, Loading, Screen, Title } from "../ui";

/** Landing page after the payment provider's hosted page (web, or a native deep link the browser session missed). */
export default function PaymentReturn() {
  const { setup } = useLocalSearchParams<{ setup?: string }>();
  const qc = useQueryClient();
  const [state, setState] = useState<"checking" | "completed" | "failed" | "error">("checking");
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!setup) {
      setState("error");
      return;
    }
    waitForCardSetup(setup)
      .then(async (res) => {
        if (res.me) qc.setQueryData(keys.me, res.me);
        await qc.invalidateQueries({ queryKey: keys.me });
        if (res.status === "completed") {
          setState("completed");
          setTimeout(() => router.replace((Platform.OS === "web" ? takeWebReturnPath() : "/") as never), 900);
        } else setState("failed");
      })
      .catch((e) => {
        setError(errorMessage(e));
        setState("error");
      });
  }, [setup, qc]);

  const back = () => router.replace((Platform.OS === "web" ? takeWebReturnPath() : "/") as never);

  return (
    <Screen>
      {state === "checking" ? <Loading label="בודקים מול חברת הסליקה..." /> : null}
      {state === "completed" ? (
        <Card tone="money">
          <Title>✓ הכרטיס נשמר</Title>
          <Body>לא בוצע חיוב. העמלה תחויב רק אחרי שהכסף יגיע אליך.</Body>
        </Card>
      ) : null}
      {state === "failed" || state === "error" ? (
        <Card tone="warning">
          <Body>{state === "failed" ? "הכרטיס לא נשמר. אפשר לנסות שוב או להשתמש בכרטיס אחר." : error ?? "משהו השתבש"}</Body>
          <Button title="חזרה" onPress={back} />
        </Card>
      ) : null}
    </Screen>
  );
}
