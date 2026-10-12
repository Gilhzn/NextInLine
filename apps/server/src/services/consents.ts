import type { ConsentKind } from "@magiali/shared";
import type { Db, Sql } from "../db";
import { AppError } from "../errors";

export async function hasConsent(db: Db, userId: string, kind: ConsentKind): Promise<boolean> {
  const [row] = await db`SELECT 1 FROM consents WHERE user_id = ${userId} AND kind = ${kind} AND revoked_at IS NULL LIMIT 1`;
  return !!row;
}

const MISSING: Partial<Record<ConsentKind, string>> = {
  medical_data: "כדי לשמור קבלות רפואיות צריך את הסכמתך לעיבוד מידע רפואי",
  poa: "כדי שנגיש בשמך צריך לחתום על ייפוי הכוח",
  financial_data: "כדי לחבר בנק או כרטיס אשראי צריך את הסכמתך לקריאת התשלומים",
};

export async function requireConsent(db: Db, userId: string, kind: ConsentKind): Promise<void> {
  if (!(await hasConsent(db, userId, kind))) {
    throw new AppError("consent_required", MISSING[kind] ?? "נדרשת הסכמה", { kind });
  }
}

/** Records a consent with its evidence. Granting again the same version is a no-op. */
export async function grantConsent(
  db: Sql,
  userId: string,
  input: { kind: ConsentKind; version: string },
  evidence: { ip: string; userAgent: string | null },
): Promise<void> {
  const [active] = await db`
    SELECT version FROM consents WHERE user_id = ${userId} AND kind = ${input.kind} AND revoked_at IS NULL
    ORDER BY granted_at DESC LIMIT 1`;
  if (active?.version === input.version) return;
  await db.begin(async (tx) => {
    await tx`UPDATE consents SET revoked_at = now() WHERE user_id = ${userId} AND kind = ${input.kind} AND revoked_at IS NULL`;
    await tx`
      INSERT INTO consents (user_id, kind, version, evidence)
      VALUES (${userId}, ${input.kind}, ${input.version}, ${tx.json(evidence as never)})`;
  });
}

export async function revokeConsent(db: Db, userId: string, kind: ConsentKind): Promise<void> {
  if (kind === "terms" || kind === "privacy") {
    throw new AppError("conflict", "כדי להפסיק להסכים לתנאי השימוש צריך למחוק את החשבון (הגדרות ← מחיקת החשבון)");
  }
  await db`UPDATE consents SET revoked_at = now() WHERE user_id = ${userId} AND kind = ${kind} AND revoked_at IS NULL`;
}
