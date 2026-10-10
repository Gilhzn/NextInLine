import { CATEGORY_INFO, type HomeDto } from "@magiali/shared";
import type { AuthContext, Deps } from "../context";
import { coverageMap } from "./coverage";

export async function getHome(deps: Deps, ctx: AuthContext): Promise<HomeDto> {
  const now = deps.now();
  const yearStart = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));

  const [paid] = await deps.sql`
    SELECT COALESCE(sum(l.paid_agorot), 0)::int AS total
    FROM claim_legs l JOIN claims c ON c.id = l.claim_id
    WHERE c.household_id = ${ctx.householdId} AND l.status = 'paid' AND l.paid_at >= ${yearStart}`;
  const [inFlight] = await deps.sql`
    SELECT COALESCE(sum(l.expected_agorot), 0)::int AS total, count(DISTINCT c.id)::int AS claims
    FROM claim_legs l JOIN claims c ON c.id = l.claim_id
    WHERE c.household_id = ${ctx.householdId} AND c.status = 'in_progress'
      AND l.status NOT IN ('paid', 'rejected', 'skipped')`;

  const actionItems: HomeDto["actionItems"] = [];

  const toConfirm = await deps.sql`
    SELECT id, amount_agorot FROM receipts
    WHERE household_id = ${ctx.householdId} AND deleted_at IS NULL AND confirmed_at IS NULL
      AND extraction_status IN ('done', 'manual', 'failed')
    ORDER BY created_at DESC LIMIT 5`;
  for (const r of toConfirm) {
    actionItems.push({
      type: "confirm_receipt",
      title: "קבלה מחכה לאישור פרטים",
      receiptId: r.id as string,
      amountAgorot: (r.amountAgorot as number | null) ?? undefined,
    });
  }

  const missing = await deps.sql`
    SELECT c.id, c.total_expected_agorot, m.full_name FROM claims c JOIN members m ON m.id = c.member_id
    WHERE c.household_id = ${ctx.householdId} AND c.status = 'awaiting_documents' ORDER BY c.created_at`;
  for (const c of missing) {
    actionItems.push({
      type: "missing_document",
      title: `חסר מסמך לתביעה של ${c.fullName as string}`,
      claimId: c.id as string,
      amountAgorot: c.totalExpectedAgorot as number,
    });
  }

  const toSubmit = await deps.sql`
    SELECT DISTINCT c.id, c.total_expected_agorot, m.full_name, c.status
    FROM claims c JOIN members m ON m.id = c.member_id
    LEFT JOIN claim_legs l ON l.claim_id = c.id
    WHERE c.household_id = ${ctx.householdId}
      AND (c.status = 'ready'
           OR (c.status = 'in_progress' AND l.status = 'ready' AND l.submission_channel = 'user_handoff'))`;
  for (const c of toSubmit) {
    actionItems.push({
      type: "ready_to_submit",
      title: c.status === "ready" ? `תביעה של ${c.fullName as string} מוכנה להגשה` : `שלב הבא מוכן להגשה (${c.fullName as string})`,
      claimId: c.id as string,
      amountAgorot: c.totalExpectedAgorot as number,
    });
  }

  const pendingConsent = await deps.sql`
    SELECT id, full_name FROM members WHERE household_id = ${ctx.householdId} AND consent_status = 'pending' AND deleted_at IS NULL`;
  for (const m of pendingConsent) {
    actionItems.push({ type: "consent_pending", title: `מחכים לאישור של ${m.fullName as string}`, memberId: m.id as string });
  }

  // Opportunities: session-based benefits already used this year with sessions still left.
  const opportunities: HomeDto["opportunities"] = [];
  const map = await coverageMap(deps.sql, ctx.householdId, now);
  for (const item of map) {
    for (const member of item.members) {
      for (const plan of member.plans) {
        if (plan.remainingSessions === null || plan.remainingSessions === 0) continue;
        const [used] = await deps.sql`
          SELECT 1 FROM claims c JOIN claim_legs l ON l.claim_id = c.id
          WHERE c.member_id = ${member.memberId} AND c.category = ${item.category} AND l.plan_id = ${plan.planId}
            AND c.status <> 'cancelled' AND extract(year FROM c.service_date) = ${now.getUTCFullYear()}
          LIMIT 1`;
        if (!used) continue;
        opportunities.push({
          category: item.category,
          title: `${CATEGORY_INFO[item.category].icon} נשארו ל${member.memberName} ${plan.remainingSessions} מפגשי ${item.label}`,
          detail: `ב${plan.planName}, עד 31.12. צלם את הקבלה אחרי כל מפגש`,
        });
      }
    }
  }

  return {
    yearPaidAgorot: paid?.total as number,
    inFlightAgorot: inFlight?.total as number,
    inFlightCount: inFlight?.claims as number,
    actionItems,
    opportunities: opportunities.slice(0, 3),
  };
}
