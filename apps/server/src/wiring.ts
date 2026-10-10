import type { Config } from "./config";
import type { Deps } from "./context";
import { Crypto } from "./crypto";
import type { Sql } from "./db";
import { ClaudeExtractor, ManualExtractor } from "./extraction";
import { ConsoleEmail, ConsoleSms, ExpoPushProvider, LocalDiskStorage, MockPayments } from "./providers";
import { ResendEmail, S3Storage, TwilioSms } from "./providers.production";

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

  const extractor = config.extractionProvider === "claude" ? new ClaudeExtractor(config.ANTHROPIC_API_KEY) : new ManualExtractor();

  const deps: Deps = {
    config,
    sql,
    crypto: new Crypto(config.MASTER_KEY),
    sms,
    storage,
    push: new ExpoPushProvider(),
    // Israeli PSPs (Grow / PayPlus / Cardcom) plug in behind PaymentProvider once a merchant account exists.
    payments: new MockPayments(),
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
      payments: "mock (dev)",
      extraction: extractor.name,
      push: "expo",
    },
  };
}
