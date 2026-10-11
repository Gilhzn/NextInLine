import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import {
  BENEFIT_CATEGORIES,
  CATEGORY_INFO,
  formatILS,
  ilsToAgorot,
  type BeforeBookingDto,
  type BenefitCategory,
  type EntitlementSummaryDto,
} from "@magiali/shared";
import { api, errorMessage } from "../api/client";
import { useMembers } from "../api/hooks";
import { colors, space, type } from "../theme";
import { Badge, Body, Button, Card, Chip, Field, Loading, Row, Screen, Spread, Title } from "../ui";

interface OptionDraft {
  label: string;
  price: string;
  kind: "private" | "network";
}

const shekels = (agorot: number) => String(Math.round(agorot) / 100);

/**
 * Before booking: what a visit will really cost after every refund, compared across up to three places
 * (private, or an in-network co-payment the user looked up), and what to arrange first so no refund is lost.
 */
export default function BeforeBooking() {
  const params = useLocalSearchParams<{ memberId?: string; category?: string }>();
  const members = useMembers();
  const summary = useQuery({
    queryKey: ["coverage", "summary"],
    queryFn: () => api<EntitlementSummaryDto>("GET", "/v1/coverage/summary"),
  });
  const usable = members.data?.filter((m) => m.consentStatus !== "pending") ?? [];
  const [memberId, setMemberId] = useState<string | undefined>(params.memberId);
  const [category, setCategory] = useState<BenefitCategory | undefined>(
    BENEFIT_CATEGORIES.find((c) => c === params.category),
  );
  const [showAll, setShowAll] = useState(false);
  const [sessions, setSessions] = useState("1");
  const [options, setOptions] = useState<OptionDraft[]>([]);
  const [result, setResult] = useState<BeforeBookingDto | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const who = memberId ?? usable[0]?.id;
  const covered = new Set(summary.data?.members.find((m) => m.memberId === who)?.categories.map((c) => c.category) ?? []);
  const coveredFirst = [...BENEFIT_CATEGORIES].sort((a, b) => Number(covered.has(b)) - Number(covered.has(a)));
  const shown = showAll ? coveredFirst : coveredFirst.filter((c) => covered.has(c) || c === category);

  async function run(drafts: OptionDraft[]) {
    if (!who || !category) return;
    setBusy(true);
    setError(undefined);
    try {
      const res = await api<BeforeBookingDto>("POST", "/v1/before-booking", {
        memberId: who,
        category,
        sessions: Math.max(1, Math.min(50, Math.round(Number(sessions) || 1))),
        options: drafts
          .map((o) => ({ label: o.label.trim() || undefined, priceAgorot: ilsToAgorot(Number(o.price.replace(",", "."))), kind: o.kind }))
          .filter((o) => o.priceAgorot > 0),
      });
      setResult(res);
      if (drafts.length === 0) setOptions([{ label: "", price: shekels(res.suggestedPriceAgorot), kind: "private" }]);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  // A new person or service starts from what this family usually pays.
  useEffect(() => {
    setResult(null);
    setOptions([]);
    void run([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [who, category]);

  const update = (i: number, patch: Partial<OptionDraft>) => setOptions((list) => list.map((o, j) => (j === i ? { ...o, ...patch } : o)));

  if (members.isLoading) return <Loading />;

  return (
    <Screen>
      <Title sub="כמה זה יעלה לכם באמת אחרי ההחזרים, ומה להכין מראש">לפני שקובעים תור</Title>

      <Card>
        {usable.length > 1 ? (
          <>
            <Text style={label}>על מי?</Text>
            <Row>
              {usable.map((m) => (
                <Chip key={m.id} label={m.fullName} selected={who === m.id} onPress={() => setMemberId(m.id)} />
              ))}
            </Row>
          </>
        ) : null}
        <Text style={label}>איזה שירות?</Text>
        <Row>
          {shown.map((c) => (
            <Chip
              key={c}
              label={`${CATEGORY_INFO[c].icon} ${CATEGORY_INFO[c].label}${covered.has(c) ? "" : " (לא מכוסה)"}`}
              selected={category === c}
              onPress={() => setCategory(c)}
            />
          ))}
        </Row>
        <Button
          title={showAll ? "רק שירותים מכוסים" : covered.size ? "עוד שירותים" : "כל השירותים"}
          variant="ghost"
          onPress={() => setShowAll((v) => !v)}
        />
      </Card>

      {!category ? <Body muted>בחרו שירות כדי לראות כמה הוא יעלה לכם.</Body> : null}
      {busy && !result ? <Loading label="מחשבים..." /> : null}

      {result ? (
        <>
          <Card>
            <Text style={heading}>איפה שוקלים לקבוע?</Text>
            <Body muted>
              {result.suggestedFrom === "history"
                ? `לפי מה ששילמתם עד היום (${result.history!.visits === 1 ? "ביקור אחד" : `${result.history!.visits} ביקורים`}). אפשר לשנות.`
                : "מחיר לדוגמה. הזינו את המחיר שקיבלתם, ואפשר להשוות עד 3 מקומות."}
            </Body>
            {options.map((o, i) => (
              <View key={i} style={optionBox}>
                <Spread>
                  <Row>
                    <Chip label="פרטי" selected={o.kind === "private"} onPress={() => update(i, { kind: "private" })} />
                    <Chip label="בהסדר (השתתפות עצמית)" selected={o.kind === "network"} onPress={() => update(i, { kind: "network" })} />
                  </Row>
                  {options.length > 1 ? (
                    <Pressable
                      onPress={() => setOptions((list) => list.filter((_, j) => j !== i))}
                      accessibilityRole="button"
                      accessibilityLabel="הסרת המקום"
                      hitSlop={10}
                    >
                      <Text style={{ fontSize: 18, color: colors.muted }}>✕</Text>
                    </Pressable>
                  ) : null}
                </Spread>
                <Row>
                  <View style={{ flex: 1 }}>
                    <Field label="שם (לא חובה)" value={o.label} onChangeText={(v) => update(i, { label: v })} placeholder="למשל ד״ר כהן" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Field
                      label={o.kind === "network" ? "השתתפות עצמית (₪)" : "מחיר לביקור (₪)"}
                      value={o.price}
                      onChangeText={(v) => update(i, { price: v })}
                      keyboardType="decimal-pad"
                    />
                  </View>
                </Row>
              </View>
            ))}
            <Row>
              {options.length < 3 ? (
                <Button
                  title="+ מקום נוסף להשוואה"
                  variant="ghost"
                  onPress={() => setOptions((list) => [...list, { label: "", price: "", kind: "private" }])}
                />
              ) : null}
              <View style={{ width: 120 }}>
                <Field label="כמה מפגשים" value={sessions} onChangeText={setSessions} keyboardType="number-pad" />
              </View>
            </Row>
            <Button title="כמה זה יעלה לנו?" onPress={() => void run(options)} loading={busy} />
          </Card>

          {result.options.map((o, i) => (
            <Card key={i} tone={o.best ? "money" : undefined}>
              <Spread>
                <Text style={{ fontSize: type.body, fontWeight: "700", color: colors.text, flex: 1 }}>
                  {o.label}
                  {result.sessions > 1 ? ` · ${result.sessions} מפגשים` : ""}
                </Text>
                {o.best ? <Badge label="הכי משתלם" tone="money" /> : null}
              </Spread>
              <Spread>
                <Body muted>
                  משלמים {formatILS(o.priceAgorot)}
                  {o.kind === "private" ? ` · מקבלים בחזרה ${formatILS(o.refundAgorot)}` : " · בלי תביעה"}
                </Body>
              </Spread>
              <Text style={{ fontSize: type.title, fontWeight: "800", color: colors.text }} accessibilityLabel={`עולה לכם ${formatILS(o.netAgorot)}`}>
                עולה לכם {formatILS(o.netAgorot)}
              </Text>
              {o.legs.map((l, j) => (
                <Text key={j} style={{ fontSize: type.caption, color: colors.muted }}>
                  {j + 1}. {l.planName}: {formatILS(l.amountAgorot)} ({l.basis})
                </Text>
              ))}
            </Card>
          ))}

          {result.maxRefund ? (
            <Card tone="primary">
              <Body>
                💡 ההחזר המרבי ל{CATEGORY_INFO[result.category].label}: <Text style={{ fontWeight: "800" }}>{formatILS(result.maxRefund.refundAgorot)}</Text> לביקור,
                במחיר {formatILS(result.maxRefund.fromPriceAgorot)} ומעלה. מעל המחיר הזה כל שקל יוצא מהכיס.
              </Body>
            </Card>
          ) : null}

          {result.quota.some((q) => q.perYear !== null || q.capLeftAgorot !== null) ? (
            <Card>
              <Text style={heading}>📅 מה נשאר השנה ל{result.memberName}</Text>
              {result.quota.map((q, i) => (
                <Body key={i}>
                  {q.planName}:{" "}
                  {q.sessionsLeft !== null ? `${q.sessionsLeft} מתוך ${q.perYear} מפגשים` : "בלי הגבלת מפגשים"}
                  {q.capLeftAgorot !== null ? ` · עד ${formatILS(q.capLeftAgorot)}` : ""}
                </Body>
              ))}
              {result.renewsOn ? <Body muted>המכסה מתחדשת ב-{result.renewsOn.split("-").reverse().join("/")}</Body> : null}
            </Card>
          ) : null}

          <Card tone="warning">
            <Text style={heading}>✅ מה להכין</Text>
            {result.checklist.map((c, i) => (
              <Body key={i}>{c}</Body>
            ))}
          </Card>

          {result.notes.map((n, i) => (
            <Body key={i} muted>
              {n}
            </Body>
          ))}
          <Body muted>החישוב לפי תנאי הביטוחים שהוזנו והניצול השנה. זו הערכה ומידע בלבד – לא ייעוץ ביטוחי.</Body>
          {result.covered ? <Button title="אחרי הביקור: צלמו קבלה" icon="📷" variant="secondary" onPress={() => router.push("/capture")} /> : null}
        </>
      ) : null}
      {error ? <Body style={{ color: colors.danger }}>{error}</Body> : null}
    </Screen>
  );
}

const label = { fontSize: type.small, color: colors.muted, fontWeight: "600" as const, marginVertical: space.sm };
const heading = { fontSize: type.body, fontWeight: "800" as const, color: colors.text, marginBottom: space.xs };
const optionBox = { borderTopWidth: 1, borderColor: colors.border, paddingTop: space.sm, marginTop: space.sm, gap: space.xs };
