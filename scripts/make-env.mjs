// Writes apps/server/.env with fresh random secrets for a local / Codespaces / CI demo. Never overwrites.
import { existsSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";

const target = new URL("../apps/server/.env", import.meta.url);
if (existsSync(target)) {
  console.log("apps/server/.env already exists – keeping it");
  process.exit(0);
}
const secret = (n) => randomBytes(n).toString("base64url");
const env = {
  NODE_ENV: "development",
  ROLE: "all",
  PORT: "4000",
  DATABASE_URL: process.env.DATABASE_URL ?? "postgres://magiali:magiali@localhost:5432/magiali",
  PUBLIC_BASE_URL: "",
  JWT_SECRET: secret(48),
  OTP_PEPPER: secret(24),
  MASTER_KEY: randomBytes(32).toString("base64"),
  FILES_SIGNING_SECRET: secret(48),
  ADMIN_TOKEN: secret(32),
  STORAGE_DIR: "./storage",
  OTP_DEV_CODE: "123456",
};
writeFileSync(target, Object.entries(env).map(([k, v]) => `${k}=${v}`).join("\n") + "\n");
console.log("created apps/server/.env (demo login code: 123456)");
