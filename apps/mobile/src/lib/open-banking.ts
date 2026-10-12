import { Platform } from "react-native";
import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";
import type { BankConnectionDto } from "@magiali/shared";
import { api, API_URL } from "../api/client";

/** Polls until the provider says the customer approved or declined. */
export async function waitForBankConnection(id: string, timeoutMs = 60_000): Promise<BankConnectionDto> {
  const started = Date.now();
  for (;;) {
    const c = await api<BankConnectionDto>("GET", `/v1/bank-connections/${id}`);
    if (c.status !== "pending" || Date.now() - started > timeoutMs) return c;
    await new Promise((r) => setTimeout(r, 1500));
  }
}

/**
 * Opens the licensed provider's consent page, where the customer picks banks and cards and approves read-only
 * access. Bank passwords are typed there (or at the bank), never in our app.
 */
export async function connectBank(): Promise<BankConnectionDto | { status: "cancelled" | "redirected" }> {
  const native = Platform.OS !== "web";
  const returnUrl = native ? Linking.createURL("bank-return") : undefined;
  const { connectionId, url } = await api<{ connectionId: string; url: string }>("POST", "/v1/bank-connections", {
    platform: native ? "native" : "web",
    returnUrl,
  });
  const pageUrl = url.startsWith("/") ? `${API_URL}${url}` : url;
  if (!native) {
    globalThis.location?.assign(pageUrl);
    return { status: "redirected" };
  }
  const result = await WebBrowser.openAuthSessionAsync(pageUrl, returnUrl);
  if (result.type !== "success") {
    const check = await api<BankConnectionDto>("GET", `/v1/bank-connections/${connectionId}`);
    return check.status === "active" ? check : { status: "cancelled" };
  }
  return waitForBankConnection(connectionId);
}
