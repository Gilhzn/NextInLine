import type { Deps } from "../context";
import type { Db } from "../db";
import { enqueue, registerJobHandler } from "./jobs";

export type NotificationType =
  | "receipt_ready"
  | "missing_document"
  | "leg_paid"
  | "leg_rejected"
  | "fee_upcoming"
  | "fee_failed"
  | "fee_refunded"
  | "claim_submitted"
  | "expiry_warning"
  | "slow_payer";

const QUIET_START = 21;
const QUIET_END = 8;

function jerusalemHour(d: Date): number {
  return Number(
    new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Jerusalem", hour: "2-digit", hourCycle: "h23" }).format(d),
  );
}

/** Non-urgent messages wait until 08:00 Israel time when created during quiet hours (21:00–08:00). */
export function deliveryTime(now: Date, urgent: boolean): Date {
  if (urgent) return now;
  const hour = jerusalemHour(now);
  if (hour >= QUIET_END && hour < QUIET_START) return now;
  const hoursUntil = hour >= QUIET_START ? 24 - hour + QUIET_END : QUIET_END - hour;
  const target = new Date(now.getTime() + hoursUntil * 3_600_000);
  target.setUTCMinutes(0, 0, 0);
  return target;
}

export async function notify(
  db: Db,
  now: Date,
  userId: string,
  n: { type: NotificationType; title: string; body: string; data?: Record<string, unknown>; urgent?: boolean },
): Promise<void> {
  const [row] = await db`
    INSERT INTO notifications (user_id, type, title, body, data)
    VALUES (${userId}, ${n.type}, ${n.title}, ${n.body}, ${n.data ? db.json(n.data as never) : null})
    RETURNING id`;
  await enqueue(db, "send_notification", { notificationId: row!.id }, { runAt: deliveryTime(now, n.urgent ?? false) });
}

registerJobHandler("send_notification", async (deps: Deps, payload) => {
  const [n] = await deps.sql`
    SELECT id, user_id, title, body, data, sent_at FROM notifications WHERE id = ${payload.notificationId as string}`;
  if (!n || n.sentAt) return;
  const tokens = await deps.sql`SELECT expo_token FROM push_tokens WHERE user_id = ${n.userId as string}`;
  if (tokens.length > 0) {
    await deps.push.send(
      tokens.map((t) => ({
        to: t.expoToken as string,
        title: n.title as string,
        body: n.body as string,
        data: { ...((n.data as Record<string, unknown>) ?? {}), notificationId: n.id },
      })),
    );
  }
  await deps.sql`UPDATE notifications SET sent_at = ${deps.now()} WHERE id = ${n.id as string}`;
});
