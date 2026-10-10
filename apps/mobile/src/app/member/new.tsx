import { router } from "expo-router";
import { Card, Screen, Title } from "../../ui";
import { MemberForm } from "../../ui/MemberForm";

export default function NewMember() {
  return (
    <Screen>
      <Title sub="אחר כך נגדיר את הביטוחים שלו/ה">מי מצטרף/ת?</Title>
      <Card>
        <MemberForm onDone={(m) => router.replace(`/member/${m.id}`)} />
      </Card>
    </Screen>
  );
}
