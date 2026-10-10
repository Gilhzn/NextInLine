import { formatILS, type FeeDto } from "@magiali/shared";
import type { AuthContext, Deps } from "../context";
import { AppError, notFound } from "../errors";
import { audit } from "./audit";
import { feeDto } from "./claims";
import { PermanentJobError, registerJobFailureHook, registerJobHandler } from "./jobs";
import { notify } from "./notify";

export async function listFees(deps: Deps, ctx: AuthContext): Promise<FeeDto[]> {
  const rows = await deps.sql`SELECT * FROM fees WHERE household_id = ${ctx.householdId} ORDER BY created_at DESC`;
  return rows.map(feeDto);
}

/** "The money didn't arrive" – stops the charge until operations resolves it. */
export async function disputeFee(deps: Deps, ctx: AuthContext, feeId: string, reason: string): Promise<FeeDto> {
  const [fee] = await deps.sql`SELECT * FROM fees WHERE id = ${feeId} AND household_id = ${ctx.householdId}`;
  if (!fee) throw notFound("העמלה");
  if (fee.status === "disputed") return feeDto(fee);
  if (fee.status !== "scheduled" && fee.status !== "failed") throw new AppError("conflict", "העמלה כבר חויבה. פנה לתמיכה להחזר");
  const [updated] = await deps.sql`
    UPDATE fees SET status = 'disputed', dispute_reason = ${reason}, updated_at = ${deps.now()}
    WHERE id = ${feeId} RETURNING *`;
  await audit(deps.sql, { actorUserId: ctx.userId, actorKind: "user", action: "fee_disputed", entity: "fee", entityId: feeId });
  return feeDto(updated!);
}

export async function resolveFee(deps: Deps, feeId: string, action: "charge" | "waive" | "charge_now"): Promise<FeeDto> {
  const [fee] = await deps.sql`SELECT * FROM fees WHERE id = ${feeId}`;
  if (!fee) throw notFound("העמלה");
  if (action === "charge_now") {
    // Operations / demo: skip the 3-day wait for a scheduled fee.
    if (fee.status !== "scheduled") throw new AppError("conflict", "אפשר לחייב מיד רק עמלה מתוזמנת");
    await deps.sql`UPDATE fees SET scheduled_for = ${deps.now()}, updated_at = ${deps.now()} WHERE id = ${feeId}`;
    await chargeFee(deps, feeId);
    const [after] = await deps.sql`SELECT * FROM fees WHERE id = ${feeId}`;
    await audit(deps.sql, { actorKind: "ops", action: "fee_charged_now", entity: "fee", entityId: feeId });
    return feeDto(after!);
  }
  if (fee.status !== "disputed" && fee.status !== "failed") throw new AppError("conflict", "אפשר להכריע רק בעמלה במחלוקת או שנכשלה");
  if (action === "waive") {
    const [updated] = await deps.sql`UPDATE fees SET status = 'waived', updated_at = ${deps.now()} WHERE id = ${feeId} RETURNING *`;
    await audit(deps.sql, { actorKind: "ops", action: "fee_waived", entity: "fee", entityId: feeId });
    return feeDto(updated!);
  }
  await deps.sql`UPDATE fees SET status = 'scheduled', scheduled_for = ${deps.now()}, updated_at = ${deps.now()} WHERE id = ${feeId}`;
  await chargeFee(deps, feeId);
  const [after] = await deps.sql`SELECT * FROM fees WHERE id = ${feeId}`;
  await audit(deps.sql, { actorKind: "ops", action: "fee_charge_forced", entity: "fee", entityId: feeId });
  return feeDto(after!);
}

/** Operations: return a fee that was charged (e.g. the payer clawed the money back). */
export async function refundFee(deps: Deps, feeId: string, reason: string): Promise<FeeDto> {
  const [fee] = await deps.sql`SELECT * FROM fees WHERE id = ${feeId}`;
  if (!fee) throw notFound("העמלה");
  if (fee.status !== "charged" || !fee.providerChargeId) throw new AppError("conflict", "אפשר להחזיר רק עמלה שחויבה");
  const result = await deps.payments.refund({ chargeId: fee.providerChargeId as string, amountAgorot: fee.amountAgorot as number });
  if (!result.ok) throw new AppError("conflict", `ההחזר נכשל: ${result.reason}`);
  const [updated] = await deps.sql`
    UPDATE fees SET status = 'refunded', refunded_at = ${deps.now()}, provider_refund_id = ${result.refundId}, updated_at = ${deps.now()}
    WHERE id = ${feeId} AND status = 'charged' RETURNING *`;
  const [h] = await deps.sql`SELECT owner_user_id FROM households WHERE id = ${fee.householdId as string}`;
  await notify(deps.sql, deps.now(), h!.ownerUserId as string, {
    type: "fee_refunded",
    title: `החזרנו לך את העמלה (${formatILS(fee.amountAgorot as number)})`,
    body: "הסכום יחזור לכרטיס שלך תוך כמה ימי עסקים",
    data: { feeId, claimId: fee.claimId as string },
  });
  await audit(deps.sql, { actorKind: "ops", action: "fee_refunded", entity: "fee", entityId: feeId, meta: { reason } });
  return feeDto(updated!);
}

class RetryableChargeError extends Error {}

async function markFailed(deps: Deps, feeId: string, reason: string): Promise<void> {
  const [fee] = await deps.sql`
    UPDATE fees SET status = 'failed', failure_reason = ${reason}, updated_at = ${deps.now()}
    WHERE id = ${feeId} AND status = 'scheduled'
    RETURNING household_id, amount_agorot`;
  if (!fee) return;
  const [h] = await deps.sql`SELECT owner_user_id FROM households WHERE id = ${fee.householdId as string}`;
  await notify(deps.sql, deps.now(), h!.ownerUserId as string, {
    type: "fee_failed",
    title: "לא הצלחנו לחייב את העמלה",
    body: `העמלה (${formatILS(fee.amountAgorot as number)}) לא חויבה. עדכן אמצעי תשלום בהגדרות`,
    data: { feeId },
  });
}

/** Charges a scheduled fee. Idempotent: the fee id is the PSP idempotency key. */
export async function chargeFee(deps: Deps, feeId: string): Promise<void> {
  const [fee] = await deps.sql`SELECT * FROM fees WHERE id = ${feeId}`;
  if (!fee) throw new PermanentJobError("fee not found");
  if (fee.status !== "scheduled") return; // disputed, waived, or already charged
  if ((fee.scheduledFor as Date) > deps.now()) return;

  const [pm] = await deps.sql`
    SELECT pm.provider_token_enc, u.display_name, u.phone_e164 FROM payment_methods pm
    JOIN households h ON h.owner_user_id = pm.user_id JOIN users u ON u.id = pm.user_id
    WHERE h.id = ${fee.householdId as string} AND pm.deleted_at IS NULL AND pm.provider = ${deps.payments.name}
    ORDER BY pm.is_default DESC, pm.created_at DESC LIMIT 1`;
  if (!pm) {
    await markFailed(deps, feeId, "no_payment_method");
    return;
  }

  const result = await deps.payments.charge({
    token: deps.crypto.decryptString(pm.providerTokenEnc as string),
    amountAgorot: fee.amountAgorot as number,
    idempotencyKey: `${feeId}-${fee.chargeAttempts as number}`,
    description: "מגיע לי – עמלת הצלחה",
    customer: { name: pm.displayName as string | null, phone: pm.phoneE164 as string },
  });
  if (!result.ok) {
    // A definitive answer from the provider: the next attempt needs a fresh key.
    await deps.sql`UPDATE fees SET charge_attempts = charge_attempts + 1 WHERE id = ${feeId}`;
    if (result.retryable) throw new RetryableChargeError(result.reason);
    await markFailed(deps, feeId, result.reason);
    return;
  }
  await deps.sql`
    UPDATE fees SET status = 'charged', charged_at = ${deps.now()}, provider_charge_id = ${result.chargeId},
           document_number = ${result.documentNumber ?? null}, document_url = ${result.documentUrl ?? null}, updated_at = ${deps.now()}
    WHERE id = ${feeId}`;
}

registerJobHandler("charge_fee", async (deps, payload) => chargeFee(deps, payload.feeId as string));

registerJobFailureHook("charge_fee", async (deps, payload, error) => {
  await markFailed(deps, payload.feeId as string, error);
});
