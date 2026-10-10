import type { MemberDto, MemberRelation } from "@magiali/shared";
import type { AuthContext, Deps } from "../context";
import { AppError } from "../errors";
import { audit } from "./audit";
import { consumeOtpChallenge, createOtpChallenge } from "./auth";
import { ageOn, getMemberForHousehold, memberDto } from "./households";

function needsConsent(relation: MemberRelation, birthDate: string | null | undefined, now: Date): boolean {
  if (relation === "self") return false;
  // Without a birth date we cannot know the child is a minor, so treat them as an adult who must consent.
  if (relation === "child") return birthDate ? ageOn(birthDate, now) >= 18 : true;
  return true;
}

export async function createMember(
  deps: Deps,
  ctx: AuthContext,
  input: { fullName: string; relation: MemberRelation; birthDate?: string | null; phone?: string; guardianDeclared?: boolean },
): Promise<MemberDto> {
  const consent = needsConsent(input.relation, input.birthDate, deps.now());
  if (!consent && !input.guardianDeclared) {
    throw new AppError("validation_error", "צריך לאשר שאת/ה ההורה או האפוטרופוס של הילד/ה");
  }
  if (consent && !input.phone) {
    throw new AppError("validation_error", "לבן משפחה בגיר צריך מספר טלפון כדי לקבל את אישורו");
  }
  const [m] = await deps.sql`
    INSERT INTO members (household_id, full_name, relation, birth_date, consent_status, consent_phone_e164)
    VALUES (${ctx.householdId}, ${input.fullName}, ${input.relation}, ${input.birthDate ?? null},
            ${consent ? "pending" : "not_required"}, ${consent ? input.phone! : null})
    RETURNING id`;
  const memberId = m!.id as string;
  if (!consent) {
    await audit(deps.sql, { actorUserId: ctx.userId, actorKind: "user", action: "guardian_declared", entity: "member", entityId: memberId });
  }
  if (consent) await sendConsentCode(deps, ctx, memberId);
  return memberDto(await getMemberForHousehold(deps.sql, ctx.householdId, memberId));
}

export async function sendConsentCode(deps: Deps, ctx: AuthContext, memberId: string): Promise<void> {
  const member = await getMemberForHousehold(deps.sql, ctx.householdId, memberId);
  if (member.consentStatus !== "pending" || !member.consentPhoneE164) {
    throw new AppError("conflict", "אין צורך באישור עבור בן המשפחה הזה");
  }
  const [owner] = await deps.sql`SELECT display_name FROM users WHERE id = ${ctx.userId}`;
  const who = (owner?.displayName as string | null) ?? "בן משפחה";
  const code = await createOtpChallenge(deps, deps.sql, {
    phone: member.consentPhoneE164,
    purpose: "member_consent",
    memberId,
  });
  await deps.sms.send(
    member.consentPhoneE164,
    `${who} מבקש/ת לנהל עבורך החזרים רפואיים מהביטוח באפליקציית "מגיע לי". אם את/ה מסכים/ה, מסור/י לו/לה את הקוד: ${code}`,
  );
}

export async function confirmMemberConsent(deps: Deps, ctx: AuthContext, memberId: string, code: string): Promise<MemberDto> {
  const member = await getMemberForHousehold(deps.sql, ctx.householdId, memberId);
  if (member.consentStatus !== "pending" || !member.consentPhoneE164) throw new AppError("conflict", "אין אישור ממתין");
  await consumeOtpChallenge(deps, deps.sql, { phone: member.consentPhoneE164, code, purpose: "member_consent", memberId });
  await deps.sql`
    UPDATE members SET consent_status = 'granted', consent_granted_at = ${deps.now()}, updated_at = ${deps.now()}
    WHERE id = ${memberId}`;
  await audit(deps.sql, { actorUserId: ctx.userId, actorKind: "user", action: "member_consent_granted", entity: "member", entityId: memberId });
  return memberDto(await getMemberForHousehold(deps.sql, ctx.householdId, memberId));
}

export async function updateMember(
  deps: Deps,
  ctx: AuthContext,
  memberId: string,
  input: { fullName?: string; birthDate?: string | null },
): Promise<MemberDto> {
  await getMemberForHousehold(deps.sql, ctx.householdId, memberId);
  await deps.sql`
    UPDATE members SET full_name = COALESCE(${input.fullName ?? null}, full_name),
           birth_date = ${input.birthDate === undefined ? deps.sql`birth_date` : input.birthDate},
           updated_at = ${deps.now()}
    WHERE id = ${memberId}`;
  return memberDto(await getMemberForHousehold(deps.sql, ctx.householdId, memberId));
}

export async function deleteMember(deps: Deps, ctx: AuthContext, memberId: string): Promise<void> {
  const member = await getMemberForHousehold(deps.sql, ctx.householdId, memberId);
  if (member.relation === "self") throw new AppError("conflict", "אי אפשר להסיר את עצמך. אפשר למחוק את החשבון בהגדרות");
  const [active] = await deps.sql`
    SELECT 1 FROM claims WHERE member_id = ${memberId} AND status IN ('awaiting_documents', 'ready', 'in_progress')`;
  if (active) throw new AppError("conflict", "יש תביעות פתוחות עבור בן המשפחה הזה");
  await deps.sql`UPDATE members SET deleted_at = ${deps.now()} WHERE id = ${memberId}`;
}

export async function putEnrollments(
  deps: Deps,
  ctx: AuthContext,
  memberId: string,
  enrollments: Array<{ planId: string; isShabanSupplement: boolean; policyNumber?: string }>,
): Promise<void> {
  await getMemberForHousehold(deps.sql, ctx.householdId, memberId);
  const planIds = [...new Set(enrollments.map((e) => e.planId))];
  if (planIds.length !== enrollments.length) throw new AppError("validation_error", "תוכנית מופיעה פעמיים");
  if (planIds.length > 0) {
    const plans = await deps.sql`SELECT id, plan_kind FROM plans WHERE id IN ${deps.sql(planIds)} AND active`;
    if (plans.length !== planIds.length) throw new AppError("validation_error", "תוכנית לא מוכרת");
    const shabanCount = plans.filter((p) => p.planKind === "shaban").length;
    if (shabanCount > 1) throw new AppError("validation_error", "אפשר לבחור רמת שב\"ן אחת בלבד");
  }
  // Sync, don't recreate: plans that stay keep the user's own terms, policy number, dates and import source.
  await deps.sql.begin(async (tx) => {
    await tx`
      DELETE FROM enrollments WHERE member_id = ${memberId}
        AND NOT (plan_id = ANY(${planIds}::text[]))`;
    for (const e of enrollments) {
      await tx`
        INSERT INTO enrollments (member_id, plan_id, is_shaban_supplement, policy_number_enc)
        VALUES (${memberId}, ${e.planId}, ${e.isShabanSupplement},
                ${e.policyNumber ? deps.crypto.encryptString(e.policyNumber) : null})
        ON CONFLICT (member_id, plan_id) DO UPDATE SET
          is_shaban_supplement = EXCLUDED.is_shaban_supplement,
          policy_number_enc = COALESCE(EXCLUDED.policy_number_enc, enrollments.policy_number_enc)`;
    }
  });
}

export async function listEnrollments(deps: Deps, ctx: AuthContext, memberId: string) {
  await getMemberForHousehold(deps.sql, ctx.householdId, memberId);
  const rows = await deps.sql`
    SELECT e.id, e.member_id, e.plan_id, p.name_he AS plan_name, p.plan_kind, e.is_shaban_supplement
    FROM enrollments e JOIN plans p ON p.id = e.plan_id WHERE e.member_id = ${memberId}
    ORDER BY p.plan_kind, p.id`;
  return rows.map((r) => ({
    id: r.id as string,
    memberId: r.memberId as string,
    planId: r.planId as string,
    planName: r.planName as string,
    planKind: r.planKind as "shaban" | "private_individual" | "private_group",
    isShabanSupplement: r.isShabanSupplement as boolean,
  }));
}
