import { useTestCatalog } from "./catalog.fixture";
import { randomBytes } from "node:crypto";
import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import type { ExtractedFields } from "@magiali/shared";
import { buildApp } from "../src/app";
import { seedCatalog } from "../src/catalog";
import { loadConfig } from "../src/config";
import type { Deps } from "../src/context";
import { Crypto } from "../src/crypto";
import { createSql, migrate, type Sql } from "../src/db";
import { RetryableExtractionError, type ReceiptExtractor } from "../src/extraction";
import { MemoryEmail, MemoryPush, MemorySms, MemoryStorage, MockPayments } from "../src/providers";
import { runDueJobs } from "../src/services/jobs";

const ADMIN_URL = process.env.TEST_DATABASE_URL ?? "postgres://magiali:magiali@localhost:5432/postgres";
export const ADMIN_TOKEN = "test-admin-token-0123456789abcdef";

export class FakeExtractor implements ReceiptExtractor {
  readonly name = "fake";
  next: ExtractedFields | "retryable" | "fatal" = {
    isMedicalReceipt: true,
    providerName: "נוי לוי – קלינאית תקשורת",
    patientName: "נועה כהן",
    serviceDate: "2026-09-12",
    amountAgorot: 35000,
    sessions: 1,
    category: "child_development",
    description: "טיפול קלינאות תקשורת",
    confidence: { providerName: "high", serviceDate: "high", amountAgorot: "high", sessions: "medium", category: "high" },
  };
  calls = 0;
  async extract(): Promise<ExtractedFields> {
    this.calls++;
    if (this.next === "retryable") throw new RetryableExtractionError("overloaded");
    if (this.next === "fatal") throw new Error("bad image");
    return this.next;
  }
}

export interface TestEnv {
  app: FastifyInstance;
  deps: Deps;
  sql: Sql;
  sms: MemorySms;
  push: MemoryPush;
  email: MemoryEmail;
  payments: MockPayments;
  extractor: FakeExtractor;
  clock: { readonly now: Date; advanceDays(days: number): void };
  runJobs(): Promise<number>;
  close(): Promise<void>;
}

export async function createTestEnv(): Promise<TestEnv> {
  const dbName = `magiali_test_${randomBytes(6).toString("hex")}`;
  const admin = createSql(ADMIN_URL, { max: 1 });
  await admin.unsafe(`CREATE DATABASE ${dbName}`);
  const url = new URL(ADMIN_URL);
  url.pathname = `/${dbName}`;
  const sql = createSql(url.toString(), { max: 5 });
  await migrate(sql);
  await seedCatalog(sql);
  await useTestCatalog(sql);

  const config = loadConfig({
    NODE_ENV: "test",
    DATABASE_URL: url.toString(),
    JWT_SECRET: "test-jwt-secret-0123456789abcdef0123456789",
    OTP_PEPPER: "test-otp-pepper-0123456789",
    MASTER_KEY: randomBytes(32).toString("base64"),
    FILES_SIGNING_SECRET: "test-files-secret-0123456789abcdef0123",
    ADMIN_TOKEN,
    PUBLIC_BASE_URL: "http://localhost:4000",
    OTP_MAX_PER_IP_HOUR: "10000",
    OTP_ROUTE_LIMIT_PER_10MIN: "10000",
  });

  // Tracks real time plus an offset, so rows stamped by the database (now()) stay consistent with the app clock.
  let offsetMs = 0;
  const clock = {
    get now() {
      return new Date(Date.now() + offsetMs);
    },
    advanceDays(days: number) {
      offsetMs += days * 86_400_000;
    },
  };
  const sms = new MemorySms();
  const push = new MemoryPush();
  const email = new MemoryEmail();
  const payments = new MockPayments();
  const extractor = new FakeExtractor();
  const deps: Deps = {
    config,
    sql,
    crypto: new Crypto(config.MASTER_KEY),
    sms,
    storage: new MemoryStorage(),
    push,
    payments,
    email,
    extractor,
    now: () => clock.now,
  };
  const app = await buildApp(deps);

  return {
    app,
    deps,
    sql,
    sms,
    push,
    email,
    payments,
    extractor,
    clock,
    async runJobs() {
      let total = 0;
      for (let i = 0; i < 10; i++) {
        const n = await runDueJobs(deps);
        total += n;
        if (n === 0) break;
      }
      return total;
    },
    async close() {
      await app.close();
      await sql.end();
      await admin.unsafe(`DROP DATABASE ${dbName} WITH (FORCE)`);
      await admin.end();
    },
  };
}

/** Logs in by SMS code. By default also gives the consents a user gives at onboarding (opt out with `consents: []`). */
export async function login(
  env: TestEnv,
  phone = "0501234567",
  opts: { consents?: string[] } = {},
): Promise<{ token: string; refreshToken: string; me: any }> {
  const req = await env.app.inject({ method: "POST", url: "/v1/auth/otp/request", payload: { phone } });
  if (req.statusCode !== 204) throw new Error(`otp request failed: ${req.body}`);
  const e164 = `+972${phone.replace(/^0/, "")}`;
  const code = env.sms.lastCodeFor(e164);
  const res = await env.app.inject({ method: "POST", url: "/v1/auth/otp/verify", payload: { phone, code } });
  if (res.statusCode !== 200) throw new Error(`otp verify failed: ${res.body}`);
  const body = res.json();
  for (const kind of opts.consents ?? ["terms", "privacy", "medical_data", "ai_processing"]) {
    await env.app.inject({
      method: "POST",
      url: "/v1/consents",
      headers: { authorization: `Bearer ${body.accessToken}` },
      payload: { kind, version: "2026-10" },
    });
  }
  return { token: body.accessToken, refreshToken: body.refreshToken, me: body.me };
}

export function api(env: TestEnv, token: string) {
  const call = (method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", url: string, payload?: unknown) =>
    env.app.inject({ method, url, payload: payload as never, headers: { authorization: `Bearer ${token}` } });
  return {
    get: (url: string) => call("GET", url),
    post: (url: string, payload?: unknown) => call("POST", url, payload ?? {}),
    put: (url: string, payload?: unknown) => call("PUT", url, payload),
    patch: (url: string, payload?: unknown) => call("PATCH", url, payload),
    delete: (url: string) => call("DELETE", url),
    upload: (url: string, file: { data: Buffer; mimeType: string; filename?: string }, fields: Record<string, string> = {}) => {
      const boundary = `----magiali${randomBytes(8).toString("hex")}`;
      const parts: Buffer[] = [];
      for (const [k, v] of Object.entries(fields)) {
        parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
      }
      parts.push(
        Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.filename ?? "receipt.png"}"\r\n` +
            `Content-Type: ${file.mimeType}\r\n\r\n`,
        ),
        file.data,
        Buffer.from(`\r\n--${boundary}--\r\n`),
      );
      return env.app.inject({
        method: "POST",
        url,
        payload: Buffer.concat(parts),
        headers: { authorization: `Bearer ${token}`, "content-type": `multipart/form-data; boundary=${boundary}` },
      });
    },
  };
}

export const admin = (env: TestEnv) => ({
  post: (url: string, payload: unknown) =>
    env.app.inject({ method: "POST", url, payload: payload as never, headers: { "x-admin-token": ADMIN_TOKEN } }),
  get: (url: string) => env.app.inject({ method: "GET", url, headers: { "x-admin-token": ADMIN_TOKEN } }),
});

export function fakeImage(seed = "x"): Buffer {
  // Minimal PNG signature + unique bytes; the fake extractor never decodes it.
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from(`receipt-${seed}-${randomBytes(8).toString("hex")}`)]);
}

export function expectStatus(res: LightMyRequestResponse, status: number): any {
  if (res.statusCode !== status) {
    throw new Error(`expected HTTP ${status}, got ${res.statusCode}: ${res.body}`);
  }
  return res.body ? res.json() : undefined;
}

/** Saves a card the way the app does: start a hosted-page setup, let the (mock) provider complete it, poll. */
export async function addCard(env: TestEnv, token: string, cardToken = "tok_test"): Promise<any> {
  const user = api(env, token);
  const setup = expectStatus(await user.post("/v1/payment-methods/setup", { platform: "web" }), 200);
  const [row] = await env.sql`SELECT provider_ref FROM payment_setups WHERE id = ${setup.setupId}`;
  env.payments.completeForTest(row!.providerRef as string, cardToken);
  return expectStatus(await user.get(`/v1/payment-methods/setup/${setup.setupId}`), 200);
}
