import { z } from "zod";
import { BENEFIT_CATEGORIES, type BenefitCategory } from "./categories";
import type { ClaimStatus, LegStatus } from "./claimState";
import { DOC_KINDS, benefitRuleSchema, type BenefitRule, type DocKind, type PlanKind, type RoutingResult } from "./rules";

/** Accepts 05XXXXXXXX / 5XXXXXXXX / +9725XXXXXXXX / 9725XXXXXXXX (spaces and dashes ignored). */
export function normalizeIsraeliMobile(input: string): string | null {
  const digits = input.replace(/[\s\-()]/g, "");
  let local: string;
  if (/^\+9725\d{8}$/.test(digits)) local = digits.slice(4);
  else if (/^9725\d{8}$/.test(digits)) local = digits.slice(3);
  else if (/^05\d{8}$/.test(digits)) local = digits.slice(1);
  else if (/^5\d{8}$/.test(digits)) local = digits;
  else return null;
  return `+972${local}`;
}

export const phoneSchema = z
  .string()
  .transform((v, ctx) => {
    const normalized = normalizeIsraeliMobile(v);
    if (!normalized) {
      ctx.addIssue({ code: "custom", message: "מספר טלפון נייד לא תקין" });
      return z.NEVER;
    }
    return normalized;
  });

export const otpRequestSchema = z.object({ phone: phoneSchema });
export const otpVerifySchema = z.object({ phone: phoneSchema, code: z.string().regex(/^\d{6}$/) });
export const refreshSchema = z.object({ refreshToken: z.string().min(20) });

export const MEMBER_RELATIONS = ["self", "spouse", "child", "parent", "other"] as const;
export type MemberRelation = (typeof MEMBER_RELATIONS)[number];

export const memberCreateSchema = z
  .object({
    fullName: z.string().trim().min(2).max(80),
    relation: z.enum(MEMBER_RELATIONS).exclude(["self"]),
    birthDate: z.iso.date().nullable().optional(),
    phone: phoneSchema.optional(),
    /** For a minor: "I am the parent or legal guardian" (privacy: consent on the child's behalf). */
    guardianDeclared: z.boolean().optional(),
  })
  // A child's age decides whether they must consent themselves (18+) – so it cannot be skipped.
  .refine((m) => m.relation !== "child" || !!m.birthDate, { message: "צריך תאריך לידה לילד/ה", path: ["birthDate"] });

export const memberUpdateSchema = z.object({
  fullName: z.string().trim().min(2).max(80).optional(),
  birthDate: z.iso.date().nullable().optional(),
});

export const memberConsentConfirmSchema = z.object({
  memberId: z.uuid(),
  code: z.string().regex(/^\d{6}$/),
});

export const enrollmentsPutSchema = z.object({
  enrollments: z
    .array(
      z.object({
        planId: z.string().min(1).max(64),
        isShabanSupplement: z.boolean().default(false),
        policyNumber: z.string().max(40).optional(),
      }),
    )
    .max(20),
});

export const receiptConfirmSchema = z.object({
  memberId: z.uuid(),
  category: z.enum(BENEFIT_CATEGORIES),
  providerName: z.string().trim().min(1).max(120),
  serviceDate: z.iso.date(),
  amountAgorot: z.number().int().positive().max(10_000_000),
  sessions: z.number().int().positive().max(100).default(1),
});

export const claimCreateSchema = z.object({
  receiptIds: z.array(z.uuid()).min(1).max(20),
  isRetro: z.boolean().default(false),
  privacyPrivate: z.boolean().default(false),
});

export const claimDocProvideSchema = z.object({
  kind: z.enum(DOC_KINDS),
  documentId: z.uuid(),
});

export const USER_LEG_UPDATES = ["submitted", "approved", "partially_approved", "rejected", "paid"] as const;

export const legStatusUpdateSchema = z.object({
  status: z.enum(USER_LEG_UPDATES),
  amountAgorot: z.number().int().min(0).max(10_000_000).optional(),
  reason: z.string().max(500).optional(),
  payerReference: z.string().max(80).optional(),
});

export const adminLegStatusSchema = legStatusUpdateSchema.extend({
  status: z.enum(["received", "in_review", ...USER_LEG_UPDATES]),
});

export const simulateSchema = z.object({
  memberId: z.uuid(),
  category: z.enum(BENEFIT_CATEGORIES),
  amountAgorot: z.number().int().positive().max(10_000_000),
  sessions: z.number().int().positive().max(100).default(1),
  serviceDate: z.iso.date().optional(),
});

export const pushTokenSchema = z.object({
  expoToken: z.string().min(10).max(200),
  platform: z.enum(["ios", "android", "web"]),
});

export const feeDisputeSchema = z.object({ reason: z.string().trim().min(3).max(500) });

/** Each consent is separate and revocable (Privacy Protection Authority opinion on consent, 2026). */
export const CONSENT_KINDS = ["terms", "privacy", "medical_data", "ai_processing", "poa", "marketing", "financial_data"] as const;
export type ConsentKind = (typeof CONSENT_KINDS)[number];
/** Without these the service cannot work; the others are optional. */
export const REQUIRED_CONSENTS: ConsentKind[] = ["terms", "privacy", "medical_data"];
/** Current versions of the legal texts (apps/server/legal/*.md). Bump when a text changes materially. */
export const LEGAL_VERSIONS = { terms: "2026-10", privacy: "2026-10", poa: "2026-10" } as const;

export const consentSchema = z.object({
  kind: z.enum(CONSENT_KINDS),
  version: z.string().min(1).max(20),
});

export const ONBOARDING_STEPS = ["family", "coverage", "map", "retro", "agreements", "done"] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

export const meUpdateSchema = z.object({
  displayName: z.string().trim().min(1).max(60).optional(),
  onboardingStep: z.enum(ONBOARDING_STEPS).optional(),
});

// ---------- Response DTOs ----------

export interface UserDto {
  id: string;
  phone: string;
  displayName: string | null;
  onboardingStep: OnboardingStep;
}

export interface MemberDto {
  id: string;
  fullName: string;
  relation: MemberRelation;
  birthDate: string | null;
  consentStatus: "not_required" | "pending" | "granted" | "revoked";
  isSelf: boolean;
}

export interface MeDto {
  user: UserDto;
  householdId: string;
  members: MemberDto[];
  consents: Array<{ kind: string; version: string; grantedAt: string }>;
  hasPaymentMethod: boolean;
}

export interface AuthResponseDto {
  accessToken: string;
  refreshToken: string;
  isNew: boolean;
  me: MeDto;
}

export interface PlanDto {
  id: string;
  name: string;
  payerId: string;
  payerName: string;
  kind: PlanKind;
  description: string | null;
}

export interface EnrollmentDto {
  id: string;
  memberId: string;
  planId: string;
  planName: string;
  planKind: PlanKind;
  isShabanSupplement: boolean;
}

export type BenefitConfidence = "official" | "secondary" | "unverified";

/** One category of a policy as the user sees it: what the catalog says, and what they set for their own policy. */
export interface PolicyTermDto {
  category: BenefitCategory;
  label: string;
  icon: string;
  catalog: { rule: BenefitRule; summary: string; confidence: BenefitConfidence; note: string | null; sourceUrl: string | null } | null;
  /** undefined = use the catalog; null = "my policy doesn't cover this" */
  custom?: BenefitRule | null;
}

export interface PolicyTermsDto {
  memberId: string;
  planId: string;
  planName: string;
  planKind: PlanKind;
  description: string | null;
  terms: PolicyTermDto[];
}

export const policyTermPutSchema = z.object({
  category: z.enum(BENEFIT_CATEGORIES),
  /** a rule, null = not covered, "reset" = back to the catalog value */
  rule: z.union([benefitRuleSchema, z.null(), z.literal("reset")]),
});

export interface CoverageItemDto {
  category: BenefitCategory;
  label: string;
  icon: string;
  members: Array<{
    memberId: string;
    memberName: string;
    plans: Array<{
      planId: string;
      planName: string;
      summary: string;
      remainingSessions: number | null;
      remainingCapAgorot: number | null;
      /** custom = the user's own policy terms */
      confidence: BenefitConfidence | "custom";
      note: string | null;
      sourceUrl: string | null;
    }>;
  }>;
}

export interface ExtractedFields {
  isMedicalReceipt: boolean;
  providerName: string | null;
  patientName: string | null;
  serviceDate: string | null;
  amountAgorot: number | null;
  sessions: number | null;
  category: BenefitCategory | null;
  description: string | null;
  confidence: Partial<Record<"providerName" | "serviceDate" | "amountAgorot" | "sessions" | "category", "high" | "medium" | "low">>;
}

export interface ReceiptDto {
  id: string;
  memberId: string | null;
  extractionStatus: "pending" | "processing" | "done" | "failed" | "manual";
  extracted: ExtractedFields | null;
  confirmed: boolean;
  category: BenefitCategory | null;
  providerName: string | null;
  serviceDate: string | null;
  amountAgorot: number | null;
  sessions: number | null;
  imageUrl: string | null;
  createdAt: string;
}

export interface LegDto {
  id: string;
  seq: number;
  payerId: string;
  payerName: string;
  planId: string;
  planName: string;
  status: LegStatus;
  expectedAgorot: number;
  approvedAgorot: number | null;
  paidAgorot: number | null;
  submissionChannel: "user_handoff" | "email_poa";
  submittedAt: string | null;
  paidAt: string | null;
  rejectionReason: string | null;
  expectedDecisionBy: string | null;
}

export interface ClaimDto {
  id: string;
  memberId: string;
  memberName: string;
  status: ClaimStatus;
  isRetro: boolean;
  privacyPrivate: boolean;
  category: BenefitCategory;
  providerName: string | null;
  serviceDate: string | null;
  amountAgorot: number;
  totalExpectedAgorot: number;
  totalPaidAgorot: number;
  routing: RoutingResult | null;
  legs: LegDto[];
  requiredDocs: Array<{ kind: DocKind; status: "missing" | "provided" | "waived" }>;
  fee: FeeDto | null;
  feePreview: { rateBps: number; amountAgorot: number; netToUserAgorot: number };
  createdAt: string;
}

export interface FeeDto {
  id: string;
  claimId: string;
  rateBps: number;
  baseAgorot: number;
  amountAgorot: number;
  status: "pending" | "scheduled" | "charged" | "disputed" | "waived" | "failed" | "refunded";
  scheduledFor: string | null;
  chargedAt: string | null;
  /** Tax receipt issued by the payment provider with the charge. */
  documentNumber: string | null;
  documentUrl: string | null;
}

export interface HomeDto {
  yearPaidAgorot: number;
  inFlightAgorot: number;
  inFlightCount: number;
  actionItems: Array<{
    type: "missing_document" | "ready_to_submit" | "confirm_receipt" | "consent_pending";
    title: string;
    claimId?: string;
    receiptId?: string;
    memberId?: string;
    amountAgorot?: number;
  }>;
  opportunities: Array<{ title: string; detail: string; category: BenefitCategory }>;
}

export interface SubmissionPackDto {
  legId: string;
  payerName: string;
  channel: "user_handoff" | "email_poa";
  instructions: string[];
  fields: Array<{ label: string; value: string }>;
  documents: Array<{ kind: DocKind; url: string }>;
  deepLink: string | null;
  webUrl: string | null;
}

export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown };
}

// ---------- Import from Har HaBituach (the Finance Ministry's "insurance mountain" report) ----------

export type PolicyRelevance = "relevant" | "maybe" | "not_relevant";

/** One policy row read from the user's Har HaBituach report, with our best match in the catalog. */
export interface ImportedPolicyDto {
  key: string;
  insurer: string | null;
  branch: string | null;
  product: string | null;
  isGroup: boolean;
  policyNumber: string | null;
  startDate: string | null;
  endDate: string | null;
  insuredName: string | null;
  relevance: PolicyRelevance;
  reason: string;
  /** exact = product identified; likely = insurer + product type; generic = insurer only (terms to be entered) */
  match: { planId: string; planName: string; confidence: "exact" | "likely" | "generic" } | null;
  alreadyEnrolled: boolean;
  /** From the report, when it lists the premium (annual premiums are divided by 12). */
  monthlyPremiumAgorot: number | null;
}

export interface PolicyImportPreviewDto {
  source: "spreadsheet" | "ai";
  policies: ImportedPolicyDto[];
  notes: string[];
}

export const policyImportApplySchema = z.object({
  memberIds: z.array(z.uuid()).min(1).max(20),
  items: z
    .array(
      z.object({
        planId: z.string().min(1).max(60),
        policyNumber: z.string().max(40).nullable().optional(),
        startDate: z.iso.date().nullable().optional(),
        endDate: z.iso.date().nullable().optional(),
        /** Saved once, on the first chosen member: a family policy has one premium. */
        monthlyPremiumAgorot: z.number().int().min(0).max(10_000_000).nullable().optional(),
      }),
    )
    .min(1)
    .max(40),
});

// ---------- Entitlement overview: everything the household can get back ----------

export interface EntitlementCategoryDto {
  category: BenefitCategory;
  label: string;
  icon: string;
  /** Worked example at a typical price, using this year's remaining quotas. */
  example: { priceAgorot: number; refundAgorot: number; legs: Array<{ planName: string; amountAgorot: number }> };
  remaining: Array<{ planName: string; sessions: number | null; capAgorot: number | null }>;
  requiredDocs: DocKind[];
  notes: string[];
}

export interface EntitlementSummaryDto {
  members: Array<{ memberId: string; memberName: string; categories: EntitlementCategoryDto[] }>;
  /** Categories nobody in the household is covered for (among those people usually pay for privately). */
  gaps: Array<{ category: BenefitCategory; label: string; icon: string }>;
  /** Policies we can't calculate yet: the user still has to enter the terms. */
  missingTerms: Array<{ memberId: string; memberName: string; planId: string; planName: string }>;
  pendingConsent: string[];
  openMoney: { unclaimedReceipts: number; unclaimedAgorot: number; inFlightAgorot: number };
}

export const entitlementEstimateSchema = z.object({
  items: z
    .array(
      z.object({
        memberId: z.uuid(),
        category: z.enum(BENEFIT_CATEGORIES),
        /** visits / items paid privately over the last 3 years */
        visits: z.number().int().min(1).max(300),
        priceAgorot: z.number().int().min(100).max(10_000_000),
      }),
    )
    .min(1)
    .max(60),
});

export interface EntitlementEstimateDto {
  items: Array<{ memberId: string; category: BenefitCategory; visits: number; priceAgorot: number; refundAgorot: number }>;
  totalAgorot: number;
}

// ---------- "Our health money": what we paid, got back, missed, are owed, and can still save ----------

export type MoneyAction =
  | { type: "claim"; id: string }
  | { type: "receipt"; id: string }
  | { type: "policy"; memberId: string; planId: string }
  | { type: "capture" }
  | { type: "lead"; id: string }
  | { type: "benefits" }
  | { type: "plan_visit"; memberId: string; category: BenefitCategory };

export interface MoneyItemDto {
  kind:
    | "unclaimed_receipt"
    | "receipt_needs_details"
    | "payment_without_receipt"
    | "rejected"
    | "in_flight"
    | "ready_to_submit"
    | "missing_documents"
    | "unused_quota"
    | "uncovered_spend"
    | "low_refund"
    | "missing_terms";
  title: string;
  detail: string | null;
  /** The money at stake (an estimate where marked by the kind), or null when unknown. */
  amountAgorot: number | null;
  urgent: boolean;
  action: MoneyAction | null;
}

export interface MoneyServiceDto {
  memberId: string;
  memberName: string;
  category: BenefitCategory;
  label: string;
  icon: string;
  visits: number;
  paidAgorot: number;
  refundedAgorot: number;
  waitingAgorot: number;
  /** Estimated refund on receipts not yet claimed. */
  unclaimedAgorot: number;
  covered: boolean;
}

export interface MoneyDto {
  range: "year" | "3y";
  from: string;
  to: string;
  paidAgorot: number;
  refundedAgorot: number;
  waitingAgorot: number;
  missed: { totalAgorot: number; items: MoneyItemDto[] };
  waiting: { totalAgorot: number; items: MoneyItemDto[] };
  save: { totalAgorot: number; items: MoneyItemDto[] };
  services: MoneyServiceDto[];
  /** The few things worth doing now, most urgent and most money first (from missed, waiting and save). */
  nextSteps: MoneyItemDto[];
  /** Where money may still be hiding: the discovery steps this family has (not) done. */
  discovery: {
    receipts: number;
    policiesImported: boolean;
    cardScanned: boolean;
    premiumsEntered: boolean;
    /** At least one receipt arrived by email. */
    emailInbox: boolean;
    /** An active bank / credit card connection. */
    bankConnected: boolean;
  };
}

// ---------- Credit card statement scan: medical payments that may still be refundable ----------

export interface StatementCandidateDto {
  key: string;
  merchant: string;
  date: string;
  amountAgorot: number;
  category: BenefitCategory | null;
  categoryLabel: string | null;
  /** A receipt with the same amount and a close date is already in the app. */
  hasReceipt: boolean;
  alreadySaved: boolean;
  estimatedRefundAgorot: number | null;
}

export interface StatementScanDto {
  source: "spreadsheet" | "ai";
  rowsScanned: number;
  candidates: StatementCandidateDto[];
  notes: string[];
}

export const paymentLeadsSaveSchema = z.object({
  items: z
    .array(
      z.object({
        merchant: z.string().trim().min(1).max(120),
        date: z.iso.date(),
        amountAgorot: z.number().int().positive().max(100_000_000),
        category: z.enum(BENEFIT_CATEGORIES).nullable(),
      }),
    )
    .min(1)
    .max(100),
});

// ---------- Before booking: what a visit will really cost, and what to arrange first ----------

export const beforeBookingSchema = z.object({
  memberId: z.uuid(),
  category: z.enum(BENEFIT_CATEGORIES),
  sessions: z.number().int().min(1).max(50).default(1),
  date: z.iso.date().optional(),
  /** Up to 3 places to compare. Empty: one private visit at the price this family usually pays. */
  options: z
    .array(
      z.object({
        label: z.string().trim().max(60).optional(),
        /** Per session. For "network", the co-payment the HMO or insurer quoted. */
        priceAgorot: z.number().int().positive().max(10_000_000),
        kind: z.enum(["private", "network"]).default("private"),
      }),
    )
    .max(3)
    .default([]),
});
export type BeforeBookingInput = z.input<typeof beforeBookingSchema>;

export interface BookingOptionDto {
  label: string;
  kind: "private" | "network";
  priceAgorot: number;
  refundAgorot: number;
  /** What the family is left paying after every refund. */
  netAgorot: number;
  legs: Array<{ planName: string; amountAgorot: number; basis: string }>;
  best: boolean;
}

export interface BeforeBookingDto {
  memberId: string;
  memberName: string;
  category: BenefitCategory;
  label: string;
  icon: string;
  sessions: number;
  date: string;
  covered: boolean;
  /** The price used when no options were given, and where it came from. */
  suggestedPriceAgorot: number;
  suggestedFrom: "history" | "typical";
  history: { visits: number; avgPriceAgorot: number } | null;
  options: BookingOptionDto[];
  /** The refund per visit stops growing at this price: every shekel above it comes out of pocket. */
  maxRefund: { refundAgorot: number; fromPriceAgorot: number } | null;
  quota: Array<{ planName: string; perYear: number | null; sessionsLeft: number | null; capLeftAgorot: number | null }>;
  /** Set when this year's quota is used up: when it starts again. */
  renewsOn: string | null;
  checklist: string[];
  notes: string[];
}

// ---------- Premiums vs. refunds: what each policy costs and what it actually returned ----------

export const premiumPutSchema = z.object({
  monthlyPremiumAgorot: z.number().int().min(0).max(10_000_000).nullable(),
});

export interface PremiumPlanDto {
  planId: string;
  planName: string;
  planKind: "shaban" | "private_individual" | "private_group";
  members: Array<{ memberId: string; memberName: string; monthlyPremiumAgorot: number | null }>;
  /** Sum of the known monthly premiums; null when none was entered. */
  monthlyPremiumAgorot: number | null;
  /** Premiums over the last 12 months (only the months the policy was active). */
  premiumsAgorot: number | null;
  refundsAgorot: number;
  waitingAgorot: number;
  servicesUsed: string[];
  servicesCovered: number;
}

export interface PremiumsDto {
  from: string;
  to: string;
  plans: PremiumPlanDto[];
  totals: { premiumsAgorot: number; refundsAgorot: number; waitingAgorot: number; plansWithoutPremium: number };
  /** The same service covered by two private policies for the same person. */
  overlaps: Array<{ memberName: string; label: string; icon: string; planNames: string[] }>;
  notes: string[];
}

// ---------- Receipts by email ----------

export interface InboxDto {
  /** The family's private address; null when email intake isn't configured on this server. */
  address: string | null;
  recent: Array<{ receivedAt: string; from: string | null; receipts: number; status: "processed" | "no_attachments" | "rejected" }>;
}

// ---------- Open banking: bank and credit card connections (read-only, via a licensed provider) ----------

export const bankConnectSchema = z.object({
  platform: z.enum(["web", "native"]),
  returnUrl: z.string().max(300).optional(),
});

export interface BankConnectionDto {
  id: string;
  status: "pending" | "active" | "failed" | "expired" | "revoked";
  institutions: string[];
  createdAt: string;
  expiresAt: string | null;
  lastSyncedAt: string | null;
  lastError: string | null;
  /** Medical payments found through this connection so far. */
  leadsFound: number;
}
