import { z } from "zod";

const base64Key = z
  .string()
  .refine((v) => Buffer.from(v, "base64").length === 32, "must be 32 bytes, base64-encoded");

const configSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    ROLE: z.enum(["api", "worker", "all"]).default("all"),
    PORT: z.coerce.number().int().default(4000),
    HOST: z.string().default("0.0.0.0"),
    DATABASE_URL: z.string().url(),
    /** Base for signed file links. Empty = relative links (web app served from the same origin). */
    PUBLIC_BASE_URL: z.union([z.literal(""), z.string().url()]).default("http://localhost:4000"),
    JWT_SECRET: z.string().min(32),
    OTP_PEPPER: z.string().min(16),
    MASTER_KEY: base64Key,
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
  })
  .refine((c) => !(c.NODE_ENV === "production" && c.OTP_DEV_CODE), {
    message: "OTP_DEV_CODE must not be set in production",
  });

export type Config = z.output<typeof configSchema> & { extractionProvider: "claude" | "manual" };

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = configSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid configuration:\n${issues}`);
  }
  const c = parsed.data;
  return {
    ...c,
    extractionProvider: c.EXTRACTION_PROVIDER ?? (c.ANTHROPIC_API_KEY ? "claude" : "manual"),
  };
}
