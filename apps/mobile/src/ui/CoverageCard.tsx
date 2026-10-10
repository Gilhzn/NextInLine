import { Linking, Text, View } from "react-native";
import { formatILS, type CoverageItemDto } from "@magiali/shared";
import { colors, space, type } from "../theme";
import { Body, Card } from ".";

export function CoverageCard({ item }: { item: CoverageItemDto }) {
  return (
    <Card>
      <Text style={{ fontSize: type.body + 1, fontWeight: "700", color: colors.text }}>
        {item.icon} {item.label}
      </Text>
      {item.members.map((m) => (
        <View key={m.memberId} style={{ gap: 2 }}>
          {item.members.length > 1 ? <Text style={{ fontSize: type.small, fontWeight: "600", color: colors.muted }}>{m.memberName}</Text> : null}
          {m.plans.map((p, i) => (
            <View key={p.planId} style={{ gap: 2 }}>
              <Body>
                {m.plans.length > 1 ? `${i + 1}. ` : ""}
                {p.planName}: {p.summary}
              </Body>
              <SourceLine confidence={p.confidence} note={p.note} sourceUrl={p.sourceUrl} />
              {p.remainingSessions !== null ? (
                <Text style={{ fontSize: type.caption, color: colors.money }}>נשארו השנה {p.remainingSessions} מפגשים</Text>
              ) : null}
              {p.remainingCapAgorot !== null ? (
                <Text style={{ fontSize: type.caption, color: colors.money }}>נשארו השנה {formatILS(p.remainingCapAgorot)}</Text>
              ) : null}
            </View>
          ))}
        </View>
      ))}
    </Card>
  );
}

const CONFIDENCE = {
  official: { label: "✓ לפי התקנון הרשמי", color: colors.money },
  secondary: { label: "≈ לפי מקור משני – כדאי לוודא", color: colors.warning },
  unverified: { label: "? לא אומת", color: colors.warning },
  custom: { label: "✎ לפי מה שהזנת מהפוליסה שלך", color: colors.primary },
} as const;

/** Where a coverage value comes from, so the user knows how much to trust it. */
export function SourceLine({ confidence, note, sourceUrl }: { confidence: keyof typeof CONFIDENCE; note: string | null; sourceUrl: string | null }) {
  const c = CONFIDENCE[confidence];
  return (
    <View style={{ gap: 2 }}>
      <Text style={{ fontSize: type.caption, color: c.color, fontWeight: "600" }}>
        {c.label}
        {sourceUrl ? (
          <Text style={{ textDecorationLine: "underline" }} onPress={() => void Linking.openURL(sourceUrl)} accessibilityRole="link">
            {" "}
            (מקור)
          </Text>
        ) : null}
      </Text>
      {note ? <Text style={{ fontSize: type.caption, color: colors.muted }}>{note}</Text> : null}
    </View>
  );
}
