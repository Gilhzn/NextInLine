import { useState } from "react";
import { Text, View } from "react-native";
import { router } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { formatILS, ilsToAgorot, type PremiumPlanDto, type PremiumsDto } from "@magiali/shared";
import { api, errorMessage } from "../api/client";
import { colors, radius, space, type } from "../theme";
import { Badge, Body, Button, Card, ErrorView, Field, Loading, Row, Screen, Spread, Title } from "../ui";

const KIND = { shaban: "שב״ן", private_individual: "ביטוח פרטי", private_group: "ביטוח קבוצתי" } as const;

/**
 * What each policy cost over the last 12 months next to what it actually returned on receipts.
 * Information only – never a recommendation to buy or cancel insurance.
 */
export default function Premiums() {
  const premiums = useQuery({ queryKey: ["premiums"], queryFn: () => api<PremiumsDto>("GET", "/v1/premiums") });

  if (premiums.isLoading) return <Loading />;
  if (premiums.error || !premiums.data) return <Screen><ErrorView message={errorMessage(premiums.error)} onRetry={() => void premiums.refetch()} /></Screen>;
  const d = premiums.data;
  const { totals } = d;

  return (
    <Screen>
      <Title sub="מה שילמנו על כל ביטוח ב-12 החודשים האחרונים, ומה הוא החזיר על קבלות">מה הביטוחים נותנים לנו</Title>

      {totals.premiumsAgorot > 0 ? (
        <Card>
          <Spread>
            <Stat label="שילמנו על ביטוחים" agorot={totals.premiumsAgorot} color={colors.text} />
            <Stat label="קיבלנו בחזרה" agorot={totals.refundsAgorot} color={colors.money} />
            <Stat label="בדרך" agorot={totals.waitingAgorot} color={colors.primary} />
          </Spread>
          {totals.plansWithoutPremium > 0 ? (
            <Body muted>לא כולל {totals.plansWithoutPremium} ביטוחים שעוד לא הזנתם להם כמה משלמים.</Body>
          ) : null}
        </Card>
      ) : null}

      {d.plans.length === 0 ? (
        <Card>
          <Body>עוד לא הוספתם ביטוחים.</Body>
          <Button title="ייבוא מהר הביטוח" icon="📥" onPress={() => router.push("/import")} />
        </Card>
      ) : null}

      {d.plans.map((p) => (
        <PlanCard key={p.planId} plan={p} />
      ))}

      {d.overlaps.length > 0 ? (
        <Card tone="primary">
          <Text style={heading}>🔁 שירותים ששני ביטוחים מכסים</Text>
          {d.overlaps.map((o, i) => (
            <Body key={i}>
              {o.icon} {o.label}
              {new Set(d.overlaps.map((x) => x.memberName)).size > 1 ? ` (${o.memberName})` : ""}: {o.planNames.join(" + ")}
            </Body>
          ))}
        </Card>
      ) : null}

      <Card tone="warning">
        {d.notes.map((n, i) => (
          <Body key={i}>{n}</Body>
        ))}
      </Card>
      <Button title="מה מגיע לנו מכל ביטוח" icon="📋" variant="secondary" onPress={() => router.push("/entitlements")} />
    </Screen>
  );
}

function Stat({ label, agorot, color }: { label: string; agorot: number; color: string }) {
  return (
    <View style={{ alignItems: "center", flex: 1 }}>
      <Text style={{ fontSize: type.caption, color: colors.muted, textAlign: "center" }}>{label}</Text>
      <Text style={{ fontSize: type.body + 1, fontWeight: "800", color }}>{formatILS(agorot)}</Text>
    </View>
  );
}

function PlanCard({ plan }: { plan: PremiumPlanDto }) {
  const [editing, setEditing] = useState(plan.monthlyPremiumAgorot === null);
  const back = plan.refundsAgorot + plan.waitingAgorot;
  const share = plan.premiumsAgorot ? Math.min(1, back / plan.premiumsAgorot) : 0;
  return (
    <Card>
      <Spread>
        <Text style={{ fontSize: type.body, fontWeight: "800", color: colors.text, flex: 1 }}>{plan.planName}</Text>
        <Badge label={KIND[plan.planKind]} tone="muted" />
      </Spread>
      {plan.members.length > 1 ? <Body muted>{plan.members.map((m) => m.memberName).join(", ")}</Body> : null}

      {plan.premiumsAgorot !== null ? (
        <>
          <Body>
            שילמנו {formatILS(plan.premiumsAgorot)} ({formatILS(plan.monthlyPremiumAgorot!)} לחודש) · חזר{" "}
            <Text style={{ fontWeight: "800", color: colors.money }}>{formatILS(plan.refundsAgorot)}</Text>
            {plan.waitingAgorot > 0 ? ` · בדרך ${formatILS(plan.waitingAgorot)}` : ""}
          </Body>
          <View style={bar} accessibilityLabel={`חזר או בדרך ${Math.round(share * 100)} אחוז מהפרמיות`}>
            <View style={{ width: `${share * 100}%`, backgroundColor: colors.money, height: "100%", borderRadius: radius }} />
          </View>
        </>
      ) : (
        <Body>
          חזר ב-12 החודשים האחרונים: <Text style={{ fontWeight: "800", color: colors.money }}>{formatILS(plan.refundsAgorot)}</Text>
          {plan.waitingAgorot > 0 ? ` · בדרך ${formatILS(plan.waitingAgorot)}` : ""}
        </Body>
      )}
      <Body muted>
        {plan.servicesUsed.length ? `השתמשנו ב: ${plan.servicesUsed.join(", ")} · ` : "עוד לא קיבלנו ממנו החזר השנה · "}
        {plan.servicesCovered === 1 ? "מכסה סוג שירות אחד" : `מכסה ${plan.servicesCovered} סוגי שירות`}
      </Body>

      {editing ? (
        <PremiumEditor plan={plan} onDone={() => setEditing(false)} />
      ) : (
        <Button title="עדכון הסכום החודשי" variant="ghost" onPress={() => setEditing(true)} />
      )}
    </Card>
  );
}

function PremiumEditor({ plan, onDone }: { plan: PremiumPlanDto; onDone: () => void }) {
  const qc = useQueryClient();
  const [values, setValues] = useState<Record<string, string>>(
    Object.fromEntries(plan.members.map((m) => [m.memberId, m.monthlyPremiumAgorot !== null ? String(m.monthlyPremiumAgorot / 100) : ""])),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function save() {
    setBusy(true);
    setError(undefined);
    try {
      for (const m of plan.members) {
        const text = (values[m.memberId] ?? "").trim().replace(",", ".");
        const next = text === "" ? null : ilsToAgorot(Number(text));
        if (next !== null && !(next >= 0)) throw new Error("סכום לא תקין");
        if (next === m.monthlyPremiumAgorot) continue;
        await api("PUT", `/v1/members/${m.memberId}/enrollments/${plan.planId}/premium`, { monthlyPremiumAgorot: next });
      }
      await qc.invalidateQueries({ queryKey: ["premiums"] });
      onDone();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={{ gap: space.xs, marginTop: space.sm }}>
      <Text style={{ fontSize: type.small, color: colors.muted, fontWeight: "600" }}>כמה משלמים בחודש? (₪)</Text>
      {plan.members.length > 1 ? (
        <Body muted>בפוליסה משפחתית מספיק להזין את הסכום הכולל פעם אחת.</Body>
      ) : null}
      {plan.members.map((m) => (
        <Field
          key={m.memberId}
          label={plan.members.length > 1 ? m.memberName : "סכום חודשי"}
          value={values[m.memberId] ?? ""}
          onChangeText={(v) => setValues((s) => ({ ...s, [m.memberId]: v }))}
          keyboardType="decimal-pad"
          placeholder="למשל 120"
        />
      ))}
      <Row>
        <Button title="שמירה" onPress={() => void save()} loading={busy} />
      </Row>
      {error ? <Body style={{ color: colors.danger }}>{error}</Body> : null}
    </View>
  );
}

const heading = { fontSize: type.body, fontWeight: "800" as const, color: colors.text, marginBottom: space.xs };
const bar = { height: 8, backgroundColor: colors.border, borderRadius: radius, overflow: "hidden" as const, marginVertical: space.sm };
