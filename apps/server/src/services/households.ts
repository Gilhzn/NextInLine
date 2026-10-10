import type { MeDto, MemberDto, MemberRelation, OnboardingStep } from "@magiali/shared";
import type { Deps } from "../context";
import type { Db } from "../db";
import { AppError, notFound } from "../errors";
import { iso } from "../http";

type MemberRow = {
  id: string;
  fullName: string;
  relation: MemberRelation;
  birthDate: string | null;
  consentStatus: MemberDto["consentStatus"];
  consentPhoneE164: string | null;
};

export function memberDto(m: MemberRow): MemberDto {
  return {
    id: m.id,
    fullName: m.fullName,
    relation: m.relation,
    birthDate: m.birthDate,
    consentStatus: m.consentStatus,
    isSelf: m.relation === "self",
  };
}

export async function listMembers(db: Db, householdId: string): Promise<MemberRow[]> {
  return (await db`
    SELECT id, full_name, relation, birth_date, consent_status, consent_phone_e164
    FROM members WHERE household_id = ${householdId} AND deleted_at IS NULL
    ORDER BY (relation = 'self') DESC, created_at`) as unknown as MemberRow[];
}

/** Loads a member and enforces that it belongs to the caller's household. */
export async function getMemberForHousehold(db: Db, householdId: string, memberId: string): Promise<MemberRow> {
  const [m] = await db`
    SELECT id, full_name, relation, birth_date, consent_status, consent_phone_e164
    FROM members WHERE id = ${memberId} AND household_id = ${householdId} AND deleted_at IS NULL`;
  if (!m) throw notFound("בן המשפחה");
  return m as unknown as MemberRow;
}

export function assertMemberConsent(member: Pick<MemberRow, "consentStatus" | "fullName">): void {
  if (member.consentStatus === "pending" || member.consentStatus === "revoked") {
    throw new AppError("consent_required", `צריך את אישור ${member.fullName} לפני שמגישים בשמו`);
  }
}

export async function getMe(deps: Deps, userId: string): Promise<MeDto> {
  const [user] = await deps.sql`
    SELECT u.id, u.phone_e164, u.display_name, u.onboarding_step, h.id AS household_id
    FROM users u JOIN households h ON h.owner_user_id = u.id WHERE u.id = ${userId}`;
  if (!user) throw notFound("המשתמש");
  const householdId = user.householdId as string;
  const members = await listMembers(deps.sql, householdId);
  const consents = await deps.sql`
    SELECT kind, version, granted_at FROM consents WHERE user_id = ${userId} AND revoked_at IS NULL ORDER BY granted_at`;
  const [pm] = await deps.sql`
    SELECT count(*)::int AS n FROM payment_methods WHERE user_id = ${userId} AND deleted_at IS NULL`;
  return {
    user: {
      id: user.id as string,
      phone: user.phoneE164 as string,
      displayName: (user.displayName as string | null) ?? null,
      onboardingStep: user.onboardingStep as OnboardingStep,
    },
    householdId,
    members: members.map(memberDto),
    consents: consents.map((c) => ({
      kind: c.kind as string,
      version: c.version as string,
      grantedAt: iso(c.grantedAt as Date)!,
    })),
    hasPaymentMethod: (pm?.n as number) > 0,
  };
}

export function ageOn(birthDate: string, on: Date): number {
  const b = new Date(`${birthDate}T00:00:00Z`);
  let age = on.getUTCFullYear() - b.getUTCFullYear();
  if (on.getUTCMonth() < b.getUTCMonth() || (on.getUTCMonth() === b.getUTCMonth() && on.getUTCDate() < b.getUTCDate())) {
    age -= 1;
  }
  return age;
}
