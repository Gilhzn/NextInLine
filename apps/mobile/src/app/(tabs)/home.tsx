import { Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { router } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { formatILS } from "@magiali/shared";
import { errorMessage } from "../../api/client";
import { useHome, useMe } from "../../api/hooks";
import { colors, space, type } from "../../theme";
import { Body, Button, Card, ErrorView, Loading, Spread } from "../../ui";

const ACTION_ICON = { missing_document: "📎", ready_to_submit: "📤", confirm_receipt: "🧾", consent_pending: "⏳" } as const;

export default function Home() {
  const home = useHome();
  const me = useMe();
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
        refreshControl={<RefreshControl refreshing={home.isRefetching} onRefresh={() => void home.refetch()} />}
      >
        <Spread style={{ marginBottom: space.lg }}>
          <Text style={{ fontSize: type.title, fontWeight: "800", color: colors.text }}>שלום{name ? ` ${name}` : ""} 👋</Text>
          <Pressable onPress={() => router.push("/settings")} accessibilityRole="button" accessibilityLabel="הגדרות" hitSlop={12}>
            <Text style={{ fontSize: 24 }}>⚙️</Text>
          </Pressable>
        </Spread>

        {home.isLoading ? <Loading /> : null}
        {home.error ? <ErrorView message={errorMessage(home.error)} onRetry={() => void home.refetch()} /> : null}

        {home.data ? (
          <>
            <Card tone="money" style={{ alignItems: "center", paddingVertical: space.xl }}>
              <Text style={{ fontSize: type.small, color: colors.muted }}>החזרנו לכם השנה</Text>
              <Text style={{ fontSize: type.money + 6, fontWeight: "800", color: colors.money }} accessibilityLabel={`החזרנו לכם השנה ${formatILS(home.data.yearPaidAgorot)}`}>
                {formatILS(home.data.yearPaidAgorot)} 📈
              </Text>
              {home.data.inFlightCount > 0 ? (
                <Body muted>
                  בדרך אליכם: {formatILS(home.data.inFlightAgorot)} ({home.data.inFlightCount} תביעות)
                </Body>
              ) : null}
            </Card>

            {home.data.actionItems.length > 0 ? (
              <View style={{ marginTop: space.md }}>
                <Text style={sectionTitle}>צריך אותך ({home.data.actionItems.length})</Text>
                {home.data.actionItems.map((item, i) => (
                  <Card key={`${item.type}-${i}`} tone="warning" onPress={() => open(item)}>
                    <Spread>
                      <Body style={{ flex: 1 }}>
                        {ACTION_ICON[item.type]} {item.title}
                      </Body>
                      {item.amountAgorot ? <Text style={{ fontWeight: "700", color: colors.text }}>{formatILS(item.amountAgorot)}</Text> : null}
                    </Spread>
                  </Card>
                ))}
              </View>
            ) : null}

            {home.data.opportunities.length > 0 ? (
              <View style={{ marginTop: space.md }}>
                <Text style={sectionTitle}>הזדמנויות</Text>
                {home.data.opportunities.map((o, i) => (
                  <Card key={i} tone="primary">
                    <Body style={{ fontWeight: "700" }}>{o.title}</Body>
                    <Body muted>{o.detail}</Body>
                  </Card>
                ))}
              </View>
            ) : null}

            {home.data.actionItems.length === 0 && home.data.yearPaidAgorot === 0 ? (
              <Card style={{ marginTop: space.md }}>
                <Body>היית אצל רופא פרטי, בטיפול או בבדיקה? צלם את הקבלה ונבדוק כמה מגיע לך.</Body>
                <Button title="צלם קבלה" icon="📷" onPress={() => router.push("/capture")} />
              </Card>
            ) : null}
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const sectionTitle = { fontSize: type.body, fontWeight: "800" as const, color: colors.text, marginBottom: space.sm };
