import { Platform } from "react-native";
import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";
import type { MeDto } from "@magiali/shared";
import { api, API_URL } from "../api/client";

type SetupStatus = "pending" | "completed" | "failed";
const RETURN_KEY = "magiali.paymentReturnTo";

/** Polls until the payment provider confirms (or rejects) the card. */
export async function waitForCardSetup(setupId: string, timeoutMs = 60_000): Promise<{ status: SetupStatus; me?: MeDto }> {
  const started = Date.now();
  for (;;) {
    const res = await api<{ status: SetupStatus; me?: MeDto }>("GET", `/v1/payment-methods/setup/${setupId}`);
    if (res.status !== "pending" || Date.now() - started > timeoutMs) return res;
    await new Promise((r) => setTimeout(r, 1500));
  }
}

/**
 * Opens the payment provider's secure page to save a card (nothing is charged). The card number is typed there,
 * never in our app. On native the page opens in an in-app browser session that closes when it redirects back;
 * on web the tab navigates there and comes back to /payment-return.
 */
export async function saveCardWithProvider(returnTo: string): Promise<{ status: SetupStatus | "cancelled"; me?: MeDto }> {
  const native = Platform.OS !== "web";
  const returnUrl = native ? Linking.createURL("payment-return") : undefined;
  const { setupId, url } = await api<{ setupId: string; url: string }>("POST", "/v1/payment-methods/setup", {
    platform: native ? "native" : "web",
    returnUrl,
  });
  const pageUrl = url.startsWith("/") ? `${API_URL}${url}` : url;

  if (!native) {
    try {
      globalThis.sessionStorage?.setItem(RETURN_KEY, returnTo);
    } catch {
      // private mode: the return screen falls back to home
    }
    globalThis.location?.assign(pageUrl);
    return { status: "pending" };
  }

  const result = await WebBrowser.openAuthSessionAsync(pageUrl, returnUrl);
  if (result.type !== "success") {
    // Closed without finishing – the provider may still have saved it (e.g. the redirect was missed).
    const check = await api<{ status: SetupStatus; me?: MeDto }>("GET", `/v1/payment-methods/setup/${setupId}`);
    return check.status === "completed" ? check : { status: "cancelled" };
  }
  return waitForCardSetup(setupId);
}

/** Where the web flow should land after the provider sends the browser back. */
export function takeWebReturnPath(): string {
  try {
    const path = globalThis.sessionStorage?.getItem(RETURN_KEY);
    globalThis.sessionStorage?.removeItem(RETURN_KEY);
    return path && path.startsWith("/") ? path : "/";
  } catch {
    return "/";
  }
}
