import { RefreshControl, ScrollView, Text } from "react-native";
import { router } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { CATEGORY_INFO, CLAIM_STATUS_LABEL, formatILS, type ClaimStatus } from "@magiali/shared";
import { errorMessage } from "../../api/client";
import { useClaims, useUnclaimedReceipts } from "../../api/hooks";
import { colors, space, type } from "../../theme";
import { Badge, Body, Card, ErrorView, Loading, Spread, Title } from "../../ui";

const STATUS_TONE: Record<ClaimStatus, "primary" | "money" | "warning" | "danger" | "muted"> = {
  draft: "muted",
  awaiting_documents: "warning",
  ready: "primary",
  in_progress: "primary",
  completed: "money",
  partially_paid: "money",
  rejected: "danger",
  cancelled: "muted",
};

export default function Claims() {
  const claims = useClaims();
  const receipts = useUnclaimedReceipts();
  const pending = (receipts.data ?? []).filter((r) => !r.confirmed);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={["top"]}>
      <ScrollView
        contentContainerStyle={{ padding: space.lg, paddingBottom: space.xxl * 2 }}
        refreshControl={
          <RefreshControl
            refreshing={claims.isRefetching}
            onRefresh={() => {
              void claims.refetch();
              void receipts.refetch();
            }}
          />
        }
      >
        <Title>התביעות שלי</Title>
        {pending.map((r) => (
          <Card key={r.id} tone="warning" onPress={() => router.push(`/receipt/${r.id}`)}>
            <Body>🧾 קבלה מחכה לאישור פרטים{r.amountAgorot ? ` · ${formatILS(r.amountAgorot)}` : ""}</Body>
          </Card>
        ))}
        {claims.isLoading ? <Loading /> : null}
        {claims.error ? <ErrorView message={errorMessage(claims.error)} onRetry={() => void claims.refetch()} /> : null}
        {claims.data?.length === 0 && pending.length === 0 ? <Body muted>עוד אין תביעות. צלם קבלה ונתחיל.</Body> : null}
        {claims.data?.map((c) => (
          <Card key={c.id} onPress={() => router.push(`/claim/${c.id}`)}>
            <Spread>
              <Text style={{ fontSize: type.body, fontWeight: "700", color: colors.text, flex: 1 }}>
                {CATEGORY_INFO[c.category].icon} {CATEGORY_INFO[c.category].label} · {c.privacyPrivate ? "תביעה פרטית" : c.memberName}
              </Text>
              <Badge label={CLAIM_STATUS_LABEL[c.status]} tone={STATUS_TONE[c.status]} />
            </Spread>
            <Spread>
              <Body muted>{c.providerName ?? ""}</Body>
              <Text style={{ fontWeight: "700", color: c.totalPaidAgorot > 0 ? colors.money : colors.text }}>
                {c.totalPaidAgorot > 0 ? `הגיעו ${formatILS(c.totalPaidAgorot)}` : `צפוי ${formatILS(c.totalExpectedAgorot)}`}
              </Text>
            </Spread>
          </Card>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}
