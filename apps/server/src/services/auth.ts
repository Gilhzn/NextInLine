import { jwtVerify, SignJWT } from "jose";
import type { AuthResponseDto } from "@magiali/shared";
import type { AuthContext, Deps } from "../context";
import { hmacHex, randomOtp, randomToken, safeEqualHex, sha256Hex } from "../crypto";
import type { Db } from "../db";
import { AppError } from "../errors";
import { audit } from "./audit";
import { getMe } from "./households";

const ACCESS_TTL = "15m";
const REFRESH_TTL_MS = 30 * 86_400_000;
const OTP_TTL_MS = 5 * 60_000;
const OTP_MAX_ATTEMPTS = 5;
const OTP_MAX_PER_PHONE_10MIN = 3;
const ISSUER = "magiali";
const AUDIENCE = "magiali-app";

function key(deps: Deps): Uint8Array {
  return new TextEncoder().encode(deps.config.JWT_SECRET);
}

export function otpHash(deps: Deps, phone: string, code: string): string {
  return hmacHex(deps.config.OTP_PEPPER, `${phone}:${code}`);
}

/** Creates a one-time code for the phone and returns it so the caller can deliver it. */
export async function createOtpChallenge(
  deps: Deps,
  db: Db,
  input: { phone: string; purpose: "login" | "member_consent"; memberId?: string; ip?: string },
): Promise<string> {
  const now = deps.now();
  const [phoneCount] = await db`
    SELECT count(*)::int AS n FROM otp_challenges
    WHERE phone_e164 = ${input.phone} AND created_at > ${new Date(now.getTime() - 10 * 60_000)}`;
  if ((phoneCount?.n as number) >= OTP_MAX_PER_PHONE_10MIN) {
    throw new AppError("rate_limited", "נשלחו יותר מדי קודים. נסה שוב בעוד כמה דקות");
  }
  if (input.ip) {
    const [ipCount] = await db`
      SELECT count(*)::int AS n FROM otp_challenges
      WHERE ip = ${input.ip} AND created_at > ${new Date(now.getTime() - 3_600_000)}`;
    if ((ipCount?.n as number) >= deps.config.OTP_MAX_PER_IP_HOUR) {
      throw new AppError("rate_limited", "יותר מדי ניסיונות. נסה שוב מאוחר יותר");
    }
  }
  const code = deps.config.OTP_DEV_CODE ?? randomOtp();
  await db`
    INSERT INTO otp_challenges (phone_e164, purpose, member_id, code_hash, expires_at, ip)
    VALUES (${input.phone}, ${input.purpose}, ${input.memberId ?? null}, ${otpHash(deps, input.phone, code)},
            ${new Date(now.getTime() + OTP_TTL_MS)}, ${input.ip ?? null})`;
  return code;
}

/** Verifies the latest open challenge; counts failed attempts and locks after 5. */
export async function consumeOtpChallenge(
  deps: Deps,
  db: Db,
  input: { phone: string; code: string; purpose: "login" | "member_consent"; memberId?: string },
): Promise<void> {
  const [challenge] = await db`
    SELECT id, code_hash, expires_at, attempts FROM otp_challenges
    WHERE phone_e164 = ${input.phone} AND purpose = ${input.purpose} AND consumed_at IS NULL
      AND (${input.memberId ?? null}::uuid IS NULL OR member_id = ${input.memberId ?? null})
    ORDER BY created_at DESC LIMIT 1`;
  if (!challenge) throw new AppError("otp_invalid", "הקוד שגוי. בקש קוד חדש");
  if ((challenge.expiresAt as Date) < deps.now()) throw new AppError("otp_expired", "פג תוקף הקוד. בקש קוד חדש");
  if ((challenge.attempts as number) >= OTP_MAX_ATTEMPTS) throw new AppError("otp_locked", "יותר מדי ניסיונות. בקש קוד חדש");

  if (!safeEqualHex(challenge.codeHash as string, otpHash(deps, input.phone, input.code))) {
    await db`UPDATE otp_challenges SET attempts = attempts + 1 WHERE id = ${challenge.id as string}`;
    throw new AppError("otp_invalid", "הקוד שגוי");
  }
  await db`UPDATE otp_challenges SET consumed_at = ${deps.now()} WHERE id = ${challenge.id as string}`;
}

export async function requestLoginOtp(deps: Deps, phone: string, ip?: string): Promise<void> {
  const code = await createOtpChallenge(deps, deps.sql, { phone, purpose: "login", ip });
  await deps.sms.send(phone, `קוד הכניסה שלך ל"מגיע לי": ${code}. אל תמסור אותו לאף אחד.`);
}

export async function verifyLoginOtp(deps: Deps, phone: string, code: string, ip?: string): Promise<AuthResponseDto> {
  await consumeOtpChallenge(deps, deps.sql, { phone, code, purpose: "login" });

  const { userId, isNew } = await deps.sql.begin(async (tx) => {
    const [existing] = await tx`SELECT id FROM users WHERE phone_e164 = ${phone} AND deleted_at IS NULL`;
    if (existing) return { userId: existing.id as string, isNew: false };
    const [user] = await tx`INSERT INTO users (phone_e164) VALUES (${phone}) RETURNING id`;
    const uid = user!.id as string;
    const [household] = await tx`INSERT INTO households (owner_user_id) VALUES (${uid}) RETURNING id`;
    await tx`
      INSERT INTO members (household_id, user_id, full_name, relation, consent_status)
      VALUES (${household!.id as string}, ${uid}, ${"אני"}, ${"self"}, ${"not_required"})`;
    return { userId: uid, isNew: true };
  });

  await audit(deps.sql, { actorUserId: userId, actorKind: "user", action: "login", entity: "user", entityId: userId, ip });
  const tokens = await issueTokens(deps, userId);
  return { ...tokens, isNew, me: await getMe(deps, userId) };
}

export async function issueTokens(
  deps: Deps,
  userId: string,
  familyId?: string,
): Promise<{ accessToken: string; refreshToken: string }> {
  const accessToken = await new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(ACCESS_TTL)
    .sign(key(deps));
  const refreshToken = randomToken(32);
  await deps.sql`
    INSERT INTO refresh_tokens (user_id, family_id, token_hash, expires_at)
    VALUES (${userId}, ${familyId ?? crypto.randomUUID()}, ${sha256Hex(refreshToken)},
            ${new Date(deps.now().getTime() + REFRESH_TTL_MS)})`;
  return { accessToken, refreshToken };
}

/** Rotates the refresh token. Re-using an old token revokes the whole family (likely theft). */
export async function refreshTokens(deps: Deps, refreshToken: string): Promise<{ accessToken: string; refreshToken: string }> {
  const [row] = await deps.sql`
    SELECT rt.id, rt.user_id, rt.family_id, rt.expires_at, rt.revoked_at, u.deleted_at
    FROM refresh_tokens rt JOIN users u ON u.id = rt.user_id
    WHERE rt.token_hash = ${sha256Hex(refreshToken)}`;
  if (!row) throw new AppError("unauthorized", "נדרשת התחברות מחדש");
  if (row.revokedAt) {
    await deps.sql`UPDATE refresh_tokens SET revoked_at = ${deps.now()} WHERE family_id = ${row.familyId as string} AND revoked_at IS NULL`;
    await audit(deps.sql, { actorUserId: row.userId as string, actorKind: "system", action: "refresh_reuse_detected", entity: "user", entityId: row.userId as string });
    throw new AppError("unauthorized", "נדרשת התחברות מחדש");
  }
  if ((row.expiresAt as Date) < deps.now() || row.deletedAt) throw new AppError("unauthorized", "נדרשת התחברות מחדש");
  await deps.sql`UPDATE refresh_tokens SET revoked_at = ${deps.now()} WHERE id = ${row.id as string}`;
  return issueTokens(deps, row.userId as string, row.familyId as string);
}

export async function logout(deps: Deps, refreshToken: string): Promise<void> {
  await deps.sql`UPDATE refresh_tokens SET revoked_at = ${deps.now()} WHERE token_hash = ${sha256Hex(refreshToken)} AND revoked_at IS NULL`;
}

export async function verifyAccessToken(deps: Deps, token: string): Promise<AuthContext> {
  let userId: string;
  try {
    const { payload } = await jwtVerify(token, key(deps), { issuer: ISSUER, audience: AUDIENCE, algorithms: ["HS256"] });
    if (!payload.sub) throw new Error("no subject");
    userId = payload.sub;
  } catch {
    throw new AppError("unauthorized", "נדרשת התחברות");
  }
  const [row] = await deps.sql`
    SELECT h.id AS household_id FROM users u JOIN households h ON h.owner_user_id = u.id
    WHERE u.id = ${userId} AND u.deleted_at IS NULL`;
  if (!row) throw new AppError("unauthorized", "נדרשת התחברות");
  return { userId, householdId: row.householdId as string };
}
