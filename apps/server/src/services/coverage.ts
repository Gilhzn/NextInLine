import {
  BENEFIT_CATEGORIES,
  CATEGORY_INFO,
  benefitRuleSchema,
  computeRouting,
  usageKey,
  type BenefitCategory,
  type BenefitRule,
  type CoverageItemDto,
  type PlanKind,
  type RoutingEnrollment,
  type RoutingResult,
  type UsageLedger,
} from "@magiali/shared";
import type { Db } from "../db";
import { currentCatalogVersion } from "../catalog";
import { listMembers } from "./households";

export async function loadRoutingEnrollments(db: Db, memberId: string, catalogVersion: number): Promise<RoutingEnrollment[]> {
  const rows = await db`
    SELECT e.plan_id, e.is_shaban_supplement, e.valid_from, e.valid_to,
           p.name_he AS plan_name, p.payer_id, p.plan_kind,
           COALESCE(jsonb_object_agg(b.category, b.rule) FILTER (WHERE b.category IS NOT NULL), '{}'::jsonb) AS benefits
    FROM enrollments e
    JOIN plans p ON p.id = e.plan_id
    LEFT JOIN benefits b ON b.plan_id = e.plan_id AND b.catalog_version = ${catalogVersion}
    WHERE e.member_id = ${memberId}
    GROUP BY e.id, p.id`;
  return rows.map((r) => {
    const raw = r.benefits as Record<string, unknown>;
    const benefits: Partial<Record<BenefitCategory, BenefitRule>> = {};
    for (const [category, rule] of Object.entries(raw)) {
      benefits[category as BenefitCategory] = benefitRuleSchema.parse(rule);
    }
    return {
      planId: r.planId as string,
      planName: r.planName as string,
      payerId: r.payerId as string,
      planKind: r.planKind as PlanKind,
      isShabanSupplement: r.isShabanSupplement as boolean,
      validFrom: r.validFrom as string,
      validTo: (r.validTo as string | null) ?? null,
      benefits,
    };
  });
}

/** What the member already consumed in a calendar year, per plan and category (excluding one claim, e.g. itself). */
export async function loadUsage(db: Db, memberId: string, year: number, excludeClaimId?: string): Promise<UsageLedger> {
  const rows = await db`
    SELECT l.plan_id, c.category,
           sum(c.sessions)::int AS sessions,
           sum(COALESCE(l.paid_agorot, l.approved_agorot, l.expected_agorot))::int AS amount
    FROM claim_legs l JOIN claims c ON c.id = l.claim_id
    WHERE c.member_id = ${memberId}
      AND c.status <> 'cancelled'
      AND l.status NOT IN ('rejected', 'skipped')
      AND extract(year FROM c.service_date) = ${year}
      AND (${excludeClaimId ?? null}::uuid IS NULL OR c.id <> ${excludeClaimId ?? null})
    GROUP BY l.plan_id, c.category`;
  const ledger: UsageLedger = {};
  for (const r of rows) {
    ledger[usageKey(r.planId as string, r.category as BenefitCategory)] = {
      sessions: r.sessions as number,
      amountAgorot: r.amount as number,
    };
  }
  return ledger;
}

export async function routeForMember(
  db: Db,
  input: {
    memberId: string;
    birthDate: string | null;
    category: BenefitCategory;
    amountAgorot: number;
    sessions: number;
    serviceDate: string;
    excludeClaimId?: string;
    excludePlanIds?: string[];
  },
): Promise<{ routing: RoutingResult; catalogVersion: number }> {
  const catalogVersion = await currentCatalogVersion(db);
  const enrollments = await loadRoutingEnrollments(db, input.memberId, catalogVersion);
  const usage = await loadUsage(db, input.memberId, Number(input.serviceDate.slice(0, 4)), input.excludeClaimId);
  const routing = computeRouting({
    category: input.category,
    amountAgorot: input.amountAgorot,
    sessions: input.sessions,
    serviceDate: input.serviceDate,
    memberBirthDate: input.birthDate,
    enrollments,
    usage,
    excludePlanIds: input.excludePlanIds,
  });
  return { routing, catalogVersion };
}

function shekels(agorot: number): string {
  return (agorot / 100).toLocaleString("en-US", { maximumFractionDigits: 2 });
}

export function ruleSummary(rule: BenefitRule): string {
  const parts: string[] = [];
  if (rule.perSessionFixedAgorot !== null) parts.push(`${shekels(rule.perSessionFixedAgorot)} ₪ למפגש`);
  else {
    parts.push(`${rule.percent}% החזר`);
    if (rule.perSessionCapAgorot !== null) parts.push(`עד ${shekels(rule.perSessionCapAgorot)} ₪ לביקור`);
  }
  if (rule.annualSessions !== null) parts.push(`עד ${rule.annualSessions} מפגשים בשנה`);
  if (rule.annualCapAgorot !== null) parts.push(`תקרה שנתית ${shekels(rule.annualCapAgorot)} ₪`);
  if (rule.maxAge !== null) parts.push(`עד גיל ${rule.maxAge}`);
  return parts.join(" · ");
}

/** Every category the household is covered for, per member and plan, with what is left this year. */
export async function coverageMap(db: Db, householdId: string, now: Date): Promise<CoverageItemDto[]> {
  const catalogVersion = await currentCatalogVersion(db);
  const members = await listMembers(db, householdId);
  const year = now.getUTCFullYear();
  const byCategory = new Map<BenefitCategory, CoverageItemDto>();

  for (const member of members) {
    const enrollments = await loadRoutingEnrollments(db, member.id, catalogVersion);
    const usage = await loadUsage(db, member.id, year);
    for (const e of enrollments) {
      for (const category of BENEFIT_CATEGORIES) {
        const rule = e.benefits[category];
        if (!rule) continue;
        const used = usage[usageKey(e.planId, category)] ?? { sessions: 0, amountAgorot: 0 };
        let item = byCategory.get(category);
        if (!item) {
          item = { category, label: CATEGORY_INFO[category].label, icon: CATEGORY_INFO[category].icon, members: [] };
          byCategory.set(category, item);
        }
        let entry = item.members.find((m) => m.memberId === member.id);
        if (!entry) {
          entry = { memberId: member.id, memberName: member.fullName, plans: [] };
          item.members.push(entry);
        }
        entry.plans.push({
          planId: e.planId,
          planName: e.planName,
          summary: ruleSummary(rule),
          remainingSessions: rule.annualSessions !== null ? Math.max(0, rule.annualSessions - used.sessions) : null,
          remainingCapAgorot: rule.annualCapAgorot !== null ? Math.max(0, rule.annualCapAgorot - used.amountAgorot) : null,
        });
      }
    }
  }
  return BENEFIT_CATEGORIES.filter((c) => byCategory.has(c)).map((c) => byCategory.get(c)!);
}
