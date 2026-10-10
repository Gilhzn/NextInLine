export const LEG_STATUSES = [
  "blocked",
  "ready",
  "submitted",
  "received",
  "in_review",
  "approved",
  "partially_approved",
  "rejected",
  "paid",
  "skipped",
] as const;
export type LegStatus = (typeof LEG_STATUSES)[number];

export const CLAIM_STATUSES = [
  "draft",
  "awaiting_documents",
  "ready",
  "in_progress",
  "completed",
  "partially_paid",
  "rejected",
  "cancelled",
] as const;
export type ClaimStatus = (typeof CLAIM_STATUSES)[number];

const LEG_TRANSITIONS: Record<LegStatus, readonly LegStatus[]> = {
  blocked: ["ready", "skipped"],
  ready: ["submitted", "skipped"],
  // Users often only learn the outcome, so intermediate steps may be skipped.
  submitted: ["received", "in_review", "approved", "partially_approved", "rejected", "paid"],
  received: ["in_review", "approved", "partially_approved", "rejected", "paid"],
  in_review: ["approved", "partially_approved", "rejected", "paid"],
  approved: ["paid"],
  partially_approved: ["paid"],
  rejected: [],
  paid: [],
  skipped: [],
};

export const TERMINAL_LEG_STATUSES: readonly LegStatus[] = ["rejected", "paid", "skipped"];

export function canTransitionLeg(from: LegStatus, to: LegStatus): boolean {
  return LEG_TRANSITIONS[from].includes(to);
}

export function isTerminalLeg(status: LegStatus): boolean {
  return TERMINAL_LEG_STATUSES.includes(status);
}

/** Overall claim status once it has been submitted, derived from its legs. */
export function deriveSubmittedClaimStatus(legs: ReadonlyArray<{ status: LegStatus }>): ClaimStatus {
  if (legs.length === 0) return "rejected";
  if (!legs.every((l) => isTerminalLeg(l.status))) return "in_progress";
  const anyPaid = legs.some((l) => l.status === "paid");
  const anyRejected = legs.some((l) => l.status === "rejected");
  if (anyPaid && anyRejected) return "partially_paid";
  if (anyPaid) return "completed";
  return "rejected";
}

export const LEG_STATUS_LABEL: Record<LegStatus, string> = {
  blocked: "ממתין לשלב הקודם",
  ready: "מוכן להגשה",
  submitted: "הוגש",
  received: "התקבל",
  in_review: "בבדיקה",
  approved: "אושר",
  partially_approved: "אושר חלקית",
  rejected: "נדחה",
  paid: "שולם",
  skipped: "דולג",
};

export const CLAIM_STATUS_LABEL: Record<ClaimStatus, string> = {
  draft: "טיוטה",
  awaiting_documents: "חסר מסמך",
  ready: "מוכן להגשה",
  in_progress: "בטיפול",
  completed: "הכסף הגיע",
  partially_paid: "שולם חלקית",
  rejected: "נדחה",
  cancelled: "בוטל",
};
