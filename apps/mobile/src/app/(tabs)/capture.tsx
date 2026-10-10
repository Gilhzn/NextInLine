import { useState } from "react";
import { Platform, View } from "react-native";
import { router } from "expo-router";
import { ApiError, errorMessage } from "../../api/client";
import { captureWithCamera, pickFromLibrary, pickPdf, uploadReceipt, type PickResult } from "../../lib/media";
import { colors, space } from "../../theme";
import { Body, Button, Card, Loading, Screen, Title } from "../../ui";

export default function Capture() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function run(pick: () => Promise<PickResult>) {
    setError(undefined);
    const result = await pick();
    if (!result.ok) {
      if (result.reason === "permission") setError("צריך הרשאה למצלמה. אפשר לאשר בהגדרות הטלפון");
      return;
    }
    setBusy(true);
    try {
      const uploaded = [];
      for (const file of result.files) uploaded.push(await uploadReceipt(file));
      if (uploaded.length === 1) router.push(`/receipt/${uploaded[0]!.id}`);
      else router.push("/claims");
    } catch (e) {
      if (e instanceof ApiError && e.code === "conflict" && (e.details as { receiptId?: string })?.receiptId) {
        router.push(`/receipt/${(e.details as { receiptId: string }).receiptId}`);
      } else {
        setError(errorMessage(e));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <Title sub="רופא פרטי, טיפול, בדיקה, משקפיים. אנחנו נבדוק ממי מגיע החזר">יש לך קבלה?</Title>
      {busy ? (
        <Loading label="מעלים ומצפינים..." />
      ) : (
        <View style={{ gap: space.md }}>
          {Platform.OS !== "web" ? <Button title="צלם קבלה" icon="📷" onPress={() => run(captureWithCamera)} /> : null}
          <Button title="בחר מהגלריה" icon="🖼" variant="secondary" onPress={() => run(() => pickFromLibrary(true))} />
          <Button title="קובץ PDF / מסמך" icon="📄" variant="secondary" onPress={() => run(pickPdf)} />
        </View>
      )}
      {error ? (
        <Card tone="danger" style={{ marginTop: space.lg }}>
          <Body style={{ color: colors.danger }}>{error}</Body>
        </Card>
      ) : null}
      <Card tone="primary" style={{ marginTop: space.xl }}>
        <Body>💡 טיפ: קיבלת קבלה בוואטסאפ או במייל? שתף אותה ל״מגיע לי״ ישירות מהאפליקציה.</Body>
      </Card>
    </Screen>
  );
}
