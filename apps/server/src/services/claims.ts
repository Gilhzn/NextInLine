import {
  CATEGORY_INFO,
  canTransitionLeg,
  computeFee,
  deriveSubmittedClaimStatus,
  FEE_POLICY,
  formatILS,
  isTerminalLeg,
  type BenefitCategory,
  type ClaimDto,
  type ClaimStatus,
  type DocKind,
  type FeeDto,
  type LegDto,
  type LegStatus,
  type RoutingResult,
  type SubmissionPackDto,
} from "@magiali/shared";
import type { AuthContext, Deps } from "../context";
import type { Db, Tx } from "../db";
import { AppError, notFound } from "../errors";
import { iso } from "../http";
import { audit } from "./audit";
import { routeForMember } from "./coverage";
import { assertMemberConsent, getMemberForHousehold } from "./households";
import { enqueue, PermanentJobError, registerJobHandler } from "./jobs";
import { notify } from "./notify";
import { readDocument, signedFileUrl } from "./receipts";

const ACTIVE_CLAIM_STATUSES: ClaimStatus[] = ["draft", "awaiting_documents", "ready"];

type ClaimRow = {
  id: string;
  householdId: string;
  memberId: string;
  status: ClaimStatus;
  isRetro: boolean;
  privacyPrivate: boolean;
  category: BenefitCategory;
  providerName: string | null;
  serviceDate: string;
  sessions: number;
  amountAgorot: number;
  routing: RoutingResult;
  totalExpectedAgorot: number;
  totalPaidAgorot: number;
  submittedAt: Date | null;
  createdAt: Date;
};

type LegRow = {
  id: string;
  claimId: string;
  seq: number;
  payerId: string;
  planId: string;
  status: LegStatus;
  baseAgorot: number;
  expectedAgorot: number;
  approvedAgorot: number | null;
  paidAgorot: number | null;
  submissionChannel: "user_handoff" | "email_poa";
  submittedAt: Date | null;
  decidedAt: Date | null;
  paidAt: Date | null;
  rejectionReason: string | null;
};

async function ownerOf(db: Db, householdId: string): Promise<string> {
  const [h] = await db`SELECT owner_user_id FROM households WHERE id = ${householdId}`;
  return h!.ownerUserId as string;
}

// ---------- create ----------

export async function createClaim(
  deps: Deps,
  ctx: AuthContext,
  input: { receiptIds: string[]; isRetro: boolean; privacyPrivate: boolean },
): Promise<ClaimDto> {
  const receipts = await deps.sql`
    SELECT r.id, r.document_id, r.member_id, r.category, r.provider_name, r.service_date, r.amount_agorot,
           r.sessions, r.confirmed_at,
           EXISTS (SELECT 1 FROM claim_receipts cr JOIN claims c ON c.id = cr.claim_id
                   WHERE cr.receipt_id = r.id AND c.status <> 'cancelled') AS in_claim
    FROM receipts r
    WHERE r.id IN ${deps.sql(input.receiptIds)} AND r.household_id = ${ctx.householdId} AND r.deleted_at IS NULL`;
  if (receipts.length !== new Set(input.receiptIds).size) throw notFound("הקבלה");
  for (const r of receipts) {
    if (!r.confirmedAt) throw new AppError("conflict", "יש לאשר את פרטי הקבלה לפני יצירת תביעה");
    if (r.inClaim) throw new AppError("conflict", "הקבלה כבר שייכת לתביעה");
  }
  const memberIds = new Set(receipts.map((r) => r.memberId as string));
  const categories = new Set(receipts.map((r) => r.category as string));
  if (memberIds.size !== 1 || categories.size !== 1) {
    throw new AppError("validation_error", "תביעה אחת יכולה לכלול קבלות של אדם אחד ומאותו סוג שירות");
  }
  const memberId = [...memberIds][0]!;
  const category = [...categories][0] as BenefitCategory;
  const member = await getMemberForHousehold(deps.sql, ctx.householdId, memberId);
  assertMemberConsent(member);

  const amountAgorot = receipts.reduce((s, r) => s + (r.amountAgorot as number), 0);
  const sessions = receipts.reduce((s, r) => s + (r.sessions as number), 0);
  const serviceDate = receipts.map((r) => r.serviceDate as string).sort().at(-1)!;
  const providerName = (receipts[0]!.providerName as string | null) ?? null;

  const { routing, catalogVersion } = await routeForMember(deps.sql, {
    memberId,
    birthDate: member.birthDate,
    category,
    amountAgorot,
    sessions,
    serviceDate,
  });
  if (routing.legs.length === 0) {
    throw new AppError("no_coverage", "לא מצאנו כיסוי שמחזיר כסף על הקבלה הזו", { routing });
  }

  const docsNeeded = routing.requiredDocs.filter((k) => k !== "payer_payment_proof" && k !== "receipt");
  const status: ClaimStatus = docsNeeded.length > 0 ? "awaiting_documents" : "ready";

  const claimId = await deps.sql.begin(async (tx) => {
    const [claim] = await tx`
      INSERT INTO claims (household_id, member_id, status, is_retro, privacy_private, catalog_version, category,
                          provider_name, service_date, sessions, amount_agorot, routing, total_expected_agorot, created_by)
      VALUES (${ctx.householdId}, ${memberId}, ${status}, ${input.isRetro}, ${input.privacyPrivate}, ${catalogVersion},
              ${category}, ${providerName}, ${serviceDate}, ${sessions}, ${amountAgorot}, ${tx.json(routing as never)},
              ${routing.totalExpectedAgorot}, ${ctx.userId})
      RETURNING id`;
    const id = claim!.id as string;
    for (const r of receipts) {
      await tx`INSERT INTO claim_receipts (claim_id, receipt_id) VALUES (${id}, ${r.id as string})`;
    }
    const payers = await tx`SELECT id, claims_email FROM payers WHERE id IN ${tx(routing.legs.map((l) => l.payerId))}`;
    for (const leg of routing.legs) {
      const payer = payers.find((p) => p.id === leg.payerId);
      await tx`
        INSERT INTO claim_legs (claim_id, seq, payer_id, plan_id, status, base_agorot, expected_agorot, submission_channel)
        VALUES (${id}, ${leg.seq}, ${leg.payerId}, ${leg.planId}, ${leg.seq === 1 ? "ready" : "blocked"},
                ${leg.baseAgorot}, ${leg.expectedAgorot}, ${payer?.claimsEmail ? "email_poa" : "user_handoff"})`;
    }
    await tx`
      INSERT INTO claim_required_docs (claim_id, kind, status, document_id)
      VALUES (${id}, 'receipt', 'provided', ${receipts[0]!.documentId as string})`;
    for (const kind of docsNeeded) {
      await tx`INSERT INTO claim_required_docs (claim_id, kind, status) VALUES (${id}, ${kind}, 'missing')`;
    }
    await tx`
      INSERT INTO claim_events (claim_id, type, to_status, actor, actor_id)
      VALUES (${id}, 'created', ${status}, 'user', ${ctx.userId})`;
    return id;
  });

  if (status === "awaiting_documents") {
    await enqueue(deps.sql, "remind_missing_docs", { claimId }, { runAt: new Date(deps.now().getTime() + 3 * 86_400_000) });
  }
  return getClaim(deps, ctx, claimId);
}

// ---------- read ----------

export async function getClaim(deps: Deps, ctx: AuthContext, claimId: string): Promise<ClaimDto> {
  const [c] = await deps.sql`
    SELECT c.*, m.full_name AS member_name FROM claims c JOIN members m ON m.id = c.member_id
    WHERE c.id = ${claimId} AND c.household_id = ${ctx.householdId}`;
  if (!c) throw notFound("התביעה");
  return toClaimDto(deps, c as unknown as ClaimRow & { memberName: string });
}

export async function listClaims(
  deps: Deps,
  ctx: AuthContext,
  filter: { status?: ClaimStatus; memberId?: string },
): Promise<ClaimDto[]> {
  const rows = await deps.sql`
    SELECT c.*, m.full_name AS member_name FROM claims c JOIN members m ON m.id = c.member_id
    WHERE c.household_id = ${ctx.householdId}
      AND (${filter.status ?? null}::text IS NULL OR c.status = ${filter.status ?? null})
      AND (${filter.memberId ?? null}::uuid IS NULL OR c.member_id = ${filter.memberId ?? null})
    ORDER BY c.created_at DESC LIMIT 100`;
  return Promise.all(rows.map((c) => toClaimDto(deps, c as unknown as ClaimRow & { memberName: string })));
}

async function toClaimDto(deps: Deps, c: ClaimRow & { memberName: string }): Promise<ClaimDto> {
  const legs = await deps.sql`
    SELECT l.*, p.name_he AS payer_name, p.avg_processing_days, pl.name_he AS plan_name
    FROM claim_legs l JOIN payers p ON p.id = l.payer_id JOIN plans pl ON pl.id = l.plan_id
    WHERE l.claim_id = ${c.id} ORDER BY l.seq`;
  const docs = await deps.sql`SELECT kind, status FROM claim_required_docs WHERE claim_id = ${c.id} ORDER BY kind`;
  const [fee] = await deps.sql`SELECT * FROM fees WHERE claim_id = ${c.id}`;
  const preview = computeFee(c.totalExpectedAgorot, c.isRetro);

  return {
    id: c.id,
    memberId: c.memberId,
    memberName: c.memberName,
    status: c.status,
    isRetro: c.isRetro,
    privacyPrivate: c.privacyPrivate,
    category: c.category,
    providerName: c.providerName,
    serviceDate: c.serviceDate,
    amountAgorot: c.amountAgorot,
    totalExpectedAgorot: c.totalExpectedAgorot,
    totalPaidAgorot: c.totalPaidAgorot,
    routing: c.routing,
    legs: legs.map((l): LegDto => {
      const submittedAt = l.submittedAt as Date | null;
      const status = l.status as LegStatus;
      return {
        id: l.id as string,
        seq: l.seq as number,
        payerId: l.payerId as string,
        payerName: l.payerName as string,
        planId: l.planId as string,
        planName: l.planName as string,
        status,
        expectedAgorot: l.expectedAgorot as number,
        approvedAgorot: (l.approvedAgorot as number | null) ?? null,
        paidAgorot: (l.paidAgorot as number | null) ?? null,
        submissionChannel: l.submissionChannel as LegDto["submissionChannel"],
        submittedAt: iso(submittedAt),
        paidAt: iso(l.paidAt as Date | null),
        rejectionReason: (l.rejectionReason as string | null) ?? null,
        expectedDecisionBy:
          submittedAt && !isTerminalLeg(status)
            ? new Date(submittedAt.getTime() + (l.avgProcessingDays as number) * 86_400_000).toISOString()
            : null,
      };
    }),
    requiredDocs: docs.map((d) => ({ kind: d.kind as DocKind, status: d.status as "missing" | "provided" | "waived" })),
    fee: fee ? feeDto(fee) : null,
    feePreview: { rateBps: preview.rateBps, amountAgorot: preview.amountAgorot, netToUserAgorot: preview.netToUserAgorot },
    createdAt: iso(c.createdAt)!,
  };
}

export function feeDto(f: Record<string, unknown>): FeeDto {
  return {
    id: f.id as string,
    claimId: f.claimId as string,
    rateBps: f.rateBps as number,
    baseAgorot: f.baseAgorot as number,
    amountAgorot: f.amountAgorot as number,
    status: f.status as FeeDto["status"],
    scheduledFor: iso(f.scheduledFor as Date | null),
    chargedAt: iso(f.chargedAt as Date | null),
  };
}

// ---------- documents & submission ----------

export async function provideClaimDocument(
  deps: Deps,
  ctx: AuthContext,
  claimId: string,
  input: { kind: DocKind; documentId: string },
): Promise<ClaimDto> {
  const claim = await getClaim(deps, ctx, claimId);
  if (["completed", "partially_paid", "rejected", "cancelled"].includes(claim.status)) {
    throw new AppError("conflict", "התביעה כבר סגורה");
  }
  const [doc] = await deps.sql`
    SELECT id FROM documents WHERE id = ${input.documentId} AND household_id = ${ctx.householdId} AND deleted_at IS NULL`;
  if (!doc) throw notFound("המסמך");

  await deps.sql.begin(async (tx) => {
    await tx`
      INSERT INTO claim_required_docs (claim_id, kind, status, document_id)
      VALUES (${claimId}, ${input.kind}, 'provided', ${input.documentId})
      ON CONFLICT (claim_id, kind) DO UPDATE SET status = 'provided', document_id = EXCLUDED.document_id`;
    const [missing] = await tx`
      SELECT count(*)::int AS n FROM claim_required_docs WHERE claim_id = ${claimId} AND status = 'missing'`;
    if ((missing?.n as number) === 0) {
      await tx`UPDATE claims SET status = 'ready', updated_at = ${deps.now()} WHERE id = ${claimId} AND status = 'awaiting_documents'`;
    }
    await tx`
      INSERT INTO claim_events (claim_id, type, actor, actor_id, payload)
      VALUES (${claimId}, 'document_provided', 'user', ${ctx.userId}, ${tx.json({ kind: input.kind } as never)})`;
  });
  return getClaim(deps, ctx, claimId);
}

export async function submitClaim(deps: Deps, ctx: AuthContext, claimId: string): Promise<ClaimDto> {
  const claim = await getClaim(deps, ctx, claimId);
  if (claim.status === "in_progress") return claim; // idempotent
  if (claim.status === "awaiting_documents") throw new AppError("conflict", "חסרים מסמכים לפני ההגשה");
  if (claim.status !== "ready") throw new AppError("conflict", "אי אפשר להגיש את התביעה במצבה הנוכחי");
  const member = await getMemberForHousehold(deps.sql, ctx.householdId, claim.memberId);
  assertMemberConsent(member);

  const firstLeg = claim.legs.find((l) => l.seq === 1)!;
  if (firstLeg.submissionChannel === "email_poa") {
    const [poa] = await deps.sql`
      SELECT 1 FROM consents WHERE user_id = ${ctx.userId} AND kind = 'poa' AND revoked_at IS NULL`;
    if (!poa) throw new AppError("consent_required", "כדי שנגיש בשמך צריך לחתום על ייפוי הכוח");
  }

  await deps.sql.begin(async (tx) => {
    await tx`UPDATE claims SET status = 'in_progress', submitted_at = ${deps.now()}, updated_at = ${deps.now()} WHERE id = ${claimId}`;
    await tx`
      INSERT INTO claim_events (claim_id, type, from_status, to_status, actor, actor_id)
      VALUES (${claimId}, 'submitted', 'ready', 'in_progress', 'user', ${ctx.userId})`;
    if (firstLeg.submissionChannel === "email_poa") {
      await enqueue(tx, "submit_leg", { legId: firstLeg.id }, { maxAttempts: 5 });
    }
  });
  return getClaim(deps, ctx, claimId);
}

export async function cancelClaim(deps: Deps, ctx: AuthContext, claimId: string): Promise<ClaimDto> {
  const claim = await getClaim(deps, ctx, claimId);
  if (!ACTIVE_CLAIM_STATUSES.includes(claim.status)) throw new AppError("conflict", "אי אפשר לבטל תביעה שכבר הוגשה");
  await deps.sql.begin(async (tx) => {
    await tx`UPDATE claims SET status = 'cancelled', updated_at = ${deps.now()} WHERE id = ${claimId}`;
    await tx`
      INSERT INTO claim_events (claim_id, type, from_status, to_status, actor, actor_id)
      VALUES (${claimId}, 'cancelled', ${claim.status}, 'cancelled', 'user', ${ctx.userId})`;
  });
  return getClaim(deps, ctx, claimId);
}

// ---------- leg transitions ----------

export interface LegTransition {
  to: LegStatus;
  amountAgorot?: number;
  reason?: string;
  payerReference?: string;
  actor: "user" | "system" | "ops";
  actorId: string | null;
}

/**
 * The only place leg statuses change. Validates the transition, records an event, and cascades:
 * re-prices and opens the next leg, updates claim totals/status, schedules the fee, and notifies.
 */
export async function transitionLeg(deps: Deps, legId: string, t: LegTransition): Promise<void> {
  const notifications: Array<() => Promise<void>> = [];

  await deps.sql.begin(async (tx) => {
    const [legHead] = await tx`SELECT claim_id FROM claim_legs WHERE id = ${legId}`;
    if (!legHead) throw notFound("השלב");
    const [claimRow] = await tx`SELECT * FROM claims WHERE id = ${legHead.claimId as string} FOR UPDATE`;
    const claim = claimRow as unknown as ClaimRow;
    const [legRow] = await tx`SELECT * FROM claim_legs WHERE id = ${legId}`;
    const leg = legRow as unknown as LegRow;

    if (leg.status === t.to) return; // idempotent
    if (claim.status !== "in_progress") throw new AppError("conflict", "התביעה עוד לא הוגשה או שכבר נסגרה");
    if (!canTransitionLeg(leg.status, t.to)) {
      throw new AppError("conflict", `אי אפשר לעבור מ-${leg.status} ל-${t.to}`);
    }
    if (t.to === "partially_approved" && t.amountAgorot === undefined) {
      throw new AppError("validation_error", "באישור חלקי צריך לציין סכום");
    }

    const now = deps.now();
    const approved =
      t.to === "approved" || t.to === "partially_approved"
        ? (t.amountAgorot ?? leg.expectedAgorot)
        : t.to === "paid"
          ? (leg.approvedAgorot ?? t.amountAgorot ?? leg.expectedAgorot)
          : leg.approvedAgorot;
    const paid = t.to === "paid" ? (t.amountAgorot ?? approved ?? leg.expectedAgorot) : leg.paidAgorot;

    await tx`
      UPDATE claim_legs SET
        status = ${t.to},
        approved_agorot = ${approved},
        paid_agorot = ${paid},
        submitted_at = ${t.to === "submitted" ? now : leg.submittedAt},
        decided_at = ${["approved", "partially_approved", "rejected"].includes(t.to) ? now : leg.decidedAt},
        paid_at = ${t.to === "paid" ? now : leg.paidAt},
        rejection_reason = ${t.to === "rejected" ? (t.reason ?? null) : leg.rejectionReason},
        payer_reference = COALESCE(${t.payerReference ?? null}, payer_reference),
        updated_at = ${now}
      WHERE id = ${legId}`;
    await tx`
      INSERT INTO claim_events (claim_id, leg_id, type, from_status, to_status, actor, actor_id, payload)
      VALUES (${claim.id}, ${legId}, 'leg_status', ${leg.status}, ${t.to}, ${t.actor}, ${t.actorId},
              ${tx.json({ amountAgorot: t.amountAgorot ?? null, reason: t.reason ?? null } as never)})`;

    if (t.to === "paid" || t.to === "rejected") {
      await advanceAfterTerminalLeg(deps, tx, claim);
    }

    const legs = (await tx`SELECT * FROM claim_legs WHERE claim_id = ${claim.id} ORDER BY seq`) as unknown as LegRow[];
    const totalPaid = legs.reduce((s, l) => s + (l.status === "paid" ? (l.paidAgorot ?? 0) : 0), 0);
    const totalExpected = legs.reduce(
      (s, l) =>
        s + (l.status === "paid" ? (l.paidAgorot ?? 0) : l.status === "rejected" || l.status === "skipped" ? 0 : l.expectedAgorot),
      0,
    );
    const newStatus = deriveSubmittedClaimStatus(legs);
    await tx`
      UPDATE claims SET status = ${newStatus}, total_paid_agorot = ${totalPaid}, total_expected_agorot = ${totalExpected},
             updated_at = ${now}
      WHERE id = ${claim.id}`;

    const ownerId = await ownerOf(tx, claim.householdId);
    if ((newStatus === "completed" || newStatus === "partially_paid") && totalPaid > 0) {
      await scheduleFee(deps, tx, claim, totalPaid, ownerId);
    }

    const [payer] = await tx`SELECT name_he FROM payers WHERE id = ${leg.payerId}`;
    const payerName = payer?.nameHe as string;
    if (t.to === "paid") {
      notifications.push(() =>
        notify(deps.sql, deps.now(), ownerId, {
          type: "leg_paid",
          title: `💸 ${formatILS(paid ?? 0)} הגיעו מ${payerName}`,
          body: newStatus === "in_progress" ? "שולחים עכשיו את ההמשך לביטוח הבא" : "התביעה הושלמה",
          data: { claimId: claim.id },
          urgent: true,
        }),
      );
    } else if (t.to === "rejected") {
      notifications.push(() =>
        notify(deps.sql, deps.now(), ownerId, {
          type: "leg_rejected",
          title: `${payerName} דחו את התביעה`,
          body: "יש מה לעשות. פתח כדי לראות את האפשרויות",
          data: { claimId: claim.id },
          urgent: true,
        }),
      );
    }
  });

  for (const send of notifications) await send();
}

/** After a leg is paid or rejected: re-price the remaining legs on what is actually left, and open the next one. */
async function advanceAfterTerminalLeg(deps: Deps, tx: Tx, claim: ClaimRow): Promise<void> {
  const legs = (await tx`SELECT * FROM claim_legs WHERE claim_id = ${claim.id} ORDER BY seq`) as unknown as LegRow[];
  const pending = legs.filter((l) => l.status === "blocked");
  if (pending.length === 0) return;

  const paidSoFar = legs.reduce((s, l) => s + (l.status === "paid" ? (l.paidAgorot ?? 0) : 0), 0);
  const remaining = claim.amountAgorot - paidSoFar;
  const pendingPlans = new Set(pending.map((l) => l.planId));

  const expected = new Map<string, { base: number; expected: number }>();
  if (remaining > 0) {
    const [member] = await tx`SELECT birth_date FROM members WHERE id = ${claim.memberId}`;
    const allPlans = await tx`SELECT plan_id FROM enrollments WHERE member_id = ${claim.memberId}`;
    const { routing } = await routeForMember(tx, {
      memberId: claim.memberId,
      birthDate: (member?.birthDate as string | null) ?? null,
      category: claim.category,
      amountAgorot: remaining,
      sessions: claim.sessions,
      serviceDate: claim.serviceDate,
      excludeClaimId: claim.id,
      excludePlanIds: allPlans.map((p) => p.planId as string).filter((id) => !pendingPlans.has(id)),
    });
    for (const l of routing.legs) expected.set(l.planId, { base: l.baseAgorot, expected: l.expectedAgorot });
  }

  let opened = false;
  for (const leg of pending) {
    const e = expected.get(leg.planId);
    if (!e || e.expected <= 0) {
      await tx`UPDATE claim_legs SET status = 'skipped', expected_agorot = 0, updated_at = ${deps.now()} WHERE id = ${leg.id}`;
      await tx`
        INSERT INTO claim_events (claim_id, leg_id, type, from_status, to_status, actor)
        VALUES (${claim.id}, ${leg.id}, 'leg_status', 'blocked', 'skipped', 'system')`;
      continue;
    }
    await tx`
      UPDATE claim_legs SET base_agorot = ${e.base}, expected_agorot = ${e.expected},
             status = ${opened ? "blocked" : "ready"}, updated_at = ${deps.now()}
      WHERE id = ${leg.id}`;
    if (!opened) {
      opened = true;
      await tx`
        INSERT INTO claim_events (claim_id, leg_id, type, from_status, to_status, actor)
        VALUES (${claim.id}, ${leg.id}, 'leg_status', 'blocked', 'ready', 'system')`;
      if (leg.submissionChannel === "email_poa") {
        await enqueue(tx, "submit_leg", { legId: leg.id }, { maxAttempts: 5 });
      }
    }
  }
}

async function scheduleFee(deps: Deps, tx: Tx, claim: ClaimRow, totalPaid: number, ownerId: string): Promise<void> {
  const quote = computeFee(totalPaid, claim.isRetro);
  const scheduledFor = new Date(deps.now().getTime() + FEE_POLICY.chargeDelayDays * 86_400_000);
  const status = quote.amountAgorot > 0 ? "scheduled" : "waived";
  const [fee] = await tx`
    INSERT INTO fees (claim_id, household_id, rate_bps, cap_agorot, base_agorot, amount_agorot, status, scheduled_for)
    VALUES (${claim.id}, ${claim.householdId}, ${quote.rateBps}, ${quote.capAgorot}, ${quote.baseAgorot},
            ${quote.amountAgorot}, ${status}, ${status === "scheduled" ? scheduledFor : null})
    ON CONFLICT (claim_id) DO NOTHING
    RETURNING id`;
  if (!fee || status !== "scheduled") return;
  await enqueue(tx, "charge_fee", { feeId: fee.id }, { runAt: scheduledFor, maxAttempts: 4 });
  await notify(tx, deps.now(), ownerId, {
    type: "fee_upcoming",
    title: `העמלה (${formatILS(quote.amountAgorot)}) תחויב בעוד ${FEE_POLICY.chargeDelayDays} ימים`,
    body: "הכסף לא הגיע לחשבון שלך? ספר לנו ולא נחייב",
    data: { claimId: claim.id, feeId: fee.id },
  });
}

/** User-reported status change on their own claim. */
export async function userUpdateLeg(
  deps: Deps,
  ctx: AuthContext,
  claimId: string,
  legId: string,
  input: { status: LegStatus; amountAgorot?: number; reason?: string; payerReference?: string },
): Promise<ClaimDto> {
  const claim = await getClaim(deps, ctx, claimId);
  if (!claim.legs.some((l) => l.id === legId)) throw notFound("השלב");
  await transitionLeg(deps, legId, {
    to: input.status,
    amountAgorot: input.amountAgorot,
    reason: input.reason,
    payerReference: input.payerReference,
    actor: "user",
    actorId: ctx.userId,
  });
  return getClaim(deps, ctx, claimId);
}

// ---------- submission pack ----------

const DOC_LABEL: Record<string, string> = {
  receipt: "קבלה",
  visit_summary: "סיכום טיפול / ביקור",
  referral: "הפניה מרופא",
  payer_payment_proof: "אישור תשלום מהגוף הקודם",
};

export async function getSubmissionPack(deps: Deps, ctx: AuthContext, claimId: string, legId: string): Promise<SubmissionPackDto> {
  const claim = await getClaim(deps, ctx, claimId);
  const leg = claim.legs.find((l) => l.id === legId);
  if (!leg) throw notFound("השלב");
  if (leg.status === "blocked") throw new AppError("conflict", "השלב הזה ייפתח אחרי שהגוף הקודם ישלם");
  const [payer] = await deps.sql`SELECT web_url, app_deep_link FROM payers WHERE id = ${leg.payerId}`;
  const previous = claim.legs.filter((l) => l.seq < leg.seq && l.status === "paid");

  const docRows = await deps.sql`
    SELECT d.id, d.kind FROM claim_required_docs crd JOIN documents d ON d.id = crd.document_id
    WHERE crd.claim_id = ${claimId} AND crd.status = 'provided'
    UNION
    SELECT d.id, d.kind FROM claim_receipts cr JOIN receipts r ON r.id = cr.receipt_id JOIN documents d ON d.id = r.document_id
    WHERE cr.claim_id = ${claimId}`;

  await audit(deps.sql, { actorUserId: ctx.userId, actorKind: "user", action: "submission_pack_viewed", entity: "claim_leg", entityId: legId });

  const fields = [
    { label: "שם המטופל/ת", value: claim.memberName },
    { label: "סוג השירות", value: CATEGORY_INFO[claim.category].label },
    { label: "נותן השירות", value: claim.providerName ?? "—" },
    { label: "תאריך השירות", value: claim.serviceDate ?? "—" },
    { label: "סכום ששולם", value: formatILS(claim.amountAgorot) },
    ...previous.map((p) => ({ label: `הוחזר מ${p.payerName}`, value: formatILS(p.paidAgorot ?? 0) })),
    { label: "החזר צפוי", value: formatILS(leg.expectedAgorot) },
  ];

  const instructions = [
    `היכנס/י לאתר או לאפליקציה של ${leg.payerName} ובחר/י "בקשת החזר".`,
    `בחר/י את סוג השירות: ${CATEGORY_INFO[claim.category].label}.`,
    "מלא/י את הפרטים מהרשימה (אפשר להעתיק בלחיצה).",
    "צרף/י את המסמכים שמופיעים למטה.",
    "אחרי השליחה, חזור/י לכאן ולחץ/י \"הגשתי\" – ונעקוב בשבילך.",
  ];
  if (previous.length > 0) instructions.splice(3, 0, `צרף/י גם את אישור התשלום מ${previous.map((p) => p.payerName).join(" ו")}.`);

  return {
    legId,
    payerName: leg.payerName,
    channel: leg.submissionChannel,
    instructions,
    fields,
    documents: docRows.map((d) => ({ kind: d.kind as DocKind, url: signedFileUrl(deps, d.id as string, 3600) })),
    deepLink: (payer?.appDeepLink as string | null) ?? null,
    webUrl: (payer?.webUrl as string | null) ?? null,
  };
}

// ---------- jobs ----------

registerJobHandler("submit_leg", async (deps, payload) => {
  const legId = payload.legId as string;
  const [row] = await deps.sql`
    SELECT l.id, l.status, l.expected_agorot, l.claim_id, p.claims_email, p.name_he AS payer_name,
           c.category, c.provider_name, c.service_date, c.amount_agorot, c.household_id, m.full_name AS member_name
    FROM claim_legs l JOIN payers p ON p.id = l.payer_id JOIN claims c ON c.id = l.claim_id JOIN members m ON m.id = c.member_id
    WHERE l.id = ${legId}`;
  if (!row) throw new PermanentJobError("leg not found");
  if (row.status !== "ready") return;
  if (!row.claimsEmail) throw new PermanentJobError("payer has no claims email");

  const docs = await deps.sql`
    SELECT d.id, d.kind, d.mime_type FROM claim_required_docs crd JOIN documents d ON d.id = crd.document_id
    WHERE crd.claim_id = ${row.claimId as string} AND crd.status = 'provided'`;
  const attachments = [];
  for (const d of docs) {
    const file = await readDocument(deps, d.id as string);
    const ext = file.mimeType === "application/pdf" ? "pdf" : file.mimeType.split("/")[1];
    attachments.push({ filename: `${d.kind as string}-${(d.id as string).slice(0, 8)}.${ext}`, content: file.data, contentType: file.mimeType });
  }
  await deps.email.send({
    to: row.claimsEmail as string,
    subject: `בקשת החזר – ${row.memberName as string} – ${CATEGORY_INFO[row.category as BenefitCategory].label}`,
    text: [
      `שלום רב,`,
      ``,
      `מצורפת בקשת החזר עבור ${row.memberName as string}, המוגשת באמצעות שירות "מגיע לי" על פי ייפוי כוח חתום.`,
      `סוג השירות: ${CATEGORY_INFO[row.category as BenefitCategory].label}`,
      `נותן השירות: ${(row.providerName as string | null) ?? "—"}`,
      `תאריך: ${row.serviceDate as string}`,
      `סכום ששולם: ${formatILS(row.amountAgorot as number)}`,
      ``,
      `ייפוי הכוח מוגבל להגשת הבקשה ולקבלת עדכוני סטטוס בלבד. התשלום יועבר ישירות למבוטח/ת.`,
    ].join("\n"),
    attachments,
  });
  await transitionLeg(deps, legId, { to: "submitted", actor: "system", actorId: null });
});

registerJobHandler("remind_missing_docs", async (deps, payload) => {
  const [c] = await deps.sql`
    SELECT c.id, c.status, c.total_expected_agorot, h.owner_user_id, m.full_name
    FROM claims c JOIN households h ON h.id = c.household_id JOIN members m ON m.id = c.member_id
    WHERE c.id = ${payload.claimId as string}`;
  if (!c || c.status !== "awaiting_documents") return;
  const [doc] = await deps.sql`
    SELECT kind FROM claim_required_docs WHERE claim_id = ${c.id as string} AND status = 'missing' ORDER BY kind LIMIT 1`;
  await notify(deps.sql, deps.now(), c.ownerUserId as string, {
    type: "missing_document",
    title: `חסר ${DOC_LABEL[(doc?.kind as string) ?? "receipt"] ?? "מסמך"}`,
    body: `לתביעה של ${c.fullName as string} (${formatILS(c.totalExpectedAgorot as number)}). הוספה לוקחת דקה`,
    data: { claimId: c.id },
  });
});
