import { useState } from "react";
import { Platform, Text, View } from "react-native";
import { router } from "expo-router";
import { formatILS } from "@magiali/shared";
import { errorMessage } from "../../api/client";
import { useSetOnboardingStep, useUnclaimedReceipts } from "../../api/hooks";
import { captureWithCamera, pickFromLibrary, pickPdf, uploadReceipt, type PickResult } from "../../lib/media";
import { colors, space, type } from "../../theme";
import { MedicalConsentGate } from "../../ui/Consents";
import { Body, Button, Card, Screen, Title } from "../../ui";

export default function Retro() {
  const setStep = useSetOnboardingStep();
  const [uploading, setUploading] = useState(0);
  const [error, setError] = useState<string>();
  const receipts = useUnclaimedReceipts(true);

  const all = receipts.data ?? [];
  const reading = all.filter((r) => r.extractionStatus === "pending" || r.extractionStatus === "processing").length;
  const foundAgorot = all.reduce((s, r) => s + (r.amountAgorot ?? 0), 0);

  async function add(pick: () => Promise<PickResult>) {
    setError(undefined);
    const result = await pick();
    if (!result.ok) {
      if (result.reason === "permission") setError("צריך הרשאה כדי להמשיך. אפשר לאשר בהגדרות הטלפון");
      return;
    }
    setUploading((n) => n + result.files.length);
    for (const file of result.files) {
      try {
        await uploadReceipt(file);
      } catch (e) {
        setError(errorMessage(e));
      } finally {
        setUploading((n) => n - 1);
      }
    }
    await receipts.refetch();
  }

  async function next() {
    await setStep.mutateAsync("agreements");
    router.replace("/agreements");
  }

  return (
    <Screen
      footer={
        <Button
          title={all.length > 0 ? "המשך" : "אין לי עכשיו, אדלג"}
          variant={all.length > 0 ? "primary" : "ghost"}
          onPress={next}
          loading={setStep.isPending}
        />
      }
    >
      <Title sub="קבלות רפואיות מ-3 השנים האחרונות: רופאים פרטיים, טיפולים, בדיקות, משקפיים">איפה הקבלות שלך?</Title>
      <MedicalConsentGate>
        {Platform.OS !== "web" ? <Button title="צלם קבלות" icon="📷" onPress={() => add(captureWithCamera)} /> : null}
        <View style={{ height: space.sm }} />
        <Button title="בחר מהגלריה (כמה ביחד)" icon="🖼" variant="secondary" onPress={() => add(() => pickFromLibrary(true))} />
        <View style={{ height: space.sm }} />
        <Button title="קובץ PDF" icon="📄" variant="secondary" onPress={() => add(pickPdf)} />
        <Body muted style={{ marginTop: space.md }}>
          🔒 הקבלות נשמרות מוצפנות, ונמחקות אוטומטית אחרי שהתביעה נסגרת.
        </Body>
      </MedicalConsentGate>

      {all.length > 0 || uploading > 0 ? (
        <Card tone="money" style={{ marginTop: space.xl, alignItems: "center" }}>
          <Text style={{ fontSize: type.small, color: colors.muted }}>
            {uploading > 0 ? `מעלים ${uploading}...` : reading > 0 ? `קוראים ${reading} קבלות...` : `${all.length} קבלות`}
          </Text>
          <Text style={{ fontSize: type.money, fontWeight: "800", color: colors.money }}>{formatILS(foundAgorot)}</Text>
          <Body muted>בקבלות שמצאנו עד עכשיו. נחשב כמה מזה מגיע לך אחרי שתאשר את הפרטים</Body>
        </Card>
      ) : null}
      {error ? <Body style={{ color: colors.danger }}>{error}</Body> : null}
    </Screen>
  );
}
