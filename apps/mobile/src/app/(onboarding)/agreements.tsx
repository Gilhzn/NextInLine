import { Text, View } from "react-native";
import { router } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import { FEE_POLICY } from "@magiali/shared";
import { keys, useMe, useSetOnboardingStep } from "../../api/hooks";
import { colors, radius, space, type } from "../../theme";
import { Body, Card, Screen, Title } from "../../ui";
import { ConsentChecklist } from "../../ui/Consents";
import { PaymentMethodForm } from "../../ui/PaymentMethodForm";

export default function Agreements() {
  const me = useMe();
  const setStep = useSetOnboardingStep();
  const qc = useQueryClient();

  return (
    <Screen>
      <Title sub="כל אישור בנפרד, ואפשר לבטל כל אחד מהם בהגדרות">כמעט סיימנו</Title>

      <Card tone="primary">
        <Text style={{ fontSize: type.body, fontWeight: "700", color: colors.text }}>💳 אמצעי תשלום לעמלה</Text>
        <Body>
          לא נחייב עכשיו. העמלה היא {FEE_POLICY.standardRateBps / 100}% מההחזר (עד {FEE_POLICY.capAgorot / 100} ₪ לתביעה), ונגבית רק אחרי שהכסף הגיע אליך.
        </Body>
        {me.data?.hasPaymentMethod ? (
          <View style={{ backgroundColor: colors.surface, borderRadius: radius, padding: space.md }}>
            <Body>✓ אמצעי תשלום נשמר</Body>
          </View>
        ) : (
          <PaymentMethodForm returnTo="/agreements" onSaved={() => void qc.invalidateQueries({ queryKey: keys.me })} />
        )}
      </Card>

      <Card>
        <ConsentChecklist
          kinds={["terms", "privacy", "medical_data", "ai_processing", "poa", "marketing"]}
          required={["terms", "privacy", "medical_data"]}
          submitTitle="סיימנו, בוא נתחיל"
          onDone={async () => {
            await setStep.mutateAsync("done");
            router.replace("/home");
          }}
        />
      </Card>
    </Screen>
  );
}
