import type { BankConnectionDto, BenefitCategory } from "@magiali/shared";
import type { AuthContext, Deps } from "../context";
import { AppError, notFound } from "../errors";
import { OpenBankingExpiredError } from "../open-banking";
import { audit } from "./audit";
import { classifyMerchant } from "./card-scan";
import { requireConsent } from "./consents";
import { enqueue, registerJobHandler } from "./jobs";
import { samePayment } from "./money";
import { notify } from "./notify";
import { NATIVE_RETURN } from "./payments";

const DAY = 86_400_000;
/** Claims go back 3 years; providers may return less. */
const FIRST_SYNC_DAYS = 3 * 365;
/** Each later sync re-reads a week back: card transactions can post days after the purchase. */
const OVERLAP_DAYS = 7;
const isoDay = (d: Date) => d.toISOString().slice(0, 10);

function provider(deps: Deps) {
  if (!deps.openBanking) throw new AppError("conflict", "חיבור לבנק ולכרטיסי אשראי עוד לא זמין");
  return deps.openBanking;
}

async function own(deps: Deps, ctx: AuthContext, id: string) {
  const [row] = await deps.sql`SELECT * FROM bank_connections WHERE id = ${id} AND household_id = ${ctx.householdId}`;
  if (!row) throw notFound("החיבור");
  return row;
}

function toDto(r: Record<string, unknown>, leadsFound: number): BankConnectionDto {
  return {
    id: r.id as string,
    status: r.status as BankConnectionDto["status"],
    institutions: r.institutions as string[],
    createdAt: (r.createdAt as Date).toISOString(),
    expiresAt: r.expiresAt ? (r.expiresAt as Date).toISOString() : null,
    lastSyncedAt: r.lastSyncedAt ? (r.lastSyncedAt as Date).toISOString() : null,
    lastError: (r.lastError as string | null) ?? null,
    leadsFound,
  };
}

export async function listBankConnections(deps: Deps, ctx: AuthContext): Promise<BankConnectionDto[]> {
  const rows = await deps.sql`
    SELECT c.*, (SELECT count(*)::int FROM payment_leads l WHERE l.household_id = c.household_id AND l.source = 'bank') AS leads
    FROM bank_connections c WHERE c.household_id = ${ctx.householdId} AND c.status <> 'failed'
    ORDER BY c.created_at DESC`;
  return rows.map((r) => toDto(r, r.leads as number));
}

/** Starts a read-only consent at the provider; the customer picks banks and cards on the provider's page. */
export async function startBankConnection(
  deps: Deps,
  ctx: AuthContext,
  input: { origin: string; platform: "web" | "native"; returnUrl?: string },
): Promise<{ connectionId: string; url: string }> {
  const ob = provider(deps);
  await requireConsent(deps.sql, ctx.userId, "financial_data");
  if (input.platform === "native" && (!input.returnUrl || !NATIVE_RETURN.test(input.returnUrl))) {
    throw new AppError("validation_error", "כתובת חזרה לא תקינה");
  }
  const [row] = await deps.sql`
    INSERT INTO bank_connections (household_id, user_id, provider) VALUES (${ctx.householdId}, ${ctx.userId}, ${ob.name})
    RETURNING id`;
  const id = row!.id as string;
  const back = new URL(`${input.origin}/open-banking/return/${id}`);
  back.searchParams.set("platform", input.platform);
  if (input.returnUrl) back.searchParams.set("to", input.returnUrl);
  const started = await ob.startConsent({ reference: id, redirectUrl: back.toString() });
  await deps.sql`UPDATE bank_connections SET provider_ref = ${started.providerRef} WHERE id = ${id}`;
  await audit(deps.sql, { actorUserId: ctx.userId, actorKind: "user", action: "bank_connection_started", entity: "bank_connection", entityId: id });
  return { connectionId: id, url: started.url };
}

/** Asks the provider where the consent stands; the first time it's active, the first sync is queued. */
export async function refreshBankConnection(deps: Deps, id: string, ctx?: AuthContext): Promise<BankConnectionDto> {
  const row = ctx ? await own(deps, ctx, id) : (await deps.sql`SELECT * FROM bank_connections WHERE id = ${id}`)[0];
  if (!row) throw notFound("החיבור");
  if (row.status === "pending" && row.providerRef && deps.openBanking) {
    const consent = await deps.openBanking.getConsent(row.providerRef as string);
    const expired = deps.now().getTime() - (row.createdAt as Date).getTime() > DAY;
    const status = consent.status === "pending" && expired ? "failed" : consent.status;
    if (status !== "pending") {
      const [updated] = await deps.sql`
        UPDATE bank_connections SET status = ${status}, institutions = ${deps.sql.json(consent.institutions as never)},
               expires_at = ${consent.expiresAt}, updated_at = ${deps.now()}
        WHERE id = ${id} AND status = 'pending' RETURNING id`;
      if (updated && status === "active") await enqueue(deps.sql, "bank_sync", { connectionId: id });
    }
  }
  const [fresh] = await deps.sql`
    SELECT c.*, (SELECT count(*)::int FROM payment_leads l WHERE l.household_id = c.household_id AND l.source = 'bank') AS leads
    FROM bank_connections c WHERE c.id = ${id}`;
  return toDto(fresh!, fresh!.leads as number);
}

/**
 * Reads new transactions and keeps only medical payments that have no receipt in the app, as payment leads.
 * Every other transaction is classified in memory and discarded.
 */
export async function syncBankConnection(deps: Deps, id: string): Promise<{ found: number }> {
  const [c] = await deps.sql`SELECT * FROM bank_connections WHERE id = ${id}`;
  if (!c || c.status !== "active" || !deps.openBanking) return { found: 0 };
  const now = deps.now();
  const from = c.lastSyncedAt
    ? isoDay(new Date((c.lastSyncedAt as Date).getTime() - OVERLAP_DAYS * DAY))
    : isoDay(new Date(now.getTime() - FIRST_SYNC_DAYS * DAY));
  let transactions;
  try {
    transactions = await deps.openBanking.fetchTransactions(c.providerRef as string, { from, to: isoDay(now) });
  } catch (e) {
    if (e instanceof OpenBankingExpiredError) {
      await deps.sql`UPDATE bank_connections SET status = 'expired', updated_at = ${now} WHERE id = ${id}`;
      await notify(deps.sql, now, c.userId as string, {
        type: "bank_sync",
        title: "🏦 החיבור לבנק ולכרטיסים פג",
        body: "כדי שנמשיך למצוא תשלומים לרופאים בלי קבלה, חדשו את החיבור (דקה).",
        data: { screen: "/connect-bank" },
      });
      return { found: 0 };
    }
    await deps.sql`UPDATE bank_connections SET last_error = ${String((e as Error).message).slice(0, 200)}, updated_at = ${now} WHERE id = ${id}`;
    throw e;
  }

  const receipts = await deps.sql`
    SELECT amount_agorot, service_date::text AS service_date FROM receipts
    WHERE household_id = ${c.householdId as string} AND deleted_at IS NULL AND amount_agorot IS NOT NULL AND service_date IS NOT NULL`;
  let found = 0;
  for (const t of transactions) {
    if (!(t.amountIls > 0)) continue; // refunds and credits
    const { medical, category } = classifyMerchant(t.merchant, t.issuerCategory);
    if (!medical) continue;
    const payment = { amountAgorot: Math.round(t.amountIls * 100), date: t.date };
    if (receipts.some((r) => samePayment(payment, { amountAgorot: r.amountAgorot as number, date: r.serviceDate as string }))) continue;
    const [inserted] = await deps.sql`
      INSERT INTO payment_leads (household_id, merchant, paid_on, amount_agorot, category, source)
      VALUES (${c.householdId as string}, ${t.merchant.slice(0, 120)}, ${t.date}, ${payment.amountAgorot}, ${category as BenefitCategory | null}, 'bank')
      ON CONFLICT (household_id, merchant, paid_on, amount_agorot) DO NOTHING
      RETURNING id`;
    if (inserted) found++;
  }
  await deps.sql`UPDATE bank_connections SET last_synced_at = ${now}, last_error = NULL, updated_at = ${now} WHERE id = ${id}`;
  if (found > 0) {
    await notify(deps.sql, now, c.userId as string, {
      type: "bank_sync",
      title: found === 1 ? "💳 מצאנו תשלום לרופא בלי קבלה" : `💳 מצאנו ${found} תשלומים רפואיים בלי קבלה`,
      body: "אולי מגיע עליהם החזר. בקשו קבלה מהמטפל וצלמו אותה – או סמנו שלא רלוונטי.",
      data: { screen: "/money" },
    });
  }
  await audit(deps.sql, { actorKind: "system", action: "bank_synced", entity: "bank_connection", entityId: id, meta: { transactions: transactions.length, found } });
  return { found };
}

export async function requestBankSync(deps: Deps, ctx: AuthContext, id: string): Promise<BankConnectionDto> {
  const row = await own(deps, ctx, id);
  if (row.status !== "active") throw new AppError("conflict", "החיבור לא פעיל");
  await syncBankConnection(deps, id);
  return refreshBankConnection(deps, id, ctx);
}

/** Ends the consent at the provider. Payments already found stay until the family dismisses them. */
export async function revokeBankConnection(deps: Deps, ctx: AuthContext, id: string): Promise<void> {
  const row = await own(deps, ctx, id);
  if (row.providerRef && deps.openBanking && ["active", "pending"].includes(row.status as string)) {
    await deps.openBanking.revoke(row.providerRef as string);
  }
  await deps.sql`UPDATE bank_connections SET status = 'revoked', updated_at = ${deps.now()} WHERE id = ${id}`;
  await audit(deps.sql, { actorUserId: ctx.userId, actorKind: "user", action: "bank_connection_revoked", entity: "bank_connection", entityId: id });
}

/** Account deletion: every consent is ended at the provider right away. */
export async function revokeAllBankConnections(deps: Deps, householdId: string): Promise<void> {
  const rows = await deps.sql`SELECT id, provider_ref FROM bank_connections WHERE household_id = ${householdId} AND status IN ('active', 'pending')`;
  for (const r of rows) {
    if (r.providerRef && deps.openBanking) await deps.openBanking.revoke(r.providerRef as string).catch(() => undefined);
    await deps.sql`UPDATE bank_connections SET status = 'revoked', updated_at = ${deps.now()} WHERE id = ${r.id as string}`;
  }
}

/** Daily: active connections not synced in the last 20 hours. */
export async function enqueueDueBankSyncs(deps: Deps): Promise<number> {
  const due = await deps.sql`
    SELECT id FROM bank_connections
    WHERE status = 'active' AND (last_synced_at IS NULL OR last_synced_at < ${new Date(deps.now().getTime() - 20 * 3_600_000)})`;
  for (const r of due) await enqueue(deps.sql, "bank_sync", { connectionId: r.id });
  return due.length;
}

registerJobHandler("bank_sync", async (deps, payload) => {
  await syncBankConnection(deps, payload.connectionId as string);
});
