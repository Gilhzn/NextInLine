import { Alert, Platform } from "react-native";

/** A yes/no question before a destructive or irreversible action. */
export function confirm(title: string, message: string, okLabel = "אישור"): Promise<boolean> {
  if (Platform.OS === "web") return Promise.resolve(globalThis.confirm?.(`${title}\n\n${message}`) ?? false);
  return new Promise((resolve) =>
    Alert.alert(title, message, [
      { text: "ביטול", style: "cancel", onPress: () => resolve(false) },
      { text: okLabel, style: "destructive", onPress: () => resolve(true) },
    ]),
  );
}
