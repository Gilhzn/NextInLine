import { Platform } from "react-native";
import type { ApiErrorBody } from "@magiali/shared";
import { useAuth } from "../state/auth";

export const API_URL = (process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:4000").replace(/\/$/, "");

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

let refreshing: Promise<boolean> | null = null;

/** Single-flight refresh: concurrent 401s share one refresh call. */
async function refreshSession(): Promise<boolean> {
  if (!refreshing) {
    refreshing = (async () => {
      const { refreshToken, setTokens, signOut } = useAuth.getState();
      if (!refreshToken) return false;
      try {
        const res = await fetch(`${API_URL}/v1/auth/refresh`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ refreshToken }),
        });
        if (!res.ok) {
          await signOut();
          return false;
        }
        const body = (await res.json()) as { accessToken: string; refreshToken: string };
        await setTokens(body.accessToken, body.refreshToken);
        return true;
      } catch {
        return false;
      }
    })().finally(() => {
      refreshing = null;
    });
  }
  return refreshing;
}

async function send(method: Method, path: string, body: unknown, form: FormData | undefined, retry: boolean): Promise<Response> {
  const token = useAuth.getState().accessToken;
  const headers: Record<string, string> = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (body !== undefined && !form) headers["content-type"] = "application/json";
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method,
      headers,
      body: form ?? (body !== undefined ? JSON.stringify(body) : undefined),
    });
  } catch {
    throw new ApiError(0, "network", "אין חיבור לשרת. בדוק את החיבור לאינטרנט");
  }
  if (res.status === 401 && retry && (await refreshSession())) {
    return send(method, path, body, form, false);
  }
  return res;
}

export async function api<T>(method: Method, path: string, body?: unknown): Promise<T> {
  return parse<T>(await send(method, path, body, undefined, true));
}

export async function upload<T>(
  path: string,
  file: { uri: string; mimeType: string; name: string },
  fields: Record<string, string> = {},
): Promise<T> {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  if (Platform.OS === "web") {
    const blob = await (await fetch(file.uri)).blob();
    form.append("file", new Blob([blob], { type: file.mimeType }), file.name);
  } else {
    // React Native's FormData accepts a { uri, name, type } descriptor for files.
    form.append("file", { uri: file.uri, name: file.name, type: file.mimeType } as unknown as Blob);
  }
  return parse<T>(await send("POST", path, undefined, form, true));
}

async function parse<T>(res: Response): Promise<T> {
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  const data = text ? (JSON.parse(text) as unknown) : undefined;
  if (!res.ok) {
    const err = (data as ApiErrorBody | undefined)?.error;
    throw new ApiError(res.status, err?.code ?? "internal", err?.message ?? "משהו השתבש. נסה שוב", err?.details);
  }
  return data as T;
}

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  return "משהו השתבש. נסה שוב";
}
