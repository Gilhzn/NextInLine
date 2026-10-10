/** All money in the system is integer agorot (1 ₪ = 100 agorot). Never use floats for money. */

export function ilsToAgorot(ils: number): number {
  if (!Number.isFinite(ils)) throw new Error("invalid amount");
  return Math.round(ils * 100);
}

export function agorotToIls(agorot: number): number {
  return agorot / 100;
}

const RLM = "‏";

/** "‏1,234.50 ₪" – whole shekels drop the decimals ("‏175 ₪"). */
export function formatILS(agorot: number): string {
  const negative = agorot < 0;
  const abs = Math.abs(agorot);
  const shekels = Math.floor(abs / 100);
  const rest = abs % 100;
  const whole = shekels.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const body = rest === 0 ? whole : `${whole}.${rest.toString().padStart(2, "0")}`;
  return `${RLM}${negative ? "-" : ""}${body} ₪`;
}
