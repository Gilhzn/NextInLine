import { useEffect } from "react";
import { Platform, Text } from "react-native";
import { Redirect, router, Tabs } from "expo-router";
import * as Notifications from "expo-notifications";
import { registerForPush } from "../../lib/push";
import { useAuth } from "../../state/auth";
import { colors } from "../../theme";

const icon = (glyph: string) =>
  function TabIcon({ focused }: { focused: boolean }) {
    return <Text style={{ fontSize: 22, opacity: focused ? 1 : 0.55 }}>{glyph}</Text>;
  };

export default function TabsLayout() {
  const token = useAuth((s) => s.accessToken);

  useEffect(() => {
    if (!token) return;
    registerForPush().catch(() => {});
    if (Platform.OS === "web") return;
    // Tapping a notification opens the claim or receipt it is about.
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data as { claimId?: string; receiptId?: string };
      if (data.claimId) router.push(`/claim/${data.claimId}`);
      else if (data.receiptId) router.push(`/receipt/${data.receiptId}`);
    });
    return () => sub.remove();
  }, [token]);

  if (!token) return <Redirect href="/welcome" />;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.muted,
        tabBarLabelStyle: { fontSize: 12, fontWeight: "600" },
        tabBarStyle: { height: Platform.OS === "ios" ? 88 : 64, paddingTop: 6 },
      }}
    >
      <Tabs.Screen name="home" options={{ title: "בית", tabBarIcon: icon("🏠") }} />
      <Tabs.Screen name="claims" options={{ title: "תביעות", tabBarIcon: icon("📋") }} />
      <Tabs.Screen name="capture" options={{ title: "צלם", tabBarIcon: icon("📷") }} />
      <Tabs.Screen name="benefits" options={{ title: "כיסויים", tabBarIcon: icon("🛡") }} />
      <Tabs.Screen name="household" options={{ title: "משפחה", tabBarIcon: icon("👨‍👩‍👧") }} />
    </Tabs>
  );
}
