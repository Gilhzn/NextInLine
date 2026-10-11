import { useMemo, useState } from "react";
import { Share, Text, View } from "react-native";
import { router } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import {
  formatILS,
  ilsToAgorot,
  type DocKind,
  type EntitlementEstimateDto,
  type EntitlementSummaryDto,
} from "@magiali/shared";
import { api, errorMessage } from "../api/client";
import { colors, space, type } from "../theme";
import { Body, Button, Card, Chip, ErrorView, Field, Loading, Row, Screen, Spread, Title } from "../ui";

const DOC: Record<DocKind, string> = {
  receipt: "קבלה",
  referral: "הפניה",
  visit_summary: "סיכום ביקור",
  payer_payment_proof: "אישור תשלום מהגוף הקודם",
};

/**
 * Everything the household can get back, in one place: per person and service, what a typical visit returns,
 * what is left this year, what we still can't calculate, what isn't covered – and an estimate of what may be
 * waiting from the last 3 years.
 */
export default function Entitlements() {
  const summary = useQuery({
    queryKey: ["coverage", "summary"],
    queryFn: () => api<EntitlementSummaryDto>("GET", "/v1/coverage/summary"),
  });
  const [memberId, setMemberId] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Record<string, { visits: string; price: string }>>({});
  const [estimate, setEstimate] = useState<EntitlementEstimateDto | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const data = summary.data;
  const selected = data?.members.find((m) => m.memberId === (memberId ?? data.members[0]?.memberId));
  const filled = useMemo(
    () =>
      Object.entries(answers)
        .map(([key, a]) => ({ key, visits: Number(a.visits), price: Number(a.price.replace(",", ".")) }))
        .filter((a) => a.visits > 0 && a.price > 0),
    [answers],
  );

  async function runEstimate() {
    setBusy(true);
    setError(undefined);
    try {
      const res = await api<EntitlementEstimateDto>("POST", "/v1/coverage/estimate", {
        items: filled.map((a) => {
          const [mId, category] = a.key.split("|");
          return { memberId: mId, category, visits: Math.round(a.visits), priceAgorot: ilsToAgorot(a.price) };
        }),
      });
      setEstimate(res);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  function share() {
    if (!data) return;
    const lines = ["מה מגיע לנו מהביטוחים (מגיע לי):"];
    for (const m of data.members) {
      if (m.categories.length === 0) continue;
      lines.push(`\n${m.memberName}:`);
      for (const c of m.categories) {
        lines.push(`• ${c.label}: על ${formatILS(c.example.priceAgorot)} מקבלים ${formatILS(c.example.refundAgorot)}`);
      }
    }
    if (data.gaps.length) lines.push(`\nלא מכוסה: ${data.gaps.map((g) => g.label).join(", ")}`);
    void Share.share({ message: lines.join("\n") });
  }

  if (summary.isLoading) return <Loading />;
  if (summary.error || !data) return <Screen><ErrorView message={errorMessage(summary.error)} onRetry={() => void summary.refetch()} /></Screen>;

  const coveredCount = data.members.reduce((n, m) => n + m.categories.length, 0);

  return (
    <Screen>
      <Title sub="כל ההחזרים שאפשר לקבל מהשב״ן ומהביטוחים, במקום אחד">כל מה שמגיע לכם</Title>

      {data.openMoney.unclaimedReceipts > 0 || data.openMoney.inFlightAgorot > 0 ? (
        <Card tone="money">
          <Text style={heading}>💰 כסף שכבר מחכה לכם</Text>
          {data.openMoney.unclaimedReceipts > 0 ? (
            <Body>
              {data.openMoney.unclaimedReceipts} קבלות שעוד לא נתבעו
              {data.openMoney.unclaimedAgorot > 0 ? ` (${formatILS(data.openMoney.unclaimedAgorot)})` : ""}
            </Body>
          ) : null}
          {data.openMoney.inFlightAgorot > 0 ? <Body>בדרך אליכם: {formatILS(data.openMoney.inFlightAgorot)}</Body> : null}
          <Button title="לתביעות" variant="secondary" onPress={() => router.push("/claims")} />
        </Card>
      ) : null}

      {data.missingTerms.length > 0 ? (
        <Card tone="warning">
          <Text style={heading}>✎ עוד לא יודעים לחשב את הביטוחים האלה</Text>
          <Body>מזינים את התנאים מהפוליסה (2 דקות), ואז נוכל לחשב גם אותם:</Body>
          {data.missingTerms.map((t) => (
            <Button
              key={`${t.memberId}-${t.planId}`}
              title={data.members.length > 1 ? `${t.planName} (${t.memberName})` : t.planName}
              variant="secondary"
              onPress={() => router.push(`/policy/${t.memberId}/${t.planId}`)}
            />
          ))}
        </Card>
      ) : null}

      {coveredCount === 0 ? (
        <Card>
          <Body>עוד לא מצאנו כיסוי שמחזיר כסף. הוסיפו את השב״ן והביטוחים, או ייבאו אותם מהר הביטוח.</Body>
          <Button title="ייבוא מהר הביטוח" icon="📥" onPress={() => router.push("/import")} />
        </Card>
      ) : null}

      {data.members.map((m) =>
        m.categories.length === 0 ? null : (
          <View key={m.memberId} style={{ marginBottom: space.md }}>
            {data.members.length > 1 ? <Text style={memberTitle}>{m.memberName}</Text> : null}
            {m.categories.map((c) => (
              <Card key={c.category}>
                <Spread>
                  <Text style={{ fontSize: type.body, fontWeight: "700", color: colors.text, flex: 1 }}>
                    {c.icon} {c.label}
                  </Text>
                  <Text style={{ fontSize: type.body, fontWeight: "800", color: c.example.refundAgorot > 0 ? colors.money : colors.muted }}>
                    {formatILS(c.example.refundAgorot)}
                  </Text>
                </Spread>
                <Body muted>
                  על ביקור של {formatILS(c.example.priceAgorot)} (לדוגמה)
                  {c.example.legs.length > 1 ? ": " + c.example.legs.map((l) => `${l.planName} ${formatILS(l.amountAgorot)}`).join(" + ") : c.example.legs[0] ? ` · ${c.example.legs[0].planName}` : ""}
                </Body>
                {c.remaining
                  .filter((r) => r.sessions !== null || r.capAgorot !== null)
                  .map((r, i) => (
                    <Text key={i} style={{ fontSize: type.caption, color: r.sessions === 0 || r.capAgorot === 0 ? colors.warning : colors.money }}>
                      {r.planName}: נשארו השנה {r.sessions !== null ? `${r.sessions} מפגשים` : ""}
                      {r.sessions !== null && r.capAgorot !== null ? " · " : ""}
                      {r.capAgorot !== null ? formatILS(r.capAgorot) : ""}
                    </Text>
                  ))}
                <Text style={{ fontSize: type.caption, color: colors.muted }}>צריך: {c.requiredDocs.map((d) => DOC[d]).join(", ")}</Text>
              </Card>
            ))}
          </View>
        ),
      )}

      <Button title="מה שילמנו על הביטוחים מול מה שקיבלנו" icon="💼" variant="secondary" onPress={() => router.push("/premiums")} />

      {data.gaps.length > 0 ? (
        <Card>
          <Text style={heading}>🚫 לא מצאנו כיסוי ל:</Text>
          <Body>{data.gaps.map((g) => `${g.icon} ${g.label}`).join(" · ")}</Body>
          <Body muted>יש לכם ביטוח שעוד לא הוספתם? ייבאו את הרשימה המלאה מהר הביטוח.</Body>
          <Button title="ייבוא מהר הביטוח" icon="📥" variant="secondary" onPress={() => router.push("/import")} />
        </Card>
      ) : null}

      {data.pendingConsent.length > 0 ? (
        <Body muted>לא נכללו (מחכים לאישור שלהם ב-SMS): {data.pendingConsent.join(", ")}</Body>
      ) : null}

      {coveredCount > 0 && selected ? (
        <Card tone="primary">
          <Text style={heading}>🔎 כמה מחכה לכם מ-3 השנים האחרונות?</Text>
          <Body muted>אפשר לתבוע עד 3 שנים אחורה. כמה פעמים שילמתם באופן פרטי, ובערך כמה? (הערכה – הקבלות קובעות)</Body>
          {data.members.length > 1 ? (
            <Row>
              {data.members.map((m) => (
                <Chip key={m.memberId} label={m.memberName} selected={selected.memberId === m.memberId} onPress={() => setMemberId(m.memberId)} />
              ))}
            </Row>
          ) : null}
          {selected.categories.map((c) => {
            const key = `${selected.memberId}|${c.category}`;
            const a = answers[key] ?? { visits: "", price: String(c.example.priceAgorot / 100) };
            const result = estimate?.items.find((i) => i.memberId === selected.memberId && i.category === c.category);
            return (
              <View key={key} style={{ marginTop: space.sm }}>
                <Text style={{ fontSize: type.small, fontWeight: "700", color: colors.text }}>
                  {c.icon} {c.label}
                  {result ? <Text style={{ color: colors.money }}> → {formatILS(result.refundAgorot)}</Text> : null}
                </Text>
                <Row>
                  <View style={{ flex: 1 }}>
                    <Field
                      label="כמה פעמים"
                      value={a.visits}
                      keyboardType="number-pad"
                      placeholder="0"
                      onChangeText={(v) => setAnswers((s) => ({ ...s, [key]: { ...a, visits: v.replace(/\D/g, "") } }))}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Field
                      label="בערך כמה כל פעם (₪)"
                      value={a.price}
                      keyboardType="decimal-pad"
                      onChangeText={(v) => setAnswers((s) => ({ ...s, [key]: { ...a, price: v } }))}
                    />
                  </View>
                </Row>
              </View>
            );
          })}
          {error ? <Body style={{ color: colors.danger }}>{error}</Body> : null}
          <Button title="חשבו לי" onPress={runEstimate} loading={busy} disabled={filled.length === 0} />
          {estimate ? (
            <Card tone="money" style={{ alignItems: "center", marginTop: space.sm }}>
              <Body>בערך מחכים לכם</Body>
              <Text style={{ fontSize: type.money, fontWeight: "800", color: colors.money }}>{formatILS(estimate.totalAgorot)}</Text>
              <Body muted>מצאו את הקבלות (גם במייל או אצל המטפל), צלמו אותן, ואנחנו נגיש.</Body>
              <Button title="צלמו קבלות" icon="📷" onPress={() => router.push("/capture")} />
            </Card>
          ) : null}
        </Card>
      ) : null}

      {coveredCount > 0 ? <Button title="שיתוף הסיכום" icon="↗" variant="ghost" onPress={share} /> : null}
      <Body muted>החישוב לפי תנאי התקנונים והפוליסות כפי שהוזנו. זה מידע, לא ייעוץ, וההחלטה הסופית של הקופה או המבטח.</Body>
    </Screen>
  );
}

const heading = { fontSize: type.body, fontWeight: "800" as const, color: colors.text, marginBottom: space.xs };
const memberTitle = { fontSize: type.body + 1, fontWeight: "800" as const, color: colors.text, marginVertical: space.sm };
