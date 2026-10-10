import { z } from "zod";

/** 32 random bytes (base64) – or any long random secret, from which a 256-bit key is derived. */
const masterKey = z.string().min(32);

const configSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    ROLE: z.enum(["api", "worker", "all"]).default("all"),
    PORT: z.coerce.number().int().default(4000),
    HOST: z.string().default("0.0.0.0"),
    DATABASE_URL: z.string().url(),
    /** Base for signed file links. Empty = relative links (web app served from the same origin). */
    PUBLIC_BASE_URL: z.union([z.literal(""), z.string().url()]).optional(),
    /** Set automatically by Render for web services. */
    RENDER_EXTERNAL_URL: z.string().url().optional(),
    JWT_SECRET: z.string().min(32),
    OTP_PEPPER: z.string().min(16),
    MASTER_KEY: masterKey,
    FILES_SIGNING_SECRET: z.string().min(32),
    STORAGE_DIR: z.string().default("./storage"),
    ADMIN_TOKEN: z.string().min(24),
    ANTHROPIC_API_KEY: z.string().optional(),
    EXTRACTION_PROVIDER: z.enum(["claude", "manual"]).optional(),
    /** Fixed OTP for local development only. Refused in production. */
    OTP_DEV_CODE: z
      .string()
      .regex(/^\d{6}$/)
      .optional(),
    WORKER_POLL_MS: z.coerce.number().int().positive().default(2000),
    /** Per-IP limits on login codes. Raised in tests, where every request shares one address. */
    OTP_MAX_PER_IP_HOUR: z.coerce.number().int().positive().default(20),
    OTP_ROUTE_LIMIT_PER_10MIN: z.coerce.number().int().positive().default(10),
    /** Optional: directory of the exported web app to serve from the same origin (demo / preview). */
    WEB_DIR: z.string().optional(),

    // ---- External services (each is optional; without it a development stand-in is used) ----
    TWILIO_ACCOUNT_SID: z.string().optional(),
    TWILIO_AUTH_TOKEN: z.string().optional(),
    TWILIO_FROM: z.string().optional(),
    TWILIO_MESSAGING_SERVICE_SID: z.string().optional(),
    RESEND_API_KEY: z.string().optional(),
    EMAIL_FROM: z.string().optional(),
    S3_BUCKET: z.string().optional(),
    S3_ENDPOINT: z.string().url().optional(),
    S3_REGION: z.string().optional(),
    S3_ACCESS_KEY_ID: z.string().optional(),
    S3_SECRET_ACCESS_KEY: z.string().optional(),
    SENTRY_DSN: z.string().url().optional(),
    SENTRY_ENVIRONMENT: z.string().optional(),
    /** Build identifier shown in error reports (Render sets RENDER_GIT_COMMIT). */
    RELEASE: z.string().optional(),
    RENDER_GIT_COMMIT: z.string().optional(),
  })
  .refine((c) => !(c.NODE_ENV === "production" && c.OTP_DEV_CODE), {
    message: "OTP_DEV_CODE must not be set in production",
  });

export type Config = Omit<z.output<typeof configSchema>, "PUBLIC_BASE_URL"> & {
  PUBLIC_BASE_URL: string;
  extractionProvider: "claude" | "manual";
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = configSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid configuration:\n${issues}`);
  }
  const c = parsed.data;
  return {
    ...c,
    // Explicit value wins; on Render use its public URL; when the server also serves the web app, links can be relative.
    PUBLIC_BASE_URL: c.PUBLIC_BASE_URL ?? c.RENDER_EXTERNAL_URL ?? (c.WEB_DIR ? "" : "http://localhost:4000"),
    RELEASE: c.RELEASE ?? c.RENDER_GIT_COMMIT,
    extractionProvider: c.EXTRACTION_PROVIDER ?? (c.ANTHROPIC_API_KEY ? "claude" : "manual"),
  };
}
