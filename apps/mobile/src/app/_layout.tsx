import { useEffect } from "react";
import { I18nManager, Platform } from "react-native";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { useAuth } from "../state/auth";
import { colors } from "../theme";
import { ApiError } from "../api/client";
import { Loading } from "../ui";
import { initMonitoring, wrapRoot } from "../lib/monitoring";

initMonitoring();

// Hebrew-first app: native builds are forced RTL via the expo-localization plugin; this covers Expo Go.
if (Platform.OS !== "web" && !I18nManager.isRTL) {
  I18nManager.allowRTL(true);
  I18nManager.forceRTL(true);
}
if (Platform.OS === "web" && typeof document !== "undefined") {
  document.documentElement.dir = "rtl";
  document.documentElement.lang = "he";
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: (count, error) => !(error instanceof ApiError && error.status >= 400 && error.status < 500) && count < 2,
    },
  },
});

function RootLayout() {
  const hydrate = useAuth((s) => s.hydrate);
  const accessToken = useAuth((s) => s.accessToken);
  const hydrated = useAuth((s) => s.hydrated);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  // Signing out (or a failed refresh) drops every cached query.
  useEffect(() => {
    if (!accessToken) queryClient.clear();
  }, [accessToken]);

  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <StatusBar style="dark" />
        {/* Screens mount only after the stored session is loaded, so a deep link's first request carries the token. */}
        {!hydrated ? <Loading /> : <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: colors.bg },
            headerTintColor: colors.primary,
            headerBackTitle: "חזרה",
          }}
        >
          <Stack.Screen name="receipt/[id]" options={{ headerShown: true, title: "בדיקת קבלה" }} />
          <Stack.Screen name="claim/[id]" options={{ headerShown: true, title: "התביעה" }} />
          <Stack.Screen name="pack/[claimId]/[legId]" options={{ headerShown: true, title: "תיק מוכן להגשה" }} />
          <Stack.Screen name="member/[id]" options={{ headerShown: true, title: "בן משפחה" }} />
          <Stack.Screen name="member/new" options={{ headerShown: true, title: "הוספת בן משפחה" }} />
          <Stack.Screen name="settings" options={{ headerShown: true, title: "הגדרות" }} />
          <Stack.Screen name="notifications" options={{ headerShown: true, title: "התראות" }} />
        </Stack>}
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}

export default wrapRoot(RootLayout);
