import { router } from "expo-router";
import { errorMessage } from "../../api/client";
import { useMembers } from "../../api/hooks";
import { Badge, Body, Button, Card, ErrorView, Loading, Screen, Spread, Title } from "../../ui";

const RELATION_LABEL = { self: "אני", spouse: "בן/בת זוג", child: "ילד/ה", parent: "הורה", other: "אחר" } as const;

export default function Household() {
  const members = useMembers();
  return (
    <Screen footer={<Button title="הוספת בן משפחה" icon="＋" variant="secondary" onPress={() => router.push("/member/new")} />}>
      <Title sub="לכל אחד: הביטוחים שלו והתביעות שלו">המשפחה</Title>
      {members.isLoading ? <Loading /> : null}
      {members.error ? <ErrorView message={errorMessage(members.error)} onRetry={() => void members.refetch()} /> : null}
      {members.data?.map((m) => (
        <Card key={m.id} onPress={() => router.push(`/member/${m.id}`)}>
          <Spread>
            <Body style={{ fontWeight: "700" }}>{m.fullName}</Body>
            {m.consentStatus === "pending" ? <Badge label="מחכה לאישור" tone="warning" /> : <Badge label={RELATION_LABEL[m.relation]} />}
          </Spread>
          <Body muted>ביטוחים והרשאות ›</Body>
        </Card>
      ))}
    </Screen>
  );
}
