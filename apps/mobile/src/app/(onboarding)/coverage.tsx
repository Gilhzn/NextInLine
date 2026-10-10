import { useEffect, useRef, useState } from "react";
import { Switch, Text } from "react-native";
import { router } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import { api, errorMessage } from "../../api/client";
import { keys, useEnrollments, useMe, usePlans, useSetOnboardingStep } from "../../api/hooks";
import { colors, space } from "../../theme";
import { Body, Button, Card, Loading, Row, Screen, Title } from "../../ui";
import { CoveragePicker, emptySelection, enrollmentsToSelection, selectionToEnrollments, type CoverageSelection } from "../../ui/CoveragePicker";

export default function Coverage() {
  const me = useMe();
  const plans = usePlans();
  const setStep = useSetOnboardingStep();
  const qc = useQueryClient();
  const [sameForAll, setSameForAll] = useState(true);
  const [selections, setSelections] = useState<Record<string, CoverageSelection>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const selfId = me.data?.members.find((m) => m.isSelf)?.id ?? "";
  const selfEnrollments = useEnrollments(selfId);

  // Policies imported from Har HaBituach (or saved earlier) show up as selected – each one once, so a plan the
  // user then unticks stays unticked.
  const seen = useRef(new Set<string>());
  useEffect(() => {
    if (!selfEnrollments.data || !selfId) return;
    const fresh = selfEnrollments.data.filter((e) => !seen.current.has(e.planId));
    if (fresh.length === 0) return;
    for (const e of fresh) seen.current.add(e.planId);
    const saved = enrollmentsToSelection(fresh);
    setSelections((s) => {
      const current = s[selfId] ?? emptySelection;
      return {
        ...s,
        [selfId]: {
          shabanPlanId: current.shabanPlanId ?? saved.shabanPlanId,
          privatePlans: { ...current.privatePlans, ...saved.privatePlans },
        },
      };
    });
  }, [selfEnrollments.data, selfId]);

  if (!me.data || !plans.data) return <Loading />;
  const members = me.data.members;
  const self = members.find((m) => m.isSelf)!;
  const editable = sameForAll ? [self] : members;

  async function save() {
    setSaving(true);
    setError(undefined);
    try {
      for (const m of members) {
        const sel = selections[sameForAll ? self.id : m.id] ?? emptySelection;
        await api("PUT", `/v1/members/${m.id}/enrollments`, { enrollments: selectionToEnrollments(sel) });
      }
      await qc.invalidateQueries({ queryKey: keys.coverage });
      await setStep.mutateAsync("map");
      router.replace("/map");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Screen footer={<Button title="המשך" onPress={save} loading={saving} />}>
      <Title sub="ככה נדע ממי מגיע לכם כסף, ובאיזה סדר">איך אתם מבוטחים?</Title>
      <Card tone="primary">
        <Body style={{ fontWeight: "700" }}>📥 לא בטוחים איזה ביטוח פרטי יש לכם?</Body>
        <Body>מייבאים את הרשימה הרשמית מהר הביטוח של משרד האוצר, ואנחנו מזהים מה מחזיר כסף.</Body>
        <Button title="ייבוא מהר הביטוח" variant="secondary" onPress={() => router.push({ pathname: "/import", params: { next: "/coverage" } })} />
      </Card>
      {members.length > 1 ? (
        <Row style={{ marginBottom: space.lg }}>
          <Switch value={sameForAll} onValueChange={setSameForAll} trackColor={{ true: colors.primary, false: colors.border }} />
          <Text style={{ fontSize: 16, color: colors.text }}>אותו דבר לכל המשפחה</Text>
        </Row>
      ) : null}
      {editable.map((m) => (
        <Card key={m.id}>
          {editable.length > 1 ? <Body style={{ fontWeight: "700" }}>{m.fullName}</Body> : null}
          <CoveragePicker
            plans={plans.data}
            value={selections[m.id] ?? emptySelection}
            onChange={(v) => setSelections((s) => ({ ...s, [m.id]: v }))}
          />
        </Card>
      ))}
      {error ? <Body style={{ color: colors.danger }}>{error}</Body> : null}
    </Screen>
  );
}
