import { router } from "expo-router";
import { Text, View } from "react-native";
import { Body, Button, Card, Screen } from "../../ui";
import { colors, space, type } from "../../theme";

export default function Welcome() {
  return (
    <Screen footer={<Button title="בוא נבדוק כמה מגיע לי" onPress={() => router.push("/phone")} />}>
      <View style={{ alignItems: "center", marginTop: space.xxl, marginBottom: space.xl }}>
        <Text style={{ fontSize: 64 }}>💸</Text>
        <Text style={{ fontSize: type.h1 + 2, fontWeight: "800", color: colors.text, textAlign: "center", marginTop: space.md }}>
          יש לך כסף רפואי שמחכה לך
        </Text>
        <Body muted style={{ textAlign: "center", marginTop: space.sm }}>
          ישראלים משלמים על שב״ן וביטוח פרטי ולא תובעים את מה שמגיע להם. אנחנו מוצאים, מגישים ועוקבים.
        </Body>
      </View>
      <Card>
        <Body>✓ משלמים רק כשהכסף הגיע</Body>
        <Body>✓ הכסף עובר ישר אליך, לא דרכנו</Body>
        <Body>✓ אפשר לתבוע עד 3 שנים אחורה</Body>
      </Card>
    </Screen>
  );
}
