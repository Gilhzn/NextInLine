import { Text, View } from "react-native";
import { router } from "expo-router";
import { errorMessage } from "../api/client";
import { useMarkNotificationRead, useNotifications, type NotificationItem, notificationScreen } from "../api/hooks";
import { colors, space, type } from "../theme";
import { Body, Card, ErrorView, Loading, Screen, Spread } from "../ui";

const ICON: Record<string, string> = {
  leg_paid: "💸",
  leg_rejected: "❌",
  missing_document: "📎",
  ready_to_submit: "📤",
  confirm_receipt: "🧾",
  receipt_ready: "🧾",
  consent_pending: "⏳",
  expiry_warning: "⏳",
  slow_payer: "🐢",
  fee_upcoming: "💳",
  fee_failed: "⚠️",
};

/** Some server titles already open with an emoji (e.g. "💸 200 ₪ הגיעו"). Hebrew and digits sit far below U+2100. */
const startsWithSymbol = (title: string) => (title.codePointAt(0) ?? 0) >= 0x2100;

function when(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("he-IL", { day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jerusalem" });
}

export default function Notifications() {
  const list = useNotifications();
  const markRead = useMarkNotificationRead();

  function open(n: NotificationItem) {
    if (!n.readAt) markRead.mutate(n.id);
    if (n.data?.claimId) router.push(`/claim/${n.data.claimId}`);
    else if (n.data?.receiptId) router.push(`/receipt/${n.data.receiptId}`);
    else if (n.data?.feeId) router.push("/settings");
    else if (n.data?.memberId) router.push(`/member/${n.data.memberId}`);
    else if (notificationScreen(n.data?.screen)) router.push(notificationScreen(n.data?.screen)!);
  }

  if (list.isLoading) return <Loading />;
  if (list.error) return <Screen><ErrorView message={errorMessage(list.error)} onRetry={() => void list.refetch()} /></Screen>;

  return (
    <Screen>
      {list.data?.length === 0 ? (
        <Card>
          <Body muted>אין עדיין התראות. כשמשהו יזוז בתביעות שלך, נעדכן כאן.</Body>
        </Card>
      ) : null}
      {list.data?.map((n) => (
        <Card key={n.id} onPress={() => open(n)} tone={n.readAt ? undefined : "primary"}>
          <Spread>
            <Text style={{ fontSize: type.body, fontWeight: n.readAt ? "600" : "800", color: colors.text, flex: 1 }}>
              {startsWithSymbol(n.title) ? n.title : `${ICON[n.type] ?? "🔔"} ${n.title}`}
            </Text>
            {!n.readAt ? <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: colors.primary }} accessibilityLabel="חדש" /> : null}
          </Spread>
          <Body muted>{n.body}</Body>
          <Text style={{ fontSize: type.small, color: colors.muted, marginTop: space.xs }}>{when(n.createdAt)}</Text>
        </Card>
      ))}
    </Screen>
  );
}
