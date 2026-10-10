import { jwtVerify, SignJWT } from "jose";
import { normalizeIsraeliMobile } from "@magiali/shared";
import type { Deps } from "../context";
import { AppError } from "../errors";
import { audit } from "./audit";
import { consumeOtpChallenge, createOtpChallenge, ISSUER, key } from "./auth";

const OPS_AUDIENCE = "magiali-ops";
const OPS_SESSION = "8h";

export function opsPhones(deps: Deps): string[] {
  return (deps.config.OPS_PHONES ?? "")
    .split(",")
    .map((p) => normalizeIsraeliMobile(p.trim()) ?? p.trim())
    .filter(Boolean);
}

/** The shared ADMIN_TOKEN is a development convenience; in production operators must sign in personally. */
export function adminTokenAllowed(deps: Deps): boolean {
  return deps.config.NODE_ENV !== "production";
}

/** Sends a code only to listed operators, but answers the same either way (no enumeration). */
export async function requestOpsCode(deps: Deps, phoneInput: string, ip?: string): Promise<void> {
  const phone = normalizeIsraeliMobile(phoneInput);
  if (!phone || !opsPhones(deps).includes(phone)) return;
  const code = await createOtpChallenge(deps, deps.sql, { phone, purpose: "ops_login", ip });
  await deps.sms.send(phone, `קוד כניסה לממשק התפעול של "מגיע לי": ${code}`);
}

export async function verifyOpsCode(deps: Deps, phoneInput: string, code: string, ip?: string): Promise<string> {
  const phone = normalizeIsraeliMobile(phoneInput);
  if (!phone || !opsPhones(deps).includes(phone)) throw new AppError("otp_invalid", "הקוד שגוי");
  await consumeOtpChallenge(deps, deps.sql, { phone, code, purpose: "ops_login" });
  await audit(deps.sql, { actorKind: "ops", action: "ops_login", entity: "operator", entityId: phone, ip });
  return new SignJWT({ role: "ops" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(phone)
    .setIssuer(ISSUER)
    .setAudience(OPS_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(OPS_SESSION)
    .sign(key(deps));
}

/** Returns the operator's phone, or null if the token is not a valid ops session for a still-listed operator. */
export async function verifyOpsSession(deps: Deps, token: string): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(token, key(deps), { issuer: ISSUER, audience: OPS_AUDIENCE, algorithms: ["HS256"] });
    return payload.sub && opsPhones(deps).includes(payload.sub) ? payload.sub : null;
  } catch {
    return null;
  }
}
