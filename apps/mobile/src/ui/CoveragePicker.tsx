import { Switch, Text, View } from "react-native";
import type { PlanDto } from "@magiali/shared";
import { colors, space, type } from "../theme";
import { Body, Chip, Row } from ".";

export interface CoverageSelection {
  shabanPlanId: string | null;
  /** planId → is it a "משלים שב"ן" policy */
  privatePlans: Record<string, boolean>;
}

export const emptySelection: CoverageSelection = { shabanPlanId: null, privatePlans: {} };

export function selectionToEnrollments(sel: CoverageSelection) {
  return [
    ...(sel.shabanPlanId ? [{ planId: sel.shabanPlanId, isShabanSupplement: false }] : []),
    ...Object.entries(sel.privatePlans).map(([planId, isShabanSupplement]) => ({ planId, isShabanSupplement })),
  ];
}

export function enrollmentsToSelection(
  enrollments: Array<{ planId: string; planKind: string; isShabanSupplement: boolean }>,
): CoverageSelection {
  const shaban = enrollments.find((e) => e.planKind === "shaban");
  return {
    shabanPlanId: shaban?.planId ?? null,
    privatePlans: Object.fromEntries(enrollments.filter((e) => e.planKind !== "shaban").map((e) => [e.planId, e.isShabanSupplement])),
  };
}

/** HMO → supplementary tier → private / group policies. No free text, just taps. */
export function CoveragePicker({
  plans,
  value,
  onChange,
}: {
  plans: PlanDto[];
  value: CoverageSelection;
  onChange: (next: CoverageSelection) => void;
}) {
  const shabanPlans = plans.filter((p) => p.kind === "shaban");
  const payers = [...new Map(shabanPlans.map((p) => [p.payerId, p.payerName])).entries()];
  const selectedShaban = shabanPlans.find((p) => p.id === value.shabanPlanId);
  const payerId = selectedShaban?.payerId ?? null;
  const privatePlans = plans.filter((p) => p.kind !== "shaban");

  return (
    <View style={{ gap: space.lg }}>
      <View style={{ gap: space.sm }}>
        <Text style={label}>באיזו קופה?</Text>
        <Row>
          {payers.map(([id, name]) => (
            <Chip
              key={id}
              label={name}
              selected={payerId === id}
              onPress={() => onChange({ ...value, shabanPlanId: shabanPlans.find((p) => p.payerId === id)?.id ?? null })}
            />
          ))}
        </Row>
      </View>

      {payerId ? (
        <View style={{ gap: space.sm }}>
          <Text style={label}>ואיזה ביטוח משלים (שב״ן)?</Text>
          <Row>
            {shabanPlans
              .filter((p) => p.payerId === payerId)
              .map((p) => (
                <Chip key={p.id} label={p.name} selected={value.shabanPlanId === p.id} onPress={() => onChange({ ...value, shabanPlanId: p.id })} />
              ))}
            <Chip label="אין לי" selected={value.shabanPlanId === null} onPress={() => onChange({ ...value, shabanPlanId: null })} />
          </Row>
        </View>
      ) : null}

      <View style={{ gap: space.sm }}>
        <Text style={label}>ביטוח בריאות פרטי או מהעבודה?</Text>
        <Body muted>אפשר לבדוק ב״הר הביטוח״ של משרד האוצר. אם לא בטוחים, אפשר לדלג ולהוסיף אחר כך.</Body>
        {privatePlans.map((p) => {
          const selected = p.id in value.privatePlans;
          return (
            <View key={p.id} style={{ gap: space.xs }}>
              <Chip
                label={`${selected ? "✓ " : ""}${p.name}`}
                selected={selected}
                onPress={() => {
                  const next = { ...value.privatePlans };
                  if (selected) delete next[p.id];
                  else next[p.id] = false;
                  onChange({ ...value, privatePlans: next });
                }}
              />
              {selected && p.description ? <Text style={{ fontSize: type.small, color: colors.muted, paddingHorizontal: space.sm }}>{p.description}</Text> : null}
              {selected && p.kind === "private_individual" ? (
                <Row style={{ paddingHorizontal: space.sm }}>
                  <Switch
                    value={value.privatePlans[p.id]}
                    onValueChange={(v) => onChange({ ...value, privatePlans: { ...value.privatePlans, [p.id]: v } })}
                    accessibilityLabel="פוליסה מסוג משלים שב״ן"
                    trackColor={{ true: colors.primary, false: colors.border }}
                  />
                  <Text style={{ fontSize: type.small, color: colors.muted, flex: 1 }}>
                    פוליסה מסוג ״משלים שב״ן״ (משלמת רק אחרי השב״ן)
                  </Text>
                </Row>
              ) : null}
            </View>
          );
        })}
      </View>
    </View>
  );
}

const label = { fontSize: type.body, fontWeight: "700" as const, color: colors.text };
