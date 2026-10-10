import { Text, View } from "react-native";
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
