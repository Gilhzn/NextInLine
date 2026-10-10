import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ilsToAgorot, type BenefitRule, type PolicyTermDto, type PolicyTermsDto } from "@magiali/shared";
import { api, errorMessage } from "../../../api/client";
import { keys } from "../../../api/hooks";
import { colors, space, type } from "../../../theme";
import { Body, Button, Card, ErrorView, Field, Loading, Row, Screen, Title } from "../../../ui";
import { SourceLine } from "../../../ui/CoverageCard";

const toIls = (agorot: number | null | undefined) => (agorot ? String(agorot / 100) : "");
const toAgorot = (ils: string) => (ils.trim() ? ilsToAgorot(Number(ils.replace(",", "."))) : null);

/** The user's policy, category by category: confirm the catalog value or type the terms from their own policy. */
export default function PolicyTerms() {
  const { memberId, planId } = useLocalSearchParams<{ memberId: string; planId: string }>();
  const qc = useQueryClient();
  const key = ["policy-terms", memberId, planId];
  const terms = useQuery({ queryKey: key, queryFn: () => api<PolicyTermsDto>("GET", `/v1/members/${memberId}/enrollments/${planId}/terms`) });
  const [open, setOpen] = useState<string | null>(null);

  async function save(category: string, rule: BenefitRule | null | "reset") {
    const next = await api<PolicyTermsDto>("PUT", `/v1/members/${memberId}/enrollments/${planId}/terms`, { category, rule });
    qc.setQueryData(key, next);
    await qc.invalidateQueries({ queryKey: keys.coverage });
    setOpen(null);
  }

  if (terms.isLoading) return <Loading />;
  if (terms.error || !terms.data) return <Screen><ErrorView message={errorMessage(terms.error)} onRetry={() => void terms.refetch()} /></Screen>;
  const t = terms.data;

  return (
    <Screen>
      <Title sub={t.description ?? undefined}>{t.planName}</Title>
      <Card tone="primary">
        <Body>
          {t.planKind === "shaban"
            ? "אלה התנאים לפי התקנון של הקופה. אם משהו לא תואם למה שאתה יודע – אפשר לתקן."
            : "התנאים בביטוח פרטי משתנים בין פוליסות ומהדורות. פתח את הפוליסה שלך (או ״דף פרטי הביטוח״) ובדוק כל שורה."}
        </Body>
      </Card>
      {t.terms.map((term) => (
        <TermRow key={term.category} term={term} open={open === term.category} onToggle={() => setOpen(open === term.category ? null : term.category)} onSave={save} />
      ))}
    </Screen>
  );
}

function TermRow({
  term,
  open,
  onToggle,
  onSave,
}: {
  term: PolicyTermDto;
  open: boolean;
  onToggle: () => void;
  onSave: (category: string, rule: BenefitRule | null | "reset") => Promise<void>;
}) {
  const current = term.custom === undefined ? term.catalog?.rule ?? null : term.custom;
  const [percent, setPercent] = useState(current ? String(current.percent) : "");
  const [cap, setCap] = useState(toIls(current?.perSessionCapAgorot));
  const [sessions, setSessions] = useState(current?.annualSessions ? String(current.annualSessions) : "");
  const [annualCap, setAnnualCap] = useState(toIls(current?.annualCapAgorot));
  const [deductible, setDeductible] = useState(toIls(current?.deductibleAgorot));
  const [error, setError] = useState<string>();

  const status =
    term.custom === null ? "לא מכוסה בפוליסה שלי" : term.custom ? "✎ לפי הפוליסה שלי" : term.catalog ? term.catalog.summary : "אין מידע";

  async function submit(rule: BenefitRule | null | "reset") {
    setError(undefined);
    try {
      await onSave(term.category, rule);
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  const pct = Number(percent);
  const valid = pct > 0 && pct <= 100;

  return (
    <Card>
      <Pressable onPress={onToggle} accessibilityRole="button" accessibilityState={{ expanded: open }}>
        <Text style={{ fontSize: type.body, fontWeight: "700", color: colors.text }}>
          {term.icon} {term.label}
        </Text>
        <Body muted>{status}</Body>
      </Pressable>
      {term.catalog && term.custom === undefined ? <SourceLine confidence={term.catalog.confidence} note={term.catalog.note} sourceUrl={term.catalog.sourceUrl} /> : null}
      {open ? (
        <View style={{ gap: space.xs, marginTop: space.sm }}>
          <Row>
            <View style={{ flex: 1 }}>
              <Field label="אחוז החזר" value={percent} onChangeText={setPercent} keyboardType="decimal-pad" placeholder="80" />
            </View>
            <View style={{ flex: 1 }}>
              <Field label="תקרה לביקור (₪)" value={cap} onChangeText={setCap} keyboardType="decimal-pad" placeholder="ללא" />
            </View>
          </Row>
          <Row>
            <View style={{ flex: 1 }}>
              <Field label="מפגשים בשנה" value={sessions} onChangeText={setSessions} keyboardType="number-pad" placeholder="ללא הגבלה" />
            </View>
            <View style={{ flex: 1 }}>
              <Field label="תקרה שנתית (₪)" value={annualCap} onChangeText={setAnnualCap} keyboardType="decimal-pad" placeholder="ללא" />
            </View>
          </Row>
          <Field label="השתתפות עצמית לתביעה (₪)" value={deductible} onChangeText={setDeductible} keyboardType="decimal-pad" placeholder="0" />
          {error ? <Body style={{ color: colors.danger }}>{error}</Body> : null}
          <Button
            title="שמירה לפי הפוליסה שלי"
            disabled={!valid}
            onPress={() =>
              submit({
                percent: pct,
                perSessionCapAgorot: toAgorot(cap),
                perSessionFixedAgorot: null,
                annualCapAgorot: toAgorot(annualCap),
                annualSessions: sessions.trim() ? Number(sessions) : null,
                deductibleAgorot: toAgorot(deductible) ?? 0,
                requiredDocs: current?.requiredDocs ?? ["receipt"],
                minAge: current?.minAge ?? null,
                maxAge: current?.maxAge ?? null,
              })
            }
          />
          <Button title="הפוליסה שלי לא מכסה את זה" variant="secondary" onPress={() => submit(null)} />
          {term.custom !== undefined && term.catalog ? <Button title="חזרה לערכי הקטלוג" variant="ghost" onPress={() => submit("reset")} /> : null}
        </View>
      ) : null}
    </Card>
  );
}
