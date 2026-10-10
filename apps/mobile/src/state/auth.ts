import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";
import { create } from "zustand";

const KEY = "magiali.session";

/** Tokens live in the Keychain / Keystore on devices. The web build (used for previews) falls back to localStorage. */
const storage = {
  async get(): Promise<string | null> {
    if (Platform.OS === "web") return globalThis.localStorage?.getItem(KEY) ?? null;
    return SecureStore.getItemAsync(KEY);
  },
  async set(value: string): Promise<void> {
    if (Platform.OS === "web") return globalThis.localStorage?.setItem(KEY, value);
    await SecureStore.setItemAsync(KEY, value);
  },
  async clear(): Promise<void> {
    if (Platform.OS === "web") return globalThis.localStorage?.removeItem(KEY);
    await SecureStore.deleteItemAsync(KEY);
  },
};

interface AuthState {
  hydrated: boolean;
  accessToken: string | null;
  refreshToken: string | null;
  hydrate(): Promise<void>;
  setTokens(accessToken: string, refreshToken: string): Promise<void>;
  signOut(): Promise<void>;
}

export const useAuth = create<AuthState>((set) => ({
  hydrated: false,
  accessToken: null,
  refreshToken: null,
  async hydrate() {
    try {
      const raw = await storage.get();
      const parsed = raw ? (JSON.parse(raw) as { accessToken: string; refreshToken: string }) : null;
      set({ hydrated: true, accessToken: parsed?.accessToken ?? null, refreshToken: parsed?.refreshToken ?? null });
    } catch {
      set({ hydrated: true, accessToken: null, refreshToken: null });
    }
  },
  async setTokens(accessToken, refreshToken) {
    await storage.set(JSON.stringify({ accessToken, refreshToken }));
    set({ accessToken, refreshToken });
  },
  async signOut() {
    await storage.clear();
    set({ accessToken: null, refreshToken: null });
  },
}));
