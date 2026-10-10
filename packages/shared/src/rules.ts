import { z } from "zod";
import { BENEFIT_CATEGORIES, type BenefitCategory } from "./categories";

export const DOC_KINDS = ["receipt", "visit_summary", "referral", "payer_payment_proof"] as const;
export type DocKind = (typeof DOC_KINDS)[number];

export const PLAN_KINDS = ["shaban", "private_individual", "private_group"] as const;
export type PlanKind = (typeof PLAN_KINDS)[number];

export const benefitRuleSchema = z
  .object({
    percent: z.number().min(0).max(100).default(0),
    perSessionCapAgorot: z.number().int().positive().nullable().default(null),
    perSessionFixedAgorot: z.number().int().positive().nullable().default(null),
    annualCapAgorot: z.number().int().positive().nullable().default(null),
    annualSessions: z.number().int().positive().nullable().default(null),
    deductibleAgorot: z.number().int().min(0).default(0),
    requiredDocs: z.array(z.enum(DOC_KINDS)).default(["receipt"]),
    minAge: z.number().int().min(0).nullable().default(null),
    maxAge: z.number().int().min(0).nullable().default(null),
  })
  .refine((r) => r.percent > 0 || r.perSessionFixedAgorot !== null, {
    message: "rule must define percent or perSessionFixedAgorot",
  });

export type BenefitRule = z.output<typeof benefitRuleSchema>;

export interface RoutingEnrollment {
  planId: string;
  planName: string;
  payerId: string;
  planKind: PlanKind;
  /** Private policy of the "משלים שב"ן" type – pays only on top of what the shaban paid. */
  isShabanSupplement: boolean;
  validFrom: string;
  validTo: string | null;
  benefits: Partial<Record<BenefitCategory, BenefitRule>>;
}

/** Usage already consumed in the service-date year, keyed by `${planId}:${category}`. */
export type UsageLedger = Record<string, { sessions: number; amountAgorot: number }>;

export interface RoutingInput {
  category: BenefitCategory;
  amountAgorot: number;
  sessions: number;
  serviceDate: string;
  memberBirthDate?: string | null;
  enrollments: RoutingEnrollment[];
  usage?: UsageLedger;
  /** Plans to leave out, e.g. a payer that already rejected this claim. */
  excludePlanIds?: string[];
}

export interface RoutingLeg {
  seq: number;
  planId: string;
  planName: string;
  payerId: string;
  baseAgorot: number;
  expectedAgorot: number;
  basis: string;
  requiredDocs: DocKind[];
}

export interface RoutingResult {
  category: BenefitCategory;
  amountAgorot: number;
  legs: RoutingLeg[];
  totalExpectedAgorot: number;
  uncoveredAgorot: number;
  requiredDocs: DocKind[];
  notes: string[];
}

export const routingInputSchema = z.object({
  category: z.enum(BENEFIT_CATEGORIES),
  amountAgorot: z.number().int().positive(),
  sessions: z.number().int().positive().max(100),
  serviceDate: z.iso.date(),
});

export function usageKey(planId: string, category: BenefitCategory): string {
  return `${planId}:${category}`;
}

function enrollmentRank(e: RoutingEnrollment): number {
  if (e.planKind === "shaban") return 0;
  if (e.planKind === "private_individual") return e.isShabanSupplement ? 1 : 2;
  return 3;
}

function ageAt(birthDate: string, onDate: string): number {
  const b = new Date(`${birthDate}T00:00:00Z`);
  const d = new Date(`${onDate}T00:00:00Z`);
  let age = d.getUTCFullYear() - b.getUTCFullYear();
  const beforeBirthday =
    d.getUTCMonth() < b.getUTCMonth() ||
    (d.getUTCMonth() === b.getUTCMonth() && d.getUTCDate() < b.getUTCDate());
  if (beforeBirthday) age -= 1;
  return age;
}

function isActiveOn(e: RoutingEnrollment, date: string): boolean {
  if (e.validFrom > date) return false;
  if (e.validTo !== null && e.validTo < date) return false;
  return true;
}

function shekels(agorot: number): string {
  return (agorot / 100).toLocaleString("en-US", { maximumFractionDigits: 2 });
}

/**
 * Splits a medical expense between the member's payers, in the order they must be claimed:
 * shaban first, then "משלים שב"ן" policies on the remainder, then other private, then group.
 * Deterministic: the same input always yields the same legs. Amounts are floored to the agora.
 */
export function computeRouting(input: RoutingInput): RoutingResult {
  const parsed = routingInputSchema.parse(input);
  const { category, amountAgorot, sessions, serviceDate } = parsed;
  const usage = input.usage ?? {};
  const excluded = new Set(input.excludePlanIds ?? []);
  const notes: string[] = [];
  const legs: RoutingLeg[] = [];

  const candidates = input.enrollments
    .filter((e) => !excluded.has(e.planId))
    .filter((e) => isActiveOn(e, serviceDate))
    .filter((e) => e.benefits[category] !== undefined)
    .sort((a, b) => enrollmentRank(a) - enrollmentRank(b) || a.planId.localeCompare(b.planId));

  let remaining = amountAgorot;

  for (const enrollment of candidates) {
    if (remaining <= 0) break;
    const rule = benefitRuleSchema.parse(enrollment.benefits[category]);

    if (input.memberBirthDate && (rule.minAge !== null || rule.maxAge !== null)) {
      const age = ageAt(input.memberBirthDate, serviceDate);
      if ((rule.minAge !== null && age < rule.minAge) || (rule.maxAge !== null && age > rule.maxAge)) {
        notes.push(`${enrollment.planName}: הכיסוי לא חל בגיל ${age}`);
        continue;
      }
    }

    const used = usage[usageKey(enrollment.planId, category)] ?? { sessions: 0, amountAgorot: 0 };
    const eligibleSessions =
      rule.annualSessions !== null
        ? Math.max(0, Math.min(sessions, rule.annualSessions - used.sessions))
        : sessions;

    if (eligibleSessions === 0) {
      notes.push(`${enrollment.planName}: נוצלו כל ${rule.annualSessions} המפגשים השנתיים`);
      continue;
    }
    if (eligibleSessions < sessions) {
      notes.push(`${enrollment.planName}: נותרו ${eligibleSessions} מתוך ${sessions} מפגשים בקבלה`);
    }

    // A "משלים שב"ן" policy pays a share of what the shaban left. Any other later payer computes its own benefit on
    // the full expense (as its policy is written) and pays at most what is still uncovered (indemnity).
    const supplement = legs.length > 0 && enrollmentRank(enrollment) === 1;
    const base = legs.length === 0 || supplement ? remaining : amountAgorot;
    let amount: number;
    let basis: string;

    if (rule.perSessionFixedAgorot !== null) {
      amount = rule.perSessionFixedAgorot * eligibleSessions;
      basis = `${shekels(rule.perSessionFixedAgorot)} ₪ למפגש × ${eligibleSessions}`;
    } else {
      amount = Math.floor((base * rule.percent) / 100);
      basis = `${rule.percent}%${legs.length === 0 ? "" : supplement ? " מההפרש" : " מההוצאה"}`;
      if (rule.perSessionCapAgorot !== null && amount > rule.perSessionCapAgorot * eligibleSessions) {
        amount = rule.perSessionCapAgorot * eligibleSessions;
        basis += `, עד ${shekels(rule.perSessionCapAgorot)} ₪ למפגש`;
      }
      if (eligibleSessions < sessions) {
        amount = Math.floor((amount * eligibleSessions) / sessions);
      }
    }

    if (rule.annualCapAgorot !== null) {
      const capLeft = Math.max(0, rule.annualCapAgorot - used.amountAgorot);
      if (amount > capLeft) {
        amount = capLeft;
        notes.push(`${enrollment.planName}: נותרו ${shekels(capLeft)} ₪ מהתקרה השנתית`);
      }
    }

    amount -= rule.deductibleAgorot;
    if (amount > remaining && legs.length > 0) basis += ", עד היתרה שלא הוחזרה";
    amount = Math.max(0, Math.min(amount, remaining));

    if (amount === 0) {
      notes.push(`${enrollment.planName}: לא נותר החזר בכיסוי הזה`);
      continue;
    }

    const requiredDocs = new Set<DocKind>(rule.requiredDocs);
    requiredDocs.add("receipt");
    if (legs.length > 0) requiredDocs.add("payer_payment_proof");

    legs.push({
      seq: legs.length + 1,
      planId: enrollment.planId,
      planName: enrollment.planName,
      payerId: enrollment.payerId,
      baseAgorot: base,
      expectedAgorot: amount,
      basis,
      requiredDocs: [...requiredDocs].sort(),
    });
    remaining -= amount;
  }

  if (candidates.length === 0) {
    notes.push("לא נמצא כיסוי פעיל לסוג השירות הזה בתאריך הקבלה");
  }

  const totalExpectedAgorot = legs.reduce((sum, l) => sum + l.expectedAgorot, 0);
  const requiredDocs = [...new Set(legs.flatMap((l) => l.requiredDocs))].sort() as DocKind[];

  return {
    category,
    amountAgorot,
    legs,
    totalExpectedAgorot,
    uncoveredAgorot: amountAgorot - totalExpectedAgorot,
    requiredDocs,
    notes,
  };
}
