import {
  CATEGORY_INFO,
  TYPICAL_PRICE_AGOROT,
  computeRouting,
  formatILS,
  usageKey,
  type BeforeBookingDto,
  type BookingOptionDto,
  type RoutingResult,
  type beforeBookingSchema,
} from "@magiali/shared";
import type { z } from "zod";
import type { AuthContext, Deps } from "../context";
import { currentCatalogVersion } from "../catalog";
import { notFound } from "../errors";
import { loadRoutingEnrollments, loadUsage } from "./coverage";
import { listMembers } from "./households";

const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const dateHe = (iso: string) => iso.split("-").reverse().join("/");
/** ₪100,000 – far above any visit; used to find where the refund stops growing. */
const HIGH_PRICE = 10_000_000;

/**
 * "Before booking": for one person and service, what a visit will really cost after every refund, compared across
 * up to three places (private, or an in-network co-payment the user looked up), where the refund stops growing,
 * what is left of this year's quota, and what to arrange before the visit (e.g. a referral) so the claim isn't lost.
 */
export async function beforeBooking(
  deps: Deps,
  ctx: AuthContext,
  input: z.output<typeof beforeBookingSchema>,
): Promise<BeforeBookingDto> {
  const member = (await listMembers(deps.sql, ctx.householdId)).find((m) => m.id === input.memberId && m.consentStatus !== "pending");
  if (!member) throw notFound("בן המשפחה");
  const { category, sessions } = input;
  const date = input.date ?? isoDay(deps.now());
  const year = Number(date.slice(0, 4));
  const enrollments = await loadRoutingEnrollments(deps.sql, member.id, await currentCatalogVersion(deps.sql));
  const usage = await loadUsage(deps.sql, member.id, year);
  const route = (pricePerSession: number, n = sessions): RoutingResult =>
    computeRouting({
      category,
      amountAgorot: pricePerSession * n,
      sessions: n,
      serviceDate: date,
      memberBirthDate: member.birthDate,
      enrollments,
      usage,
    });

  const [hist] = await deps.sql`
    SELECT sum(sessions)::int AS visits, sum(amount_agorot)::int AS paid FROM receipts
    WHERE household_id = ${ctx.householdId} AND member_id = ${member.id} AND category = ${category}
      AND deleted_at IS NULL AND confirmed_at IS NOT NULL AND amount_agorot IS NOT NULL
      AND service_date >= ${isoDay(new Date(deps.now().getTime() - 3 * 365 * 86_400_000))}`;
  const history = hist?.visits ? { visits: hist.visits as number, avgPriceAgorot: Math.round((hist.paid as number) / (hist.visits as number)) } : null;
  const suggestedPriceAgorot = history?.avgPriceAgorot ?? TYPICAL_PRICE_AGOROT[category];

  const asked = input.options.length ? input.options : [{ priceAgorot: suggestedPriceAgorot, kind: "private" as const, label: undefined }];
  let privateRouting: RoutingResult | null = null;
  const options: BookingOptionDto[] = asked.map((o, i) => {
    const price = o.priceAgorot * sessions;
    if (o.kind === "network") {
      // In-network: the family pays the quoted co-payment and claims nothing.
      return { label: o.label || "בהסדר", kind: "network", priceAgorot: price, refundAgorot: 0, netAgorot: price, legs: [], best: false };
    }
    const routing = route(o.priceAgorot);
    privateRouting ??= routing;
    return {
      label: o.label || (asked.filter((x) => x.kind !== "network").length > 1 ? `פרטי ${i + 1}` : "פרטי"),
      kind: "private",
      priceAgorot: price,
      refundAgorot: routing.totalExpectedAgorot,
      netAgorot: price - routing.totalExpectedAgorot,
      legs: routing.legs.map((l) => ({ planName: l.planName, amountAgorot: l.expectedAgorot, basis: l.basis })),
      best: false,
    };
  });
  if (options.length > 1) {
    const cheapest = Math.min(...options.map((o) => o.netAgorot));
    for (const o of options) o.best = o.netAgorot === cheapest;
  }
  const reference: RoutingResult = privateRouting ?? route(suggestedPriceAgorot);

  // Where the refund for one visit stops growing (a per-visit cap or a fixed amount).
  let maxRefund: BeforeBookingDto["maxRefund"] = null;
  const top = route(HIGH_PRICE, 1).totalExpectedAgorot;
  if (top > 0 && route(HIGH_PRICE / 2, 1).totalExpectedAgorot === top) {
    let lo = 1;
    let hi = HIGH_PRICE / 2;
    while (lo < hi) {
      const mid = Math.floor((lo + hi) / 2);
      if (route(mid, 1).totalExpectedAgorot >= top) hi = mid;
      else lo = mid + 1;
    }
    maxRefund = { refundAgorot: top, fromPriceAgorot: Math.ceil(lo / 100) * 100 };
  }

  const quota = enrollments
    .filter((e) => e.benefits[category])
    .map((e) => {
      const rule = e.benefits[category]!;
      const used = usage[usageKey(e.planId, category)] ?? { sessions: 0, amountAgorot: 0 };
      return {
        planName: e.planName,
        perYear: rule.annualSessions,
        sessionsLeft: rule.annualSessions !== null ? Math.max(0, rule.annualSessions - used.sessions) : null,
        capLeftAgorot: rule.annualCapAgorot !== null ? Math.max(0, rule.annualCapAgorot - used.amountAgorot) : null,
      };
    });
  const exhausted = quota.some((q) => q.sessionsLeft === 0 || q.capLeftAgorot === 0);
  const covered = quota.length > 0;

  const checklist: string[] = [];
  const legs = reference.legs;
  const needs = (doc: string) => legs.filter((l) => (l.requiredDocs as string[]).includes(doc)).map((l) => l.planName);
  if (needs("referral").length) checklist.push(`📝 לפני הביקור: הפניה מרופא המשפחה – ${needs("referral").join(" ו")} לא מחזירים בלעדיה`);
  if (needs("visit_summary").length) checklist.push("🩺 לבקש מהרופא סיכום ביקור (מכתב)");
  if (legs.length) checklist.push(`🧾 לבקש קבלה על שם ${member.fullName}, עם שם המטפל, התאריך וסוג הטיפול`);
  if (legs.length > 1) checklist.push(`💸 קודם מגישים ל${legs[0]!.planName}, וכשהכסף מגיע – ל${legs[1]!.planName}. אנחנו נזכיר`);
  for (const q of quota) {
    if (q.sessionsLeft !== null && q.sessionsLeft > 0 && q.sessionsLeft < sessions) {
      checklist.push(`⚠️ ב${q.planName} נשארו השנה רק ${q.sessionsLeft} מפגשים`);
    }
  }
  if (legs.length) checklist.push("📷 אחרי הביקור: מצלמים את הקבלה באפליקציה ואנחנו מגישים");
  if (!covered) checklist.push("ℹ️ לא מצאנו כיסוי לשירות הזה. שווה לבדוק אם יש מטפל בהסדר של הקופה, עם השתתפות עצמית קבועה");
  else if (options.every((o) => o.kind === "private")) {
    checklist.push("ℹ️ לפעמים יש מטפל בהסדר של הקופה או הביטוח עם השתתפות עצמית קבועה. אם בדקתם – הוסיפו אותו להשוואה");
  }
  if (maxRefund && options.some((o) => o.kind === "private" && o.priceAgorot / sessions > maxRefund!.fromPriceAgorot)) {
    checklist.push(`💡 מעל ${formatILS(maxRefund.fromPriceAgorot)} לביקור ההחזר כבר לא גדל – כל שקל נוסף יוצא מהכיס`);
  }

  return {
    memberId: member.id,
    memberName: member.fullName,
    category,
    label: CATEGORY_INFO[category].label,
    icon: CATEGORY_INFO[category].icon,
    sessions,
    date,
    covered,
    suggestedPriceAgorot,
    suggestedFrom: history ? "history" : "typical",
    history,
    options,
    maxRefund,
    quota,
    renewsOn: exhausted ? `${year + 1}-01-01` : null,
    checklist,
    notes: reference.notes.concat(exhausted ? [`המכסה השנתית מתחדשת ב-${dateHe(`${year + 1}-01-01`)}`] : []),
  };
}
