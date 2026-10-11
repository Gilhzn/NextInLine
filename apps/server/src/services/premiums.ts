import { CATEGORY_INFO, type BenefitCategory, type PremiumPlanDto, type PremiumsDto } from "@magiali/shared";
import type { AuthContext, Deps } from "../context";
import { currentCatalogVersion } from "../catalog";
import { notFound } from "../errors";
import { audit } from "./audit";
import { loadRoutingEnrollments } from "./coverage";
import { listMembers } from "./households";

const DAY = 86_400_000;
const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const time = (iso: string) => new Date(`${iso}T00:00:00Z`).getTime();

/** Whole months a policy was active inside [from, to]. */
function activeMonths(validFrom: string, validTo: string | null, from: string, to: string): number {
  const start = Math.max(time(from), time(validFrom));
  const end = Math.min(time(to), validTo ? time(validTo) : time(to));
  return end <= start ? 0 : Math.min(12, Math.round((end - start) / DAY / 30.4375));
}

/**
 * What each policy cost over the last 12 months next to what it actually returned on receipts – plus services two
 * private policies both cover for the same person. Information only: we never recommend buying or cancelling insurance.
 */
export async function premiumsOverview(deps: Deps, ctx: AuthContext): Promise<PremiumsDto> {
  const now = deps.now();
  const to = isoDay(now);
  const from = isoDay(new Date(now.getTime() - 365 * DAY));
  const members = (await listMembers(deps.sql, ctx.householdId)).filter((m) => m.consentStatus !== "pending");
  const catalogVersion = await currentCatalogVersion(deps.sql);

  const rows = await deps.sql`
    SELECT e.member_id, e.plan_id, e.monthly_premium_agorot, e.valid_from::text AS valid_from, e.valid_to::text AS valid_to,
           p.name_he, p.plan_kind
    FROM enrollments e JOIN members m ON m.id = e.member_id JOIN plans p ON p.id = e.plan_id
    WHERE m.household_id = ${ctx.householdId} AND m.deleted_at IS NULL
    ORDER BY CASE p.plan_kind WHEN 'shaban' THEN 0 WHEN 'private_individual' THEN 1 ELSE 2 END, p.name_he, m.created_at`;
  const money = await deps.sql`
    SELECT l.plan_id,
           COALESCE(sum(l.paid_agorot) FILTER (WHERE l.status = 'paid' AND COALESCE(l.paid_at, c.updated_at) >= ${from}::date), 0)::int AS refunds,
           COALESCE(sum(l.expected_agorot) FILTER (WHERE l.status NOT IN ('paid', 'rejected', 'skipped')), 0)::int AS waiting,
           COALESCE(array_agg(DISTINCT c.category) FILTER (WHERE l.status = 'paid' AND COALESCE(l.paid_at, c.updated_at) >= ${from}::date), '{}') AS categories
    FROM claim_legs l JOIN claims c ON c.id = l.claim_id
    WHERE c.household_id = ${ctx.householdId} AND c.status <> 'cancelled'
    GROUP BY l.plan_id`;
  const moneyByPlan = new Map(money.map((m) => [m.planId as string, m]));

  const memberById = new Map(members.map((m) => [m.id, m]));
  const covered = new Map<string, Set<BenefitCategory>>();
  const overlaps: PremiumsDto["overlaps"] = [];
  for (const m of members) {
    const enrollments = await loadRoutingEnrollments(deps.sql, m.id, catalogVersion);
    const byCategory = new Map<BenefitCategory, string[]>();
    for (const e of enrollments) {
      const cats = Object.keys(e.benefits) as BenefitCategory[];
      const set = covered.get(e.planId) ?? new Set();
      for (const c of cats) set.add(c);
      covered.set(e.planId, set);
      if (e.planKind === "shaban") continue;
      for (const c of cats) byCategory.set(c, [...(byCategory.get(c) ?? []), e.planName]);
    }
    for (const [c, names] of byCategory) {
      if (names.length > 1) overlaps.push({ memberName: m.fullName, label: CATEGORY_INFO[c].label, icon: CATEGORY_INFO[c].icon, planNames: names });
    }
  }

  const plans = new Map<string, PremiumPlanDto>();
  for (const r of rows) {
    const member = memberById.get(r.memberId as string);
    if (!member) continue;
    const planId = r.planId as string;
    let plan = plans.get(planId);
    if (!plan) {
      const m = moneyByPlan.get(planId);
      plan = {
        planId,
        planName: r.nameHe as string,
        planKind: r.planKind as PremiumPlanDto["planKind"],
        members: [],
        monthlyPremiumAgorot: null,
        premiumsAgorot: null,
        refundsAgorot: (m?.refunds as number) ?? 0,
        waitingAgorot: (m?.waiting as number) ?? 0,
        servicesUsed: ((m?.categories as BenefitCategory[]) ?? []).map((c) => CATEGORY_INFO[c].label),
        servicesCovered: covered.get(planId)?.size ?? 0,
      };
      plans.set(planId, plan);
    }
    const premium = r.monthlyPremiumAgorot as number | null;
    plan.members.push({ memberId: member.id, memberName: member.fullName, monthlyPremiumAgorot: premium });
    if (premium !== null) {
      plan.monthlyPremiumAgorot = (plan.monthlyPremiumAgorot ?? 0) + premium;
      plan.premiumsAgorot = (plan.premiumsAgorot ?? 0) + premium * activeMonths(r.validFrom as string, r.validTo as string | null, from, to);
    }
  }

  const list = [...plans.values()];
  const known = list.filter((p) => p.premiumsAgorot !== null);
  const totals = {
    premiumsAgorot: known.reduce((s, p) => s + p.premiumsAgorot!, 0),
    refundsAgorot: known.reduce((s, p) => s + p.refundsAgorot, 0),
    waitingAgorot: known.reduce((s, p) => s + p.waitingAgorot, 0),
    plansWithoutPremium: list.length - known.length,
  };
  const notes = [
    "ההשוואה כוללת רק החזרים על קבלות. ביטוח בריאות נועד גם לאירועים גדולים ונדירים – ניתוח, תרופה יקרה, השתלה – שלא מופיעים כאן.",
    "זה מידע בלבד, לא ייעוץ ולא המלצה. לפני כל שינוי בביטוח כדאי להתייעץ עם בעל רישיון: ביטול והצטרפות מחדש עלולים לכלול תקופת אכשרה, חיתום רפואי מחדש והחרגות.",
  ];
  if (totals.plansWithoutPremium > 0) {
    notes.unshift("הזינו כמה משלמים בחודש כדי שנשווה. את הסכום מוצאים בהר הביטוח, בפירוט האשראי או באזור האישי של הקופה וחברת הביטוח.");
  }
  if (overlaps.length > 0) {
    notes.push("כשיש שני ביטוחים לאותו שירות, ההחזר הכולל לא יעלה על ההוצאה. אפשר לבדוק מול חברות הביטוח אם יש כפל ביטוחי.");
  }
  return { from, to, plans: list, totals, overlaps, notes };
}

export async function setPremium(deps: Deps, ctx: AuthContext, memberId: string, planId: string, monthlyPremiumAgorot: number | null): Promise<void> {
  const [row] = await deps.sql`
    UPDATE enrollments e SET monthly_premium_agorot = ${monthlyPremiumAgorot}
    FROM members m
    WHERE m.id = e.member_id AND m.household_id = ${ctx.householdId} AND m.deleted_at IS NULL
      AND e.member_id = ${memberId} AND e.plan_id = ${planId}
    RETURNING e.id`;
  if (!row) throw notFound("הביטוח");
  await audit(deps.sql, {
    actorUserId: ctx.userId,
    actorKind: "user",
    action: "premium_set",
    entity: "enrollment",
    entityId: row.id as string,
    meta: { planId },
  });
}
