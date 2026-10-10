import type { AuthContext, Deps } from "../context";
import { hmacHex, safeEqualHex } from "../crypto";
import { AppError, notFound } from "../errors";
import { audit } from "./audit";

export type SetupStatus = "pending" | "completed" | "failed";

/** A hosted page left open longer than this is treated as abandoned. */
const SETUP_TTL_MS = 30 * 60_000;

/** Native apps come back through their own URL scheme (or Expo Go's while developing). */
const NATIVE_RETURN = /^(magiali|exp|exps):\/\/[\w./:@%-]*$/;

function webhookSignature(deps: Deps, setupId: string): string {
  return hmacHex(deps.config.FILES_SIGNING_SECRET, `payment-setup:${setupId}`);
}

export function verifyWebhookSignature(deps: Deps, setupId: string, sig: string): boolean {
  return /^[0-9a-f]{64}$/.test(sig) && safeEqualHex(sig, webhookSignature(deps, setupId));
}

/** Starts a "save card" session on the provider's hosted page. Nothing is charged. */
export async function startCardSetup(
  deps: Deps,
  ctx: AuthContext,
  input: { origin: string; platform: "web" | "native"; returnUrl?: string },
): Promise<{ setupId: string; url: string }> {
  if (input.platform === "native" && (!input.returnUrl || !NATIVE_RETURN.test(input.returnUrl))) {
    throw new AppError("validation_error", "כתובת חזרה לא תקינה");
  }
  const [user] = await deps.sql`SELECT phone_e164, display_name FROM users WHERE id = ${ctx.userId}`;
  const [setup] = await deps.sql`
    INSERT INTO payment_setups (user_id, provider) VALUES (${ctx.userId}, ${deps.payments.name}) RETURNING id`;
  const setupId = setup!.id as string;

  const back = new URL(`${input.origin}/payments/return/${setupId}`);
  back.searchParams.set("platform", input.platform);
  if (input.returnUrl) back.searchParams.set("to", input.returnUrl);
  const successUrl = new URL(back);
  successUrl.searchParams.set("result", "ok");
  const failureUrl = new URL(back);
  failureUrl.searchParams.set("result", "fail");

  const started = await deps.payments.startCardSetup({
    reference: setupId,
    successUrl: successUrl.toString(),
    failureUrl: failureUrl.toString(),
    webhookUrl: `${input.origin}/payments/webhook/${setupId}?sig=${webhookSignature(deps, setupId)}`,
    customer: { name: (user?.displayName as string | null) ?? null, phone: user?.phoneE164 as string },
  });
  await deps.sql`UPDATE payment_setups SET provider_ref = ${started.providerRef} WHERE id = ${setupId}`;
  return { setupId, url: started.url };
}

/**
 * Asks the provider how the setup ended and, the first time it succeeds, saves the card as the default
 * payment method. Safe to call from the app's polling and from the provider's webhook at the same time.
 */
export async function refreshCardSetup(
  deps: Deps,
  setupId: string,
  opts: { userId?: string; returnedWithFailure?: boolean } = {},
): Promise<SetupStatus> {
  const [setup] = await deps.sql`SELECT * FROM payment_setups WHERE id = ${setupId}`;
  if (!setup || (opts.userId && setup.userId !== opts.userId)) throw notFound("ההגדרה");
  if (setup.status !== "pending" || !setup.providerRef) return setup.status as SetupStatus;

  const result = await deps.payments.getCardSetupResult(setup.providerRef as string);
  const expired = deps.now().getTime() - (setup.createdAt as Date).getTime() > SETUP_TTL_MS;
  if (result.status === "failed" || (result.status === "pending" && (opts.returnedWithFailure || expired))) {
    const reason = result.status === "failed" ? result.reason : opts.returnedWithFailure ? "declined_on_page" : "expired";
    await deps.sql`
      UPDATE payment_setups SET status = 'failed', failure_reason = ${reason}, completed_at = ${deps.now()}
      WHERE id = ${setupId} AND status = 'pending'`;
    return "failed";
  }
  if (result.status === "pending") return "pending";

  await deps.sql.begin(async (tx) => {
    const [claimed] = await tx`
      UPDATE payment_setups SET status = 'completed', completed_at = ${deps.now()}
      WHERE id = ${setupId} AND status = 'pending' RETURNING user_id`;
    if (!claimed) return; // another caller finished it
    const ownerId = claimed.userId as string;
    await tx`UPDATE payment_methods SET is_default = false WHERE user_id = ${ownerId}`;
    const [pm] = await tx`
      INSERT INTO payment_methods (user_id, provider, provider_token_enc, brand, last4, exp_month, exp_year, is_default)
      VALUES (${ownerId}, ${deps.payments.name}, ${deps.crypto.encryptString(result.token)}, ${result.brand ?? null},
              ${result.last4 ?? null}, ${result.expMonth ?? null}, ${result.expYear ?? null}, true)
      RETURNING id`;
    await tx`UPDATE payment_setups SET payment_method_id = ${pm!.id as string} WHERE id = ${setupId}`;
    await audit(tx, { actorUserId: ownerId, actorKind: "user", action: "payment_method_added", entity: "payment_method", entityId: pm!.id as string });
  });
  return "completed";
}
