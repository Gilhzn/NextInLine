import { useCallback } from "react";
import { Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { useQuery } from "@tanstack/react-query";
import { formatILS, type MoneyDto } from "@magiali/shared";
import { api, errorMessage } from "../../api/client";
import { useHome, useMe, useNotifications } from "../../api/hooks";
import { colors, radius, space, type } from "../../theme";
import { Body, Button, Card, ErrorView, Loading, Spread } from "../../ui";
import { MoneyItemCard } from "../../ui/MoneyItem";

export default function Home() {
  const home = useHome();
  const money = useQuery({ queryKey: ["money", "year"], queryFn: () => api<MoneyDto>("GET", "/v1/money?range=year") });
  // Back from a receipt or a claim: the numbers should already be updated.
  useFocusEffect(
    useCallback(() => {
      void money.refetch();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []),
  );
  const me = useMe();
  const notifications = useNotifications();
  const unread = notifications.data?.filter((n) => !n.readAt).length ?? 0;
  const name = me.data?.user.displayName?.split(" ")[0];

  function open(item: NonNullable<typeof home.data>["actionItems"][number]) {
    if (item.claimId) router.push(`/claim/${item.claimId}`);
    else if (item.receiptId) router.push(`/receipt/${item.receiptId}`);
    else if (item.memberId) router.push(`/member/${item.memberId}`);
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={["top"]}>
      <ScrollView
        contentContainerStyle={{ padding: space.lg, paddingBottom: space.xxl * 2 }}
        refreshControl={
          <RefreshControl
            refreshing={money.isRefetching}
            onRefresh={() => {
              void home.refetch();
              void money.refetch();
              void notifications.refetch();
            }}
          />
        }
      >
        <Spread style={{ marginBottom: space.lg }}>
          <Text style={{ fontSize: type.title, fontWeight: "800", color: colors.text }}>שלום{name ? ` ${name}` : ""} 👋</Text>
          <View style={{ flexDirection: "row", gap: space.md }}>
            <Pressable
              onPress={() => router.push("/notifications")}
              accessibilityRole="button"
              accessibilityLabel={unread ? `התראות, ${unread} חדשות` : "התראות"}
              hitSlop={12}
            >
              <Text style={{ fontSize: 24 }}>🔔</Text>
              {unread > 0 ? (
                <View style={bellBadge}>
                  <Text style={{ color: "#fff", fontSize: 11, fontWeight: "800" }}>{unread > 9 ? "9+" : unread}</Text>
                </View>
              ) : null}
            </Pressable>
            <Pressable onPress={() => router.push("/settings")} accessibilityRole="button" accessibilityLabel="הגדרות" hitSlop={12}>
              <Text style={{ fontSize: 24 }}>⚙️</Text>
            </Pressable>
          </View>
        </Spread>

        {home.isLoading || money.isLoading ? <Loading /> : null}
        {money.error ? <ErrorView message={errorMessage(money.error)} onRetry={() => void money.refetch()} /> : null}

        {money.data ? <MoneyMap money={money.data} yearPaidAgorot={home.data?.yearPaidAgorot ?? 0} /> : null}

        {/* Family members still waiting to approve by SMS – their money can't be calculated until they do. */}
        {home.data?.actionItems
          .filter((i) => i.type === "consent_pending")
          .map((item, i) => (
            <Card key={`consent-${i}`} tone="warning" onPress={() => open(item)}>
              <Body>⏳ {item.title}</Body>
            </Card>
          ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const bellBadge = {
  position: "absolute" as const,
  top: -4,
  end: -6,
  minWidth: 18,
  height: 18,
  borderRadius: 9,
  paddingHorizontal: 4,
  backgroundColor: colors.danger,
  alignItems: "center" as const,
  justifyContent: "center" as const,
};
const sectionTitle = { fontSize: type.body, fontWeight: "800" as const, color: colors.text, marginBottom: space.sm };

const TILES = [
  { key: "missed", icon: "🟠", label: "פספסנו", color: colors.warning, soft: colors.warningSoft },
  { key: "waiting", icon: "🟢", label: "בדרך אלינו", color: colors.money, soft: colors.moneySoft },
  { key: "save", icon: "🔵", label: "אפשר לחסוך", color: colors.primary, soft: colors.primarySoft },
] as const;

/**
 * The home screen answers one question: where is our money and how do we get it.
 * One number, three tiles (each opens its list), the next few actions, and where money may still be hiding.
 */
function MoneyMap({ money, yearPaidAgorot }: { money: MoneyDto; yearPaidAgorot: number }) {
  const open = money.missed.totalAgorot + money.waiting.totalAgorot;
  const unclaimed = money.missed.items.filter((i) => i.kind === "unclaimed_receipt").length;
  const noReceipt = money.missed.items.filter((i) => i.kind === "payment_without_receipt").length;
  const inFlight = money.waiting.items.length;
  const summary = [
    unclaimed ? `${unclaimed === 1 ? "קבלה אחת" : `${unclaimed} קבלות`} שלא נתבעו` : null,
    noReceipt ? `${noReceipt === 1 ? "תשלום אחד" : `${noReceipt} תשלומים`} בלי קבלה` : null,
    inFlight ? `${inFlight === 1 ? "תביעה אחת" : `${inFlight} תביעות`} בדרך` : null,
  ].filter(Boolean);
  const d = money.discovery;
  const discovery = [
    { done: d.receipts >= 3, icon: "🧾", title: "לצלם קבלות מ-3 השנים האחרונות", sub: "אפשר לתבוע עד 3 שנים אחורה", go: "/capture" },
    { done: d.policiesImported, icon: "📥", title: "לייבא את כל הביטוחים מהר הביטוח", sub: "2 דקות, וגם ביטוחים ששכחתם מופיעים", go: "/import" },
    { done: d.cardScanned, icon: "💳", title: "לסרוק את פירוט האשראי", sub: "נמצא תשלומים לרופאים שאין עליהם קבלה", go: "/scan-card" },
    { done: d.premiumsEntered, icon: "💼", title: "להזין כמה משלמים על הביטוחים", sub: "ונראה מה כל ביטוח החזיר מול מה שעלה", go: "/premiums" },
  ] as const;
  const todo = discovery.filter((x) => !x.done).length;

  return (
    <>
      {/* The headline is money already owed to the family; with none open, what came back this year. */}
      <Card tone="money" style={{ alignItems: "center", paddingVertical: space.xl }}>
        <Text style={{ fontSize: type.small, color: colors.muted }}>{open > 0 ? "מחכים לכם בערך" : "החזרנו לכם השנה"}</Text>
        <Text
          style={{ fontSize: type.money + 6, fontWeight: "800", color: colors.money }}
          accessibilityLabel={`${open > 0 ? "מחכים לכם בערך" : "החזרנו לכם השנה"} ${formatILS(open > 0 ? open : yearPaidAgorot)}`}
        >
          {formatILS(open > 0 ? open : yearPaidAgorot)}
        </Text>
        {summary.length ? <Body>{summary.join(" · ")}</Body> : null}
        {open > 0 ? <Body muted>החזרנו לכם השנה {formatILS(yearPaidAgorot)}</Body> : null}
        {money.save.totalAgorot > 0 ? (
          <Body muted>ועוד עד {formatILS(money.save.totalAgorot)} בהטבות שעוד לא ניצלתם</Body>
        ) : null}
      </Card>

      <View style={{ flexDirection: "row", gap: space.sm, marginTop: space.sm }}>
        {TILES.map((t) => (
          <Pressable
            key={t.key}
            onPress={() => router.push({ pathname: "/money", params: { bucket: t.key } })}
            accessibilityRole="button"
            accessibilityLabel={`${t.label} ${formatILS(money[t.key].totalAgorot)}`}
            style={({ pressed }) => [tile, { backgroundColor: t.soft, opacity: pressed ? 0.8 : 1 }]}
          >
            <Text style={{ fontSize: type.caption, color: colors.text, fontWeight: "700" }}>
              {t.icon} {t.label}
            </Text>
            <Text style={{ fontSize: type.body, fontWeight: "800", color: t.color }}>{formatILS(money[t.key].totalAgorot)}</Text>
            <Text style={{ fontSize: type.caption, color: colors.muted }}>
              {money[t.key].items.length === 0 ? "—" : money[t.key].items.length === 1 ? "פריט אחד ←" : `${money[t.key].items.length} פריטים ←`}
            </Text>
          </Pressable>
        ))}
      </View>

      <View style={{ marginTop: space.lg }}>
        <Text style={sectionTitle}>מה עושים עכשיו</Text>
        {money.nextSteps.length ? (
          money.nextSteps.map((item, i) => <MoneyItemCard key={`${item.kind}-${i}`} item={item} color={colors.money} />)
        ) : (
          <Card>
            <Body>אין משהו שמחכה לכם 👏 היית אצל רופא פרטי, בטיפול או בבדיקה? צלמו את הקבלה ונבדוק כמה מגיע.</Body>
            <Button title="צלם קבלה" icon="📷" onPress={() => router.push("/capture")} />
          </Card>
        )}
        <Button title="כל הכסף שלנו, לפי אדם ושירות" variant="ghost" onPress={() => router.push("/money")} />
      </View>

      {todo > 0 ? (
        <View style={{ marginTop: space.md }}>
          <Text style={sectionTitle}>איפה עוד מסתתר כסף? ({discovery.length - todo}/{discovery.length})</Text>
          <Card>
            {discovery.map((x) => (
              <Pressable
                key={x.go}
                onPress={x.done ? undefined : () => router.push(x.go)}
                disabled={x.done}
                accessibilityRole="button"
                accessibilityState={{ checked: x.done }}
                style={{ flexDirection: "row", gap: space.md, paddingVertical: space.sm, alignItems: "center" }}
              >
                <Text style={{ fontSize: 22 }}>{x.done ? "✅" : x.icon}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: type.body, fontWeight: "700", color: x.done ? colors.muted : colors.text }}>{x.title}</Text>
                  {x.done ? null : <Text style={{ fontSize: type.caption, color: colors.muted }}>{x.sub}</Text>}
                </View>
                {x.done ? null : <Text style={{ color: colors.primary, fontWeight: "800" }}>←</Text>}
              </Pressable>
            ))}
          </Card>
        </View>
      ) : null}

      <View style={{ flexDirection: "row", gap: space.sm, marginTop: space.md }}>
        <Card onPress={() => router.push("/before-booking")} style={{ flex: 1 }}>
          <Body style={{ fontWeight: "700" }}>🗓 לפני שקובעים תור</Body>
          <Text style={{ fontSize: type.caption, color: colors.muted }}>כמה זה יעלה אחרי ההחזרים</Text>
        </Card>
        <Card onPress={() => router.push("/entitlements")} style={{ flex: 1 }}>
          <Body style={{ fontWeight: "700" }}>📋 מה מגיע לנו</Body>
          <Text style={{ fontSize: type.caption, color: colors.muted }}>לפי ביטוח ובן משפחה</Text>
        </Card>
      </View>
    </>
  );
}

const tile = { flex: 1, borderRadius: radius, padding: space.sm, alignItems: "center" as const, gap: 2 };
