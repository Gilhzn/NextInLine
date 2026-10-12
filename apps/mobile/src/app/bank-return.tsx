import { useEffect, useState } from "react";
import { router, useLocalSearchParams } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import type { BankConnectionDto } from "@magiali/shared";
import { errorMessage } from "../api/client";
import { waitForBankConnection } from "../lib/open-banking";
import { Body, Button, Card, Loading, Screen, Title } from "../ui";

/** Landing page after the provider's consent page (web, or a native deep link the browser session missed). */
export default function BankReturn() {
  const { connection } = useLocalSearchParams<{ connection?: string }>();
  const qc = useQueryClient();
  const [result, setResult] = useState<BankConnectionDto | null>(null);
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!connection) {
      setError("לא נמצא החיבור");
      return;
    }
    waitForBankConnection(connection)
      .then(async (c) => {
        setResult(c);
        await qc.invalidateQueries({ queryKey: ["bank-connections"] });
        await qc.invalidateQueries({ queryKey: ["money"] });
      })
      .catch((e) => setError(errorMessage(e)));
  }, [connection, qc]);

  const done = () => router.replace("/connect-bank");

  if (error) {
    return (
      <Screen>
        <Card tone="warning">
          <Body>{error}</Body>
          <Button title="חזרה" onPress={done} />
        </Card>
      </Screen>
    );
  }
  if (!result || result.status === "pending") return <Loading label="בודקים את האישור..." />;
  return (
    <Screen>
      {result.status === "active" ? (
        <Card tone="money">
          <Title>✓ מחובר</Title>
          <Body>{result.institutions.join(", ")}. מחפשים עכשיו תשלומים לרופאים ולטיפולים – נעדכן כשנמצא.</Body>
          <Button title="המשך" onPress={done} />
        </Card>
      ) : (
        <Card tone="warning">
          <Body>החיבור לא הושלם. אפשר לנסות שוב בכל רגע.</Body>
          <Button title="חזרה" onPress={done} />
        </Card>
      )}
    </Screen>
  );
}
