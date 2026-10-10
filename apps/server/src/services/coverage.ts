import {
  BENEFIT_CATEGORIES,
  CATEGORY_INFO,
  benefitRuleSchema,
  computeRouting,
  usageKey,
  type BenefitCategory,
  type BenefitRule,
  type BenefitConfidence,
  type CoverageItemDto,
  type PolicyTermsDto,
  type PlanKind,
  type RoutingEnrollment,
  type RoutingResult,
  type UsageLedger,
} from "@magiali/shared";
import type { Db } from "../db";
import { currentCatalogVersion } from "../catalog";
import { getMemberForHousehold, listMembers } from "./households";
import { notFound } from "../errors";

/** source_note is "<note> | <url>" (either part optional). */
function splitSource(sourceNote: string | null): { note: string | null; sourceUrl: string | null } {
  if (!sourceNote) return { note: null, sourceUrl: null };
  const parts = sourceNote.split(" | ");
  const url = parts.find((p) => /^https?:\/\//.test(p)) ?? null;
  const note = parts.filter((p) => p !== url).join(" | ") || null;
  return { note, sourceUrl: url };
}

async function catalogSources(db: Db, catalogVersion: number) {
  const rows = await db`SELECT plan_id, category, confidence, source_note FROM benefits WHERE catalog_version = ${catalogVersion}`;
  return new Map(
    rows.map((r) => [
      `${r.planId}:${r.category}`,
      { confidence: r.confidence as BenefitConfidence, ...splitSource(r.sourceNote as string | null) },
    ]),
  );
}

export async function loadRoutingEnrollments(db: Db, memberId: string, catalogVersion: number): Promise<RoutingEnrollment[]> {
  const rows = await db`
    SELECT e.plan_id, e.is_shaban_supplement, e.valid_from, e.valid_to, e.custom_benefits,
           p.name_he AS plan_name, p.payer_id, p.plan_kind,
           COALESCE(jsonb_object_agg(b.category, b.rule) FILTER (WHERE b.category IS NOT NULL), '{}'::jsonb) AS benefits
    FROM enrollments e
    JOIN plans p ON p.id = e.plan_id
    LEFT JOIN benefits b ON b.plan_id = e.plan_id AND b.catalog_version = ${catalogVersion}
    WHERE e.member_id = ${memberId}
    GROUP BY e.id, p.id
    ORDER BY CASE p.plan_kind WHEN 'shaban' THEN 0 WHEN 'private_individual' THEN 1 ELSE 2 END, e.is_shaban_supplement DESC, p.id`;
  return rows.map((r) => {
    // The user's own policy terms win over the catalog; null means "my policy doesn't cover this".
    const raw = { ...(r.benefits as Record<string, unknown>), ...(r.customBenefits as Record<string, unknown>) };
    const benefits: Partial<Record<BenefitCategory, BenefitRule>> = {};
    for (const [category, rule] of Object.entries(raw)) {
      if (rule === null) continue;
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

  const sources = await catalogSources(db, catalogVersion);

  for (const member of members) {
    const enrollments = await loadRoutingEnrollments(db, member.id, catalogVersion);
    const customRows = await db`SELECT plan_id, custom_benefits FROM enrollments WHERE member_id = ${member.id}`;
    const custom = new Map(customRows.map((r) => [r.planId as string, r.customBenefits as Record<string, unknown>]));
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
          ...(category in (custom.get(e.planId) ?? {})
            ? { confidence: "custom" as const, note: "לפי התנאים שהזנת מהפוליסה שלך", sourceUrl: null }
            : (sources.get(`${e.planId}:${category}`) ?? { confidence: "unverified" as const, note: null, sourceUrl: null })),
        });
      }
    }
  }
  return BENEFIT_CATEGORIES.filter((c) => byCategory.has(c)).map((c) => byCategory.get(c)!);
}

/** A member's policy, category by category: the catalog value and the user's own override, if any. */
export async function getPolicyTerms(db: Db, householdId: string, memberId: string, planId: string): Promise<PolicyTermsDto> {
  await getMemberForHousehold(db, householdId, memberId);
  const [e] = await db`
    SELECT e.custom_benefits, p.name_he, p.plan_kind, p.description
    FROM enrollments e JOIN plans p ON p.id = e.plan_id
    WHERE e.member_id = ${memberId} AND e.plan_id = ${planId}`;
  if (!e) throw notFound("הביטוח");
  const catalogVersion = await currentCatalogVersion(db);
  const rows = await db`
    SELECT category, rule, confidence, source_note FROM benefits WHERE catalog_version = ${catalogVersion} AND plan_id = ${planId}`;
  const catalog = new Map(rows.map((r) => [r.category as BenefitCategory, r]));
  const custom = e.customBenefits as Record<string, unknown>;
  return {
    memberId,
    planId,
    planName: e.nameHe as string,
    planKind: e.planKind as PlanKind,
    description: (e.description as string | null) ?? null,
    terms: BENEFIT_CATEGORIES.filter((c) => c !== "other").map((category) => {
      const row = catalog.get(category);
      const rule = row ? benefitRuleSchema.parse(row.rule) : null;
      return {
        category,
        label: CATEGORY_INFO[category].label,
        icon: CATEGORY_INFO[category].icon,
        catalog:
          row && rule
            ? { rule, summary: ruleSummary(rule), confidence: row.confidence as BenefitConfidence, ...splitSource(row.sourceNote as string | null) }
            : null,
        ...(category in custom ? { custom: custom[category] === null ? null : benefitRuleSchema.parse(custom[category]) } : {}),
      };
    }),
  };
}

export async function setPolicyTerm(
  db: Db,
  householdId: string,
  memberId: string,
  planId: string,
  category: BenefitCategory,
  rule: BenefitRule | null | "reset",
): Promise<void> {
  await getMemberForHousehold(db, householdId, memberId);
  const [updated] =
    rule === "reset"
      ? await db`
          UPDATE enrollments SET custom_benefits = custom_benefits - ${category}
          WHERE member_id = ${memberId} AND plan_id = ${planId} RETURNING id`
      : await db`
          UPDATE enrollments SET custom_benefits = custom_benefits || jsonb_build_object(${category}::text, ${rule === null ? null : db.json(rule as never)}::jsonb)
          WHERE member_id = ${memberId} AND plan_id = ${planId} RETURNING id`;
  if (!updated) throw notFound("הביטוח");
}
