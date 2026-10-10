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

export const memberCreateSchema = z.object({
  fullName: z.string().trim().min(2).max(80),
  relation: z.enum(MEMBER_RELATIONS).exclude(["self"]),
  birthDate: z.iso.date().nullable().optional(),
  phone: phoneSchema.optional(),
});

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

export const consentSchema = z.object({
  kind: z.enum(["terms", "privacy", "poa", "marketing"]),
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
