import type { AuthContext, Deps } from "../context";
import { audit } from "./audit";
import { enqueue, registerJobHandler } from "./jobs";

const PURGE_DELAY_DAYS = 30;

/** Everything we hold about the household, for the user's right of access. Files are listed, not inlined. */
export async function exportData(deps: Deps, ctx: AuthContext): Promise<Record<string, unknown>> {
  const h = ctx.householdId;
  const data = {
    exportedAt: deps.now().toISOString(),
    user: await deps.sql`SELECT id, phone_e164, display_name, locale, created_at FROM users WHERE id = ${ctx.userId}`,
    members: await deps.sql`SELECT id, full_name, relation, birth_date, consent_status, created_at FROM members WHERE household_id = ${h}`,
    enrollments: await deps.sql`
      SELECT e.plan_id, e.is_shaban_supplement, e.created_at FROM enrollments e JOIN members m ON m.id = e.member_id
      WHERE m.household_id = ${h}`,
    receipts: await deps.sql`
      SELECT id, member_id, category, provider_name, service_date, amount_agorot, sessions, extraction_status, created_at
      FROM receipts WHERE household_id = ${h}`,
    documents: await deps.sql`SELECT id, kind, mime_type, size_bytes, created_at FROM documents WHERE household_id = ${h}`,
    claims: await deps.sql`
      SELECT id, member_id, status, category, provider_name, service_date, amount_agorot, total_expected_agorot,
             total_paid_agorot, created_at FROM claims WHERE household_id = ${h}`,
    claimLegs: await deps.sql`
      SELECT l.claim_id, l.seq, l.payer_id, l.status, l.expected_agorot, l.paid_agorot, l.submitted_at, l.paid_at
      FROM claim_legs l JOIN claims c ON c.id = l.claim_id WHERE c.household_id = ${h}`,
    fees: await deps.sql`SELECT claim_id, amount_agorot, status, charged_at FROM fees WHERE household_id = ${h}`,
    consents: await deps.sql`SELECT kind, version, granted_at, revoked_at FROM consents WHERE user_id = ${ctx.userId}`,
    notifications: await deps.sql`SELECT type, title, body, created_at FROM notifications WHERE user_id = ${ctx.userId}`,
  };
  await audit(deps.sql, { actorUserId: ctx.userId, actorKind: "user", action: "data_exported", entity: "household", entityId: h });
  return data;
}

/**
 * Immediate soft delete (login disabled, tokens revoked, phone released) and a hard purge after 30 days.
 * Financial records (fees, claim amounts) are kept anonymised for accounting obligations.
 */
export async function deleteAccount(deps: Deps, ctx: AuthContext): Promise<void> {
  const now = deps.now();
  await deps.sql.begin(async (tx) => {
    await tx`
      UPDATE users SET deleted_at = ${now}, phone_e164 = ${`deleted:${ctx.userId}`}, display_name = NULL, updated_at = ${now}
      WHERE id = ${ctx.userId}`;
    await tx`UPDATE refresh_tokens SET revoked_at = ${now} WHERE user_id = ${ctx.userId} AND revoked_at IS NULL`;
    await tx`DELETE FROM push_tokens WHERE user_id = ${ctx.userId}`;
    await tx`UPDATE payment_methods SET deleted_at = ${now}, provider_token_enc = '' WHERE user_id = ${ctx.userId}`;
    await tx`UPDATE claims SET status = 'cancelled', updated_at = ${now} WHERE household_id = ${ctx.householdId} AND status IN ('draft', 'awaiting_documents', 'ready')`;
    await enqueue(tx, "purge_deleted_user", { userId: ctx.userId, householdId: ctx.householdId }, {
      runAt: new Date(now.getTime() + PURGE_DELAY_DAYS * 86_400_000),
    });
  });
  await audit(deps.sql, { actorUserId: ctx.userId, actorKind: "user", action: "account_deleted", entity: "user", entityId: ctx.userId });
}

registerJobHandler("purge_deleted_user", async (deps, payload) => {
  const householdId = payload.householdId as string;
  const docs = await deps.sql`SELECT id, storage_key FROM documents WHERE household_id = ${householdId} AND storage_key <> ''`;
  for (const d of docs) {
    await deps.storage.delete(d.storageKey as string);
  }
  await deps.sql.begin(async (tx) => {
    await tx`UPDATE documents SET deleted_at = ${deps.now()}, storage_key = 'purged:' || id::text, wrapped_key = '' WHERE household_id = ${householdId}`;
    await tx`
      UPDATE receipts SET extracted = NULL, provider_name = NULL, deleted_at = COALESCE(deleted_at, ${deps.now()})
      WHERE household_id = ${householdId}`;
    await tx`UPDATE claims SET provider_name = NULL, routing = '{}'::jsonb WHERE household_id = ${householdId}`;
    await tx`
      UPDATE members SET full_name = 'נמחק', birth_date = NULL, consent_phone_e164 = NULL, deleted_at = COALESCE(deleted_at, ${deps.now()})
      WHERE household_id = ${householdId}`;
    await tx`DELETE FROM enrollments WHERE member_id IN (SELECT id FROM members WHERE household_id = ${householdId})`;
    await tx`DELETE FROM notifications WHERE user_id = ${payload.userId as string}`;
    await tx`DELETE FROM otp_challenges WHERE member_id IN (SELECT id FROM members WHERE household_id = ${householdId})`;
  });
  await audit(deps.sql, { actorKind: "system", action: "account_purged", entity: "household", entityId: householdId });
});
