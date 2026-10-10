import { Platform } from "react-native";
import * as WebBrowser from "expo-web-browser";
import { API_URL } from "../api/client";

export type LegalDoc = "terms" | "privacy" | "poa" | "accessibility" | "delete-account";

export const legalUrl = (doc: LegalDoc) => `${API_URL || (Platform.OS === "web" ? globalThis.location?.origin ?? "" : "")}/legal/${doc}`;

/** Opens a legal page in the in-app browser (a new tab on web). */
export function openLegal(doc: LegalDoc): void {
  const url = legalUrl(doc);
  if (Platform.OS === "web") globalThis.open?.(url, "_blank", "noopener");
  else void WebBrowser.openBrowserAsync(url);
}
