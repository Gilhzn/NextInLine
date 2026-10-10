import { router } from "expo-router";
import { useCoverageMap, useSetOnboardingStep } from "../../api/hooks";
import { errorMessage } from "../../api/client";
import { Body, Button, ErrorView, Loading, Screen, Title } from "../../ui";
import { CoverageCard } from "../../ui/CoverageCard";

export default function Map() {
  const map = useCoverageMap();
  const setStep = useSetOnboardingStep();

  async function next() {
    await setStep.mutateAsync("retro");
    router.replace("/retro");
  }

  return (
    <Screen footer={<Button title="יש לי קבלות? בוא נמצא כסף" onPress={next} loading={setStep.isPending} />}>
      <Title sub="גם בלי קבלה אחת, זה מה שהמשפחה שלך זכאית לו">זה מה שמגיע לכם 🛡</Title>
      {map.isLoading ? <Loading /> : null}
      {map.error ? <ErrorView message={errorMessage(map.error)} onRetry={() => void map.refetch()} /> : null}
      {map.data?.length === 0 ? <Body muted>לא הגדרתם כיסויים. אפשר להוסיף אותם בכל זמן בלשונית ״כיסויים״.</Body> : null}
      {map.data?.map((item) => <CoverageCard key={item.category} item={item} />)}
    </Screen>
  );
}
