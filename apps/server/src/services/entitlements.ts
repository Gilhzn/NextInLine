import {
  BENEFIT_CATEGORIES,
  CATEGORY_INFO,
  TYPICAL_PRICE_AGOROT,
  computeRouting,
  usageKey,
  type BenefitCategory,
  type EntitlementCategoryDto,
  type EntitlementEstimateDto,
  type EntitlementSummaryDto,
} from "@magiali/shared";
import type { AuthContext, Deps } from "../context";
import { currentCatalogVersion } from "../catalog";
import { notFound } from "../errors";
import { loadRoutingEnrollments, loadUsage } from "./coverage";
import { ageOn, listMembers } from "./households";

/** Things people commonly pay for privately – if nobody is covered for one, we say so. */
const COMMON: BenefitCategory[] = [
  "specialist_visit",
  "second_opinion",
  "physiotherapy",
  "psychology",
  "child_development",
  "diagnostic_imaging",
  "alternative_medicine",
  "glasses_lenses",
  "dental",
];

/** Claims can go back 3 years (statute of limitations on insurance claims). */
const CLAIM_YEARS = 3;

const isoDay = (d: Date) => d.toISOString().slice(0, 10);

async function activeMembers(deps: Deps, ctx: AuthContext) {
  const members = await listMembers(deps.sql, ctx.householdId);
  return {
    usable: members.filter((m) => m.consentStatus !== "pending"),
    pending: members.filter((m) => m.consentStatus === "pending").map((m) => m.fullName),
  };
}

/**
 * Everything the household can get back, in one place: per member and service, what a typical visit returns
 * today (after this year's usage), what is left of each quota, which policies still lack terms, and the gaps.
 */
export async function entitlementSummary(deps: Deps, ctx: AuthContext): Promise<EntitlementSummaryDto> {
  const catalogVersion = await currentCatalogVersion(deps.sql);
  const now = deps.now();
  const today = isoDay(now);
  const { usable, pending } = await activeMembers(deps, ctx);
  const covered = new Set<BenefitCategory>();
  const result: EntitlementSummaryDto["members"] = [];

  for (const member of usable) {
    const enrollments = await loadRoutingEnrollments(deps.sql, member.id, catalogVersion);
    const usage = await loadUsage(deps.sql, member.id, now.getUTCFullYear());
    const categories: EntitlementCategoryDto[] = [];
    for (const category of BENEFIT_CATEGORIES) {
      if (!enrollments.some((e) => e.benefits[category])) continue;
      const price = TYPICAL_PRICE_AGOROT[category];
      const routing = computeRouting({
        category,
        amountAgorot: price,
        sessions: 1,
        serviceDate: today,
        memberBirthDate: member.birthDate,
        enrollments,
        usage,
      });
      // Age limits etc. can rule a category out for this member even though a plan lists it.
      if (routing.totalExpectedAgorot === 0 && routing.legs.length === 0 && routing.notes.some((n) => n.includes("גיל"))) continue;
      covered.add(category);
      categories.push({
        category,
        label: CATEGORY_INFO[category].label,
        icon: CATEGORY_INFO[category].icon,
        example: {
          priceAgorot: price,
          refundAgorot: routing.totalExpectedAgorot,
          legs: routing.legs.map((l) => ({ planName: l.planName, amountAgorot: l.expectedAgorot })),
        },
        remaining: enrollments
          .filter((e) => e.benefits[category])
          .map((e) => {
            const rule = e.benefits[category]!;
            const used = usage[usageKey(e.planId, category)] ?? { sessions: 0, amountAgorot: 0 };
            return {
              planName: e.planName,
              sessions: rule.annualSessions !== null ? Math.max(0, rule.annualSessions - used.sessions) : null,
              capAgorot: rule.annualCapAgorot !== null ? Math.max(0, rule.annualCapAgorot - used.amountAgorot) : null,
            };
          }),
        requiredDocs: routing.requiredDocs,
        notes: routing.notes,
      });
    }
    // Most money first.
    categories.sort((a, b) => b.example.refundAgorot - a.example.refundAgorot);
    result.push({ memberId: member.id, memberName: member.fullName, categories });
  }

  const hasChild = usable.some((m) => m.birthDate && ageOn(m.birthDate, now) < 18);
  const gaps = COMMON.filter((c) => !covered.has(c) && (c !== "child_development" || hasChild)).map((c) => ({
    category: c,
    label: CATEGORY_INFO[c].label,
    icon: CATEGORY_INFO[c].icon,
  }));

  // Policies with neither catalog values nor terms the user entered: we can't calculate them yet.
  const missing = await deps.sql`
    SELECT e.member_id, m.full_name, e.plan_id, p.name_he
    FROM enrollments e JOIN members m ON m.id = e.member_id JOIN plans p ON p.id = e.plan_id
    WHERE m.household_id = ${ctx.householdId} AND m.deleted_at IS NULL
      AND e.custom_benefits = '{}'::jsonb
      AND NOT EXISTS (SELECT 1 FROM benefits b WHERE b.plan_id = e.plan_id AND b.catalog_version = ${catalogVersion})
    ORDER BY m.created_at, p.name_he`;

  const [unclaimed] = await deps.sql`
    SELECT count(*)::int AS n, COALESCE(sum(r.amount_agorot), 0)::int AS total FROM receipts r
    WHERE r.household_id = ${ctx.householdId} AND r.deleted_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM claim_receipts cr JOIN claims c ON c.id = cr.claim_id
                      WHERE cr.receipt_id = r.id AND c.status <> 'cancelled')`;
  const [inFlight] = await deps.sql`
    SELECT COALESCE(sum(l.expected_agorot), 0)::int AS total
    FROM claim_legs l JOIN claims c ON c.id = l.claim_id
    WHERE c.household_id = ${ctx.householdId} AND c.status = 'in_progress' AND l.status NOT IN ('paid', 'rejected', 'skipped')`;

  return {
    members: result,
    gaps,
    missingTerms: missing.map((r) => ({
      memberId: r.memberId as string,
      memberName: r.fullName as string,
      planId: r.planId as string,
      planName: r.nameHe as string,
    })),
    pendingConsent: pending,
    openMoney: {
      unclaimedReceipts: unclaimed!.n as number,
      unclaimedAgorot: unclaimed!.total as number,
      inFlightAgorot: inFlight!.total as number,
    },
  };
}

/**
 * "How much might be waiting from the last 3 years?" The user says roughly how many times they paid privately
 * and what it cost; we spread the visits over the claim window and run the real rules year by year (annual
 * session limits and caps apply per year). An estimate – the receipts decide.
 */
export async function estimateEntitlements(
  deps: Deps,
  ctx: AuthContext,
  items: Array<{ memberId: string; category: BenefitCategory; visits: number; priceAgorot: number }>,
): Promise<EntitlementEstimateDto> {
  const catalogVersion = await currentCatalogVersion(deps.sql);
  const { usable } = await activeMembers(deps, ctx);
  const byId = new Map(usable.map((m) => [m.id, m]));
  const enrollmentsCache = new Map<string, Awaited<ReturnType<typeof loadRoutingEnrollments>>>();
  const now = deps.now();
  const out: EntitlementEstimateDto["items"] = [];

  for (const item of items) {
    const member = byId.get(item.memberId);
    if (!member) throw notFound("בן המשפחה");
    if (!enrollmentsCache.has(member.id)) enrollmentsCache.set(member.id, await loadRoutingEnrollments(deps.sql, member.id, catalogVersion));
    const enrollments = enrollmentsCache.get(member.id)!;

    let refund = 0;
    for (let k = 0; k < CLAIM_YEARS; k++) {
      // Visits spread evenly; the remainder goes to the most recent years.
      const visits = Math.floor(item.visits / CLAIM_YEARS) + (k < item.visits % CLAIM_YEARS ? 1 : 0);
      if (visits === 0) continue;
      const serviceDate = isoDay(new Date(now.getTime() - (k * 365 + 120) * 86_400_000));
      const routing = computeRouting({
        category: item.category,
        amountAgorot: visits * item.priceAgorot,
        sessions: visits,
        serviceDate,
        memberBirthDate: member.birthDate,
        enrollments,
      });
      refund += routing.totalExpectedAgorot;
    }
    out.push({ ...item, refundAgorot: refund });
  }
  return { items: out, totalAgorot: out.reduce((s, i) => s + i.refundAgorot, 0) };
}
