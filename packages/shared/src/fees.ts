export const FEE_POLICY = {
  standardRateBps: 1500,
  retroRateBps: 2000,
  capAgorot: 15000,
  chargeDelayDays: 3,
} as const;

export interface FeeQuote {
  rateBps: number;
  capAgorot: number;
  baseAgorot: number;
  amountAgorot: number;
  netToUserAgorot: number;
}

/** Success fee on money actually paid to the user: rate × paid, floored, capped per claim. */
export function computeFee(paidAgorot: number, isRetro: boolean): FeeQuote {
  if (!Number.isInteger(paidAgorot) || paidAgorot < 0) throw new Error("paidAgorot must be a non-negative integer");
  const rateBps = isRetro ? FEE_POLICY.retroRateBps : FEE_POLICY.standardRateBps;
  const raw = Math.floor((paidAgorot * rateBps) / 10_000);
  const amountAgorot = Math.min(raw, FEE_POLICY.capAgorot);
  return {
    rateBps,
    capAgorot: FEE_POLICY.capAgorot,
    baseAgorot: paidAgorot,
    amountAgorot,
    netToUserAgorot: paidAgorot - amountAgorot,
  };
}
