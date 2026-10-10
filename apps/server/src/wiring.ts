import type { Config } from "./config";
import type { Deps } from "./context";
import { Crypto } from "./crypto";
import type { Sql } from "./db";
import { ClaudeExtractor, ManualExtractor } from "./extraction";
import { ConsoleEmail, ConsoleSms, ExpoPushProvider, LocalDiskStorage, MockPayments } from "./providers";
import { CardcomPayments, ResendEmail, S3Storage, TwilioSms } from "./providers.production";

export interface ProviderSummary {
  sms: string;
  email: string;
  storage: string;
  payments: string;
  extraction: string;
  push: string;
}

/** Picks a real service when its credentials are configured, otherwise the development stand-in. */
export function createDeps(config: Config, sql: Sql): { deps: Deps; summary: ProviderSummary } {
  const sms =
    config.TWILIO_ACCOUNT_SID && config.TWILIO_AUTH_TOKEN
      ? new TwilioSms({
          accountSid: config.TWILIO_ACCOUNT_SID,
          authToken: config.TWILIO_AUTH_TOKEN,
          from: config.TWILIO_FROM,
          messagingServiceSid: config.TWILIO_MESSAGING_SERVICE_SID,
        })
      : new ConsoleSms();

  const email =
    config.RESEND_API_KEY && config.EMAIL_FROM
      ? new ResendEmail({ apiKey: config.RESEND_API_KEY, from: config.EMAIL_FROM })
      : new ConsoleEmail();

  const storage =
    config.S3_BUCKET && config.S3_ACCESS_KEY_ID && config.S3_SECRET_ACCESS_KEY
      ? new S3Storage({
          bucket: config.S3_BUCKET,
          endpoint: config.S3_ENDPOINT,
          region: config.S3_REGION,
          accessKeyId: config.S3_ACCESS_KEY_ID,
          secretAccessKey: config.S3_SECRET_ACCESS_KEY,
        })
      : new LocalDiskStorage(config.STORAGE_DIR);

  const payments =
    config.CARDCOM_TERMINAL_NUMBER && config.CARDCOM_API_NAME
      ? new CardcomPayments({
          terminalNumber: config.CARDCOM_TERMINAL_NUMBER,
          apiName: config.CARDCOM_API_NAME,
          apiPassword: config.CARDCOM_API_PASSWORD,
          documentType: config.CARDCOM_DOCUMENT_TYPE,
          baseUrl: config.CARDCOM_BASE_URL,
        })
      : new MockPayments(config.PUBLIC_BASE_URL);

  const extractor = config.extractionProvider === "claude" ? new ClaudeExtractor(config.ANTHROPIC_API_KEY) : new ManualExtractor();

  const deps: Deps = {
    config,
    sql,
    crypto: new Crypto(config.MASTER_KEY),
    sms,
    storage,
    push: new ExpoPushProvider(),
    payments,
    email,
    extractor,
    now: () => new Date(),
  };

  return {
    deps,
    summary: {
      sms: sms instanceof TwilioSms ? "twilio" : "console (dev)",
      email: email instanceof ResendEmail ? "resend" : "console (dev)",
      storage: storage instanceof S3Storage ? `s3 (${config.S3_BUCKET})` : "local disk",
      payments:
        payments instanceof CardcomPayments
          ? `cardcom (terminal ${config.CARDCOM_TERMINAL_NUMBER}${config.CARDCOM_TERMINAL_NUMBER === 1000 ? " – test" : ""})`
          : "mock (dev)",
      extraction: extractor.name,
      push: "expo",
    },
  };
}

/**
 * In production every user-facing service must be real: no console SMS, no local disk, no mock card charges.
 * Returns the problems; the server refuses to start while any remain.
 */
export function productionProblems(config: Config, summary: ProviderSummary): string[] {
  if (config.NODE_ENV !== "production") return [];
  const problems: string[] = [];
  if (summary.sms.includes("dev")) problems.push("SMS: set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_FROM (or TWILIO_MESSAGING_SERVICE_SID)");
  if (summary.email.includes("dev")) problems.push("Email: set RESEND_API_KEY and EMAIL_FROM");
  if (summary.storage === "local disk") problems.push("Storage: set S3_BUCKET, S3_ENDPOINT, S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY");
  if (summary.payments.includes("mock")) problems.push("Payments: set CARDCOM_TERMINAL_NUMBER and CARDCOM_API_NAME");
  if (summary.payments.includes("test")) problems.push("Payments: Cardcom test terminal 1000 cannot take real money – use your own terminal");
  if (config.WEB_DIR && !config.PUBLIC_BASE_URL.startsWith("https://") && config.PUBLIC_BASE_URL !== "") {
    problems.push("PUBLIC_BASE_URL must be https in production");
  }
  if (!config.OPS_PHONES) problems.push("OPS_PHONES: list the operators' mobile numbers for /ops (the shared token is off in production)");
  const legal = ["LEGAL_ENTITY_NAME", "LEGAL_ENTITY_ID", "LEGAL_ADDRESS", "CONTACT_EMAIL", "DPO_NAME", "DPO_EMAIL"] as const;
  const missingLegal = legal.filter((k) => !config[k]);
  if (missingLegal.length) problems.push(`Legal details for the terms and privacy policy: set ${missingLegal.join(", ")}`);
  // Hosts with a dot are reached over the internet (Neon, Render external URL); internal names and localhost are not.
  const db = new URL(config.DATABASE_URL);
  const sslmode = db.searchParams.get("sslmode");
  if (db.hostname.includes(".") && db.hostname !== "127.0.0.1" && sslmode !== "require" && sslmode !== "verify-full") {
    problems.push("DATABASE_URL: add ?sslmode=require for a database reached over the internet");
  }
  return problems;
}

/** Recommended but not blocking. */
export function productionWarnings(config: Config, summary: ProviderSummary): string[] {
  if (config.NODE_ENV !== "production") return [];
  const warnings: string[] = [];
  if (summary.extraction === "manual") warnings.push("ANTHROPIC_API_KEY is not set: users will type receipt details by hand");
  if (summary.payments.startsWith("cardcom") && !config.CARDCOM_API_PASSWORD) warnings.push("CARDCOM_API_PASSWORD is not set: refunds from /ops will fail");
  if (!config.SENTRY_DSN) warnings.push("SENTRY_DSN is not set: errors are only in the logs");
  return warnings;
}
