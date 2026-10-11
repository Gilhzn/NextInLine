import { CATEGORY_INFO, TYPICAL_PRICE_AGOROT, computeRouting, usageKey, type BenefitCategory } from "@magiali/shared";
import type { Deps } from "../context";
import { currentCatalogVersion } from "../catalog";
import { loadRoutingEnrollments, loadUsage } from "./coverage";
import { listMembers } from "./households";

export interface UnusedQuota {
  memberId: string;
  memberName: string;
  category: BenefitCategory;
  label: string;
  icon: string;
  planName: string;
  perYear: number;
  left: number;
  /** What one more visit returns, at the price this family usually pays for it. */
  valueEachAgorot: number;
  avgPriceAgorot: number;
}

const isoDay = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Annual session quotas that still have sessions left this calendar year – only for services the member actually
 * used since `usedSince` (we don't nudge people towards care they don't need). Valued at the family's own average price.
 */
export async function unusedQuotas(deps: Deps, householdId: string, usedSince: string): Promise<UnusedQuota[]> {
  const now = deps.now();
  const year = now.getUTCFullYear();
  const catalogVersion = await currentCatalogVersion(deps.sql);
  const members = (await listMembers(deps.sql, householdId)).filter((m) => m.consentStatus !== "pending");
  const spend = await deps.sql`
    SELECT member_id, category, sum(sessions)::int AS visits, sum(amount_agorot)::int AS paid
    FROM receipts
    WHERE household_id = ${householdId} AND deleted_at IS NULL AND confirmed_at IS NOT NULL
      AND member_id IS NOT NULL AND category IS NOT NULL AND amount_agorot IS NOT NULL
      AND service_date BETWEEN ${usedSince} AND ${isoDay(now)}
    GROUP BY member_id, category`;
  const out: UnusedQuota[] = [];
  for (const m of members) {
    const used = spend.filter((s) => s.memberId === m.id);
    if (!used.length) continue;
    const enrollments = await loadRoutingEnrollments(deps.sql, m.id, catalogVersion);
    if (!enrollments.length) continue;
    const usage = await loadUsage(deps.sql, m.id, year);
    for (const s of used) {
      const category = s.category as BenefitCategory;
      const quota = enrollments.map((e) => ({ e, rule: e.benefits[category] })).find((x) => x.rule && x.rule.annualSessions !== null);
      if (!quota) continue;
      const u = usage[usageKey(quota.e.planId, category)] ?? { sessions: 0, amountAgorot: 0 };
      const left = quota.rule!.annualSessions! - u.sessions;
      if (left <= 0) continue;
      const avgPrice = (s.visits as number) > 0 ? Math.round((s.paid as number) / (s.visits as number)) : TYPICAL_PRICE_AGOROT[category];
      const one = computeRouting({
        category,
        amountAgorot: avgPrice,
        sessions: 1,
        serviceDate: isoDay(now),
        memberBirthDate: m.birthDate,
        enrollments,
        usage,
      });
      if (one.totalExpectedAgorot === 0) continue;
      out.push({
        memberId: m.id,
        memberName: m.fullName,
        category,
        label: CATEGORY_INFO[category].label,
        icon: CATEGORY_INFO[category].icon,
        planName: quota.e.planName,
        perYear: quota.rule!.annualSessions!,
        left,
        valueEachAgorot: one.totalExpectedAgorot,
        avgPriceAgorot: avgPrice,
      });
    }
  }
  return out.sort((a, b) => b.valueEachAgorot * b.left - a.valueEachAgorot * a.left);
}
