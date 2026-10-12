import { useCallback, useState } from "react";
import { Text, View } from "react-native";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { formatILS, type MoneyDto, type MoneyServiceDto } from "@magiali/shared";
import { api, errorMessage } from "../api/client";
import { colors, radius, space, type } from "../theme";
import { Badge, Body, Button, Card, Chip, ErrorView, Loading, Row, Screen, Spread, Title } from "../ui";
import { MoneyItemCard } from "../ui/MoneyItem";

type Range = MoneyDto["range"];

const BUCKETS = [
  { key: "missed", icon: "🟠", title: "פספסנו", sub: "כסף שהיה מגיע לנו ועוד אפשר להשיג", empty: "לא מצאנו כסף שפספסתם 👏", color: colors.warning, soft: colors.warningSoft },
  { key: "waiting", icon: "🟢", title: "מחכה לנו", sub: "תביעות שכבר בדרך, או שנשאר רק לסיים", empty: "אין כרגע תביעות פתוחות", color: colors.money, soft: colors.moneySoft },
  { key: "save", icon: "🔵", title: "אפשר לחסוך", sub: "הטבות שמגיעות לכם ועוד לא ניצלתם", empty: "אין המלצות כרגע", color: colors.primary, soft: colors.primarySoft },
] as const;

/**
 * "Our health money": one screen that answers where the family's health money went, what we missed, what is on its
 * way and where we can save – by person and by service. Information only: we never advise buying or cancelling insurance.
 */
export default function Money() {
  // Opened from a tile on the home screen: that bucket only, the rest one tap away.
  const params = useLocalSearchParams<{ bucket?: string }>();
  const [focus, setFocus] = useState(BUCKETS.find((b) => b.key === params.bucket)?.key ?? null);
  const [range, setRange] = useState<Range>("year");
  const [openServices, setOpenServices] = useState(false);
  const money = useQuery({ queryKey: ["money", range], queryFn: () => api<MoneyDto>("GET", `/v1/money?range=${range}`) });

  // Coming back from a receipt or a claim should show the new state.
  useFocusEffect(
    useCallback(() => {
      void money.refetch();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []),
  );

  if (money.isLoading) return <Loading />;
  if (money.error || !money.data) return <Screen><ErrorView message={errorMessage(money.error)} onRetry={() => void money.refetch()} /></Screen>;
  const d = money.data;
  const back = d.refundedAgorot + d.waitingAgorot;
  const share = d.paidAgorot > 0 ? Math.min(1, back / d.paidAgorot) : 0;

  return (
    <Screen>
      <Title sub="איפה הכסף שלנו על בריאות, מה פספסנו ואיפה אפשר לחסוך">הכסף הבריאותי שלנו</Title>

      <Row>
        <Chip label="השנה" selected={range === "year"} onPress={() => setRange("year")} />
        <Chip label="3 השנים האחרונות" selected={range === "3y"} onPress={() => setRange("3y")} />
      </Row>

      <Card>
        <Spread>
          <Stat label="שילמנו" agorot={d.paidAgorot} color={colors.text} />
          <Stat label="קיבלנו בחזרה" agorot={d.refundedAgorot} color={colors.money} />
          <Stat label="בדרך" agorot={d.waitingAgorot} color={colors.primary} />
        </Spread>
        {d.paidAgorot > 0 ? (
          <>
            <View style={bar} accessibilityLabel={`חזר או בדרך ${Math.round(share * 100)} אחוז ממה ששילמנו`}>
              <View style={{ width: `${share * 100}%`, backgroundColor: colors.money, height: "100%", borderRadius: radius }} />
            </View>
            <Body muted>חזר אלינו או בדרך: {Math.round(share * 100)}% ממה ששילמנו (לפי הקבלות באפליקציה)</Body>
          </>
        ) : (
          <Body muted>עוד אין קבלות בתקופה הזו. צלמו קבלות, או סרקו את פירוט האשראי כדי למצוא תשלומים שפספסתם.</Body>
        )}
      </Card>

      {focus ? (
        <Button title="להציג את כל הכסף שלנו" variant="ghost" onPress={() => setFocus(null)} />
      ) : null}
      {BUCKETS.filter((b) => !focus || b.key === focus).map((b) => {
        const bucket = d[b.key];
        return (
          <View key={b.key} style={{ marginTop: space.md }}>
            <Spread>
              <Text style={{ fontSize: type.title - 2, fontWeight: "800", color: colors.text }}>
                {b.icon} {b.title}
              </Text>
              {bucket.totalAgorot > 0 ? <Text style={{ fontSize: type.body, fontWeight: "800", color: b.color }}>{formatILS(bucket.totalAgorot)}</Text> : null}
            </Spread>
            <Body muted>{b.sub}</Body>
            {bucket.items.length === 0 ? (
              <Card>
                <Body muted>{b.empty}</Body>
              </Card>
            ) : (
              bucket.items.map((item, i) => <MoneyItemCard key={`${item.kind}-${i}`} item={item} color={b.color} />)
            )}
          </View>
        );
      })}

      {focus ? null : (
        <View style={{ marginTop: space.lg }}>
          <Text style={{ fontSize: type.title - 2, fontWeight: "800", color: colors.text }}>🩺 השירותים שלנו</Text>
          <Body muted>לכל אחד במשפחה: על מה שילמנו, כמה חזר ומה עוד אפשר לקבל</Body>
          {d.services.length === 0 ? (
            <Card>
              <Body muted>יופיע כאן אחרי שתצלמו קבלות.</Body>
            </Card>
          ) : (
            <>
              {(openServices ? d.services : d.services.slice(0, 5)).map((s) => (
                <ServiceRow key={`${s.memberId}-${s.category}`} s={s} showName={new Set(d.services.map((x) => x.memberId)).size > 1} />
              ))}
              {d.services.length > 5 ? (
                <Button title={openServices ? "פחות" : `עוד ${d.services.length - 5} שירותים`} variant="ghost" onPress={() => setOpenServices((v) => !v)} />
              ) : null}
            </>
          )}
        </View>
      )}

      <View style={{ marginTop: space.lg }}>
        <Card tone="primary" onPress={() => router.push("/scan-card")}>
          <Spread>
            <Body style={{ flex: 1, fontWeight: "700" }}>💳 סריקת פירוט כרטיס האשראי</Body>
            <Text style={{ color: colors.primary, fontWeight: "700" }}>←</Text>
          </Spread>
          <Body muted>נמצא תשלומים לרופאים, מכונים וטיפולים שאין עליהם קבלה באפליקציה</Body>
        </Card>

        <Card onPress={() => router.push("/premiums")}>
          <Spread>
            <Body style={{ flex: 1, fontWeight: "700" }}>💼 מה הביטוחים נותנים לנו</Body>
            <Text style={{ color: colors.primary, fontWeight: "700" }}>←</Text>
          </Spread>
          <Body muted>כמה שילמנו על כל ביטוח מול כמה הוא החזיר</Body>
        </Card>
      </View>

      <Body muted>
        המספרים מחושבים לפי הקבלות באפליקציה ותנאי הביטוחים שהוזנו, והם הערכה. זה מידע בלבד ולא ייעוץ ביטוחי.
      </Body>
    </Screen>
  );
}

function Stat({ label, agorot, color }: { label: string; agorot: number; color: string }) {
  return (
    <View style={{ alignItems: "center", flex: 1 }}>
      <Text style={{ fontSize: type.caption, color: colors.muted }}>{label}</Text>
      <Text style={{ fontSize: type.body + 1, fontWeight: "800", color }}>{formatILS(agorot)}</Text>
    </View>
  );
}

function ServiceRow({ s, showName }: { s: MoneyServiceDto; showName: boolean }) {
  const back = s.refundedAgorot + s.waitingAgorot;
  return (
    <Card>
      <Spread>
        <Text style={{ fontSize: type.body, fontWeight: "700", color: colors.text, flex: 1 }}>
          {s.icon} {s.label}
          {showName ? <Text style={{ color: colors.muted, fontWeight: "400" }}> · {s.memberName}</Text> : null}
        </Text>
        {!s.covered ? <Badge label="לא מכוסה" tone="muted" /> : null}
      </Spread>
      <Body muted>
        {s.visits} ביקורים · שילמנו {formatILS(s.paidAgorot)} · חזר {formatILS(back)}
      </Body>
      {s.unclaimedAgorot > 0 ? (
        <Text style={{ fontSize: type.small, color: colors.warning, fontWeight: "700" }}>עוד אפשר לקבל: {formatILS(s.unclaimedAgorot)}</Text>
      ) : null}
    </Card>
  );
}

const bar = { height: 10, backgroundColor: colors.border, borderRadius: radius, overflow: "hidden" as const, marginTop: space.md };
