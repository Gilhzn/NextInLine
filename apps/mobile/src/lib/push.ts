import { Platform } from "react-native";
import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { api } from "../api/client";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

/**
 * Registers this device for push. Silently skips where push is unavailable
 * (simulators, web, or dev builds without an EAS project id).
 */
export async function registerForPush(): Promise<void> {
  if (Platform.OS === "web" || !Device.isDevice) return;
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("default", {
      name: "עדכוני תביעות",
      importance: Notifications.AndroidImportance.HIGH,
    });
  }
  const current = await Notifications.getPermissionsAsync();
  const granted = current.granted || (await Notifications.requestPermissionsAsync()).granted;
  if (!granted) return;
  const projectId = (Constants.expoConfig?.extra?.eas as { projectId?: string } | undefined)?.projectId;
  if (!projectId) return;
  const token = await Notifications.getExpoPushTokenAsync({ projectId });
  await api("POST", "/v1/push-tokens", { expoToken: token.data, platform: Platform.OS });
}
