import { useState } from "react";
import { router } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import { api, errorMessage } from "../../api/client";
import { keys, useMe, useSetOnboardingStep } from "../../api/hooks";
import { Badge, Body, Button, Card, Field, Loading, Screen, Spread, Title } from "../../ui";
import { MemberForm } from "../../ui/MemberForm";

const RELATION_LABEL = { self: "אני", spouse: "בן/בת זוג", child: "ילד/ה", parent: "הורה", other: "אחר" } as const;

export default function Family() {
  const me = useMe();
  const setStep = useSetOnboardingStep();
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string>();

  if (!me.data) return <Loading />;
  const self = me.data.members.find((m) => m.isSelf);

  async function next() {
    setError(undefined);
    try {
      if (name.trim().length > 0) {
        const updated = await api("PATCH", "/v1/me", { displayName: name.trim() });
        qc.setQueryData(keys.me, updated);
      }
      await setStep.mutateAsync("coverage");
      router.replace("/coverage");
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  return (
    <Screen footer={<Button title="המשך" onPress={next} loading={setStep.isPending} disabled={!self || (self.fullName === "אני" && name.trim().length < 2)} />}>
      <Title sub="כל אחד במשפחה = עוד כסף שאפשר להחזיר">על מי נבדוק?</Title>
      <Field label="השם שלך" value={name} onChangeText={setName} placeholder={self?.fullName === "אני" ? "שם פרטי ומשפחה" : self?.fullName} />
      {me.data.members
        .filter((m) => !m.isSelf)
        .map((m) => (
          <Card key={m.id}>
            <Spread>
              <Body>{m.fullName}</Body>
              <Badge label={m.consentStatus === "pending" ? "מחכה לאישור" : RELATION_LABEL[m.relation]} tone={m.consentStatus === "pending" ? "warning" : "primary"} />
            </Spread>
          </Card>
        ))}
      {adding ? (
        <Card>
          <MemberForm onDone={() => setAdding(false)} />
        </Card>
      ) : (
        <Button title="הוספת בן משפחה" variant="secondary" icon="＋" onPress={() => setAdding(true)} />
      )}
      {error ? <Body style={{ color: "#B91C1C" }}>{error}</Body> : null}
      <Body muted style={{ marginTop: 16 }}>
        אפשר להוסיף בני משפחה גם אחר כך.
      </Body>
    </Screen>
  );
}
