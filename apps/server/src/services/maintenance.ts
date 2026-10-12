import { formatILS } from "@magiali/shared";
import type { Deps } from "../context";
import { enqueue, registerJobHandler } from "./jobs";
import { notify } from "./notify";
import { unusedQuotas } from "./quota";

/** Conservative claim window: policies issued before 11/2020 allow 3 years (newer ones 5). */
const CLAIM_WINDOW_YEARS = 3;
const WARN_DAYS = [60, 14];

/** Makes sure exactly one daily maintenance run is scheduled. Safe to call on every boot. */
export async function ensureDailyMaintenance(deps: Deps): Promise<void> {
  const [pending] = await deps.sql`
    SELECT 1 FROM jobs WHERE type = 'daily_maintenance' AND done_at IS NULL AND failed_at IS NULL LIMIT 1`;
  if (!pending) await enqueue(deps.sql, "daily_maintenance", {}, { runAt: deps.now() });
}

function nextMorning(now: Date): Date {
  // 06:00 UTC ≈ 08:00–09:00 in Israel, right after quiet hours.
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 6, 0, 0));
  return next;
}

async function alreadyNotified(deps: Deps, userId: string, type: string, key: string): Promise<boolean> {
  const [row] = await deps.sql`
    SELECT 1 FROM notifications WHERE user_id = ${userId} AND type = ${type} AND data->>'key' = ${key} LIMIT 1`;
  return !!row;
}

/** Receipts that were never claimed and are approaching the end of the claim window. */
export async function warnExpiringReceipts(deps: Deps): Promise<number> {
  const now = deps.now();
  let sent = 0;
  for (const days of WARN_DAYS) {
    const rows = await deps.sql`
      SELECT r.id, r.amount_agorot, r.service_date, h.owner_user_id
      FROM receipts r JOIN households h ON h.id = r.household_id
      WHERE r.deleted_at IS NULL AND r.service_date IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM claim_receipts cr JOIN claims c ON c.id = cr.claim_id
                        WHERE cr.receipt_id = r.id AND c.status <> 'cancelled')
        AND r.service_date + make_interval(years => ${CLAIM_WINDOW_YEARS}) BETWEEN ${now}::date
            AND ${now}::date + ${days}::int`;
    for (const r of rows) {
      const key = `${r.id as string}:${days}`;
      if (await alreadyNotified(deps, r.ownerUserId as string, "expiry_warning", key)) continue;
      await notify(deps.sql, now, r.ownerUserId as string, {
        type: "expiry_warning",
        title: `⏰ קבלה${r.amountAgorot ? ` של ${formatILS(r.amountAgorot as number)}` : ""} תפוג בעוד פחות מ-${days} יום`,
        body: "אחרי זה כבר אי אפשר לתבוע עליה. להגיש עכשיו?",
        data: { receiptId: r.id, key },
      });
      sent++;
    }
  }
  return sent;
}

/** Reminder waves before the calendar-year quotas reset: mid-November and early December. */
const QUOTA_WAVES = [
  { month: 10, day: 15 },
  { month: 11, day: 5 },
];

/**
 * Towards the end of the year: sessions left in quotas the family actually uses (they reset on January 1st).
 * One summary notification per household per wave – never a nudge towards care nobody needed.
 */
export async function remindUnusedQuotas(deps: Deps): Promise<number> {
  const now = deps.now();
  const year = now.getUTCFullYear();
  const wave = QUOTA_WAVES.findLastIndex(
    (w) => now.getUTCMonth() > w.month || (now.getUTCMonth() === w.month && now.getUTCDate() >= w.day),
  );
  if (wave < 0) return 0;
  const usedSince = new Date(now.getTime() - 365 * 86_400_000).toISOString().slice(0, 10);
  const households = await deps.sql`
    SELECT DISTINCT h.id, h.owner_user_id FROM households h JOIN receipts r ON r.household_id = h.id
    WHERE r.deleted_at IS NULL AND r.service_date >= ${usedSince}`;
  let sent = 0;
  for (const h of households) {
    const key = `${year}-${wave + 1}`;
    if (await alreadyNotified(deps, h.ownerUserId as string, "quota_reminder", key)) continue;
    const quotas = await unusedQuotas(deps, h.id as string, usedSince);
    if (!quotas.length) continue;
    const total = quotas.reduce((s, q) => s + q.left * q.valueEachAgorot, 0);
    const top = quotas
      .slice(0, 3)
      .map((q) => `${q.left} מפגשי ${q.label} ל${q.memberName}`)
      .join(", ");
    await notify(deps.sql, now, h.ownerUserId as string, {
      type: "quota_reminder",
      title: `⏳ עד סוף השנה מגיעים לכם עוד החזרים של עד ${formatILS(total)}`,
      body: `נשארו: ${top}${quotas.length > 3 ? " ועוד" : ""}. ב-1 בינואר המכסות מתאפסות – אם צריך ממילא, כדאי לקבוע לפני.`,
      data: { screen: "/money", key },
    });
    sent++;
  }
  return sent;
}

/** Legs waiting longer than the payer's usual processing time get one nudge. */
export async function nudgeSlowPayers(deps: Deps): Promise<number> {
  const now = deps.now();
  const rows = await deps.sql`
    SELECT l.id, l.claim_id, p.name_he AS payer_name, l.expected_agorot, h.owner_user_id
    FROM claim_legs l JOIN payers p ON p.id = l.payer_id JOIN claims c ON c.id = l.claim_id
    JOIN households h ON h.id = c.household_id
    WHERE l.status IN ('submitted', 'received', 'in_review') AND l.submitted_at IS NOT NULL
      AND l.submitted_at + make_interval(days => p.avg_processing_days) < ${now}`;
  let sent = 0;
  for (const l of rows) {
    const key = l.id as string;
    if (await alreadyNotified(deps, l.ownerUserId as string, "slow_payer", key)) continue;
    await notify(deps.sql, now, l.ownerUserId as string, {
      type: "slow_payer",
      title: `${l.payerName as string} מתעכבים עם התשובה`,
      body: `עבר הזמן הרגיל לטיפול (${formatILS(l.expectedAgorot as number)}). אפשר לפנות אליהם עם מספר הפנייה, או לעדכן אותנו אם הכסף הגיע`,
      data: { claimId: l.claimId, key },
    });
    sent++;
  }
  return sent;
}

/**
 * Data minimisation: deletes stored images (receipts, referrals, summaries) once they are no longer needed —
 * N days after the claim closed, or when an unclaimed receipt is past the claim window. Amounts and statuses stay.
 */
export async function purgeExpiredFiles(deps: Deps): Promise<number> {
  const days = deps.config.RECEIPT_RETENTION_DAYS;
  const docs = await deps.sql`
    SELECT d.id, d.storage_key FROM documents d
    WHERE d.deleted_at IS NULL AND (
      -- every claim the document belongs to is closed, and closed long enough ago
      (EXISTS (SELECT 1 FROM claim_documents_v v WHERE v.document_id = d.id)
       AND NOT EXISTS (
         SELECT 1 FROM claim_documents_v v JOIN claims c ON c.id = v.claim_id
         WHERE v.document_id = d.id
           AND (c.status NOT IN ('completed', 'partially_paid', 'rejected', 'cancelled')
                OR c.updated_at > ${deps.now()}::timestamptz - make_interval(days => ${days}))))
      OR
      -- a receipt never claimed, past the claim window
      EXISTS (SELECT 1 FROM receipts r WHERE r.document_id = d.id AND r.service_date IS NOT NULL
              AND r.service_date < (${deps.now()}::timestamptz - make_interval(years => ${CLAIM_WINDOW_YEARS}))::date
              AND NOT EXISTS (SELECT 1 FROM claim_receipts cr WHERE cr.receipt_id = r.id))
    )
    LIMIT 500`;
  for (const d of docs) {
    await deps.storage.delete(d.storageKey as string).catch(() => undefined);
    await deps.sql`
      UPDATE documents SET deleted_at = ${deps.now()}, storage_key = 'purged:' || id::text, wrapped_key = ''
      WHERE id = ${d.id as string}`;
  }
  if (docs.length) {
    await deps.sql`
      INSERT INTO audit_log (actor_kind, action, entity, meta)
      VALUES ('system', 'files_purged_by_retention', 'document', ${deps.sql.json({ count: docs.length, days } as never)})`;
  }
  return docs.length;
}

registerJobHandler("daily_maintenance", async (deps) => {
  try {
    await warnExpiringReceipts(deps);
    await nudgeSlowPayers(deps);
    await remindUnusedQuotas(deps);
    await purgeExpiredFiles(deps);
  } finally {
    await enqueue(deps.sql, "daily_maintenance", {}, { runAt: nextMorning(deps.now()) });
  }
});
