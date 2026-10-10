import { Redirect } from "expo-router";
import { useMe } from "../api/hooks";
import { useAuth } from "../state/auth";
import { Body, Button, Loading, Screen } from "../ui";
import { errorMessage } from "../api/client";

/** Entry router: signed out → welcome; mid-onboarding → resume the step; otherwise the main tabs. */
export default function Index() {
  const hydrated = useAuth((s) => s.hydrated);
  const token = useAuth((s) => s.accessToken);
  const me = useMe(hydrated && !!token);

  if (!hydrated) return <Loading />;
  if (!token) return <Redirect href="/welcome" />;
  if (me.isLoading) return <Loading />;
  if (me.error || !me.data) {
    return (
      <Screen>
        <Body>{errorMessage(me.error)}</Body>
        <Button title="נסה שוב" onPress={() => void me.refetch()} />
      </Screen>
    );
  }
  const step = me.data.user.onboardingStep;
  if (step !== "done") return <Redirect href={`/${step}`} />;
  return <Redirect href="/home" />;
}
