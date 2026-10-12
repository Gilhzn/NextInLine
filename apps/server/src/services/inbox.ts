import { randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { InboxDto } from "@magiali/shared";
import type { AuthContext, Deps } from "../context";
import { AppError } from "../errors";
import { EXTRACTABLE_MIME_TYPES } from "../extraction";
import { audit } from "./audit";
import { hasConsent } from "./consents";
import { notify } from "./notify";
import { MAX_UPLOAD_BYTES, uploadReceipt } from "./receipts";

/** Per household per day – a forwarding loop or a leaked address can't flood the account. */
const DAILY_LIMIT = 30;
const MAX_ATTACHMENTS = 6;
/** Inline images below this size are logos and signatures, not receipts. */
const MIN_INLINE_IMAGE_BYTES = 30_000;
const TOKEN_ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789";

function newToken(): string {
  const bytes = randomBytes(12);
  return [...bytes].map((b) => TOKEN_ALPHABET[b % TOKEN_ALPHABET.length]).join("");
}

/** The family's private address for receipts, created on first use. Null when email intake isn't configured. */
export async function inboxAddress(deps: Deps, householdId: string): Promise<string | null> {
  const domain = deps.config.INBOUND_EMAIL_DOMAIN;
  if (!domain) return null;
  const [h] = await deps.sql`SELECT inbox_token FROM households WHERE id = ${householdId}`;
  let token = h?.inboxToken as string | null;
  if (!token) {
    token = newToken();
    await deps.sql`UPDATE households SET inbox_token = ${token} WHERE id = ${householdId} AND inbox_token IS NULL`;
    const [again] = await deps.sql`SELECT inbox_token FROM households WHERE id = ${householdId}`;
    token = again!.inboxToken as string;
  }
  return `r-${token}@${domain}`;
}

export async function getInbox(deps: Deps, ctx: AuthContext): Promise<InboxDto> {
  const recent = await deps.sql`
    SELECT received_at, from_address, receipts, status FROM inbound_emails
    WHERE household_id = ${ctx.householdId} ORDER BY received_at DESC LIMIT 10`;
  return {
    address: await inboxAddress(deps, ctx.householdId),
    recent: recent.map((r) => ({
      receivedAt: (r.receivedAt as Date).toISOString(),
      from: r.fromAddress as string | null,
      receipts: r.receipts as number,
      status: r.status as InboxDto["recent"][number]["status"],
    })),
  };
}

/** A new address; the old one stops working at once (e.g. it was shared too widely). */
export async function rotateInbox(deps: Deps, ctx: AuthContext): Promise<InboxDto> {
  if (!deps.config.INBOUND_EMAIL_DOMAIN) throw new AppError("conflict", "קבלות במייל לא זמינות כרגע");
  await deps.sql`UPDATE households SET inbox_token = ${newToken()} WHERE id = ${ctx.householdId}`;
  await audit(deps.sql, { actorUserId: ctx.userId, actorKind: "user", action: "inbox_rotated", entity: "household", entityId: ctx.householdId });
  return getInbox(deps, ctx);
}

/** The inbound provider authenticates with HTTP Basic (any user, password = secret) or an x-inbound-secret header. */
export function inboundAuthorized(deps: Deps, headers: Record<string, string | string[] | undefined>): boolean {
  const secret = deps.config.INBOUND_EMAIL_SECRET;
  if (!secret) return false;
  let given = typeof headers["x-inbound-secret"] === "string" ? (headers["x-inbound-secret"] as string) : "";
  const auth = typeof headers.authorization === "string" ? headers.authorization : "";
  if (!given && auth.startsWith("Basic ")) {
    const decoded = Buffer.from(auth.slice(6), "base64").toString("utf8");
    given = decoded.slice(decoded.indexOf(":") + 1);
  }
  const a = Buffer.from(given);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Postmark's inbound JSON (other providers can be adapted to it). Only the fields we use. */
export const inboundEmailSchema = z.object({
  From: z.string().optional(),
  FromFull: z.object({ Email: z.string() }).partial().optional(),
  To: z.string().optional(),
  ToFull: z.array(z.object({ Email: z.string() }).partial()).optional(),
  CcFull: z.array(z.object({ Email: z.string() }).partial()).optional(),
  OriginalRecipient: z.string().optional(),
  Attachments: z
    .array(
      z.object({
        Name: z.string().optional(),
        Content: z.string(),
        ContentType: z.string().optional(),
        ContentID: z.string().optional(),
      }),
    )
    .optional(),
});
export type InboundEmail = z.infer<typeof inboundEmailSchema>;

const MIME_BY_EXTENSION: Record<string, (typeof EXTRACTABLE_MIME_TYPES)[number]> = {
  pdf: "application/pdf",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

function attachmentMime(a: { Name?: string; ContentType?: string }): (typeof EXTRACTABLE_MIME_TYPES)[number] | null {
  const type = (a.ContentType ?? "").split(";")[0]!.trim().toLowerCase();
  if ((EXTRACTABLE_MIME_TYPES as readonly string[]).includes(type)) return type as (typeof EXTRACTABLE_MIME_TYPES)[number];
  const ext = (a.Name ?? "").split(".").pop()?.toLowerCase() ?? "";
  return MIME_BY_EXTENSION[ext] ?? null;
}

/**
 * One email to a family's private address: every receipt-like attachment (PDF or photo) becomes a receipt waiting
 * for the family to confirm. Nothing but the sender address and counts is kept about the email itself.
 */
export async function receiveInboundEmail(deps: Deps, email: InboundEmail): Promise<{ status: string; receipts: number }> {
  const domain = deps.config.INBOUND_EMAIL_DOMAIN;
  if (!domain) return { status: "disabled", receipts: 0 };
  const recipients = [
    email.OriginalRecipient,
    ...(email.ToFull ?? []).map((t) => t.Email),
    ...(email.CcFull ?? []).map((t) => t.Email),
    ...(email.To ?? "").split(","),
  ];
  const pattern = new RegExp(`r-([a-z0-9]{8,32})@${domain.replace(/\./g, "\\.")}`, "i");
  const token = recipients.map((r) => pattern.exec(r ?? "")?.[1]?.toLowerCase()).find(Boolean);
  if (!token) return { status: "unknown_recipient", receipts: 0 };
  const [household] = await deps.sql`
    SELECT h.id, h.owner_user_id FROM households h JOIN users u ON u.id = h.owner_user_id
    WHERE h.inbox_token = ${token} AND u.deleted_at IS NULL`;
  if (!household) return { status: "unknown_recipient", receipts: 0 };
  const ctx: AuthContext = { householdId: household.id as string, userId: household.ownerUserId as string };
  const from = (email.FromFull?.Email ?? email.From ?? "").slice(0, 200) || null;

  const log = async (status: "processed" | "no_attachments" | "rejected", attachments: number, receipts: number) => {
    await deps.sql`
      INSERT INTO inbound_emails (household_id, from_address, attachments, receipts, status)
      VALUES (${ctx.householdId}, ${from}, ${attachments}, ${receipts}, ${status})`;
    await audit(deps.sql, { actorKind: "system", action: "email_receipt_received", entity: "household", entityId: ctx.householdId, meta: { status, attachments, receipts } });
  };

  const [today] = await deps.sql`
    SELECT count(*)::int AS n FROM inbound_emails
    WHERE household_id = ${ctx.householdId} AND received_at > ${new Date(deps.now().getTime() - 86_400_000)}`;
  if ((today!.n as number) >= DAILY_LIMIT) {
    await log("rejected", 0, 0);
    return { status: "rate_limited", receipts: 0 };
  }
  if (!(await hasConsent(deps.sql, ctx.userId, "medical_data"))) {
    await log("rejected", 0, 0);
    await notify(deps.sql, deps.now(), ctx.userId, {
      type: "email_receipt",
      title: "📧 קיבלנו מייל עם קבלה",
      body: "כדי לקלוט קבלות צריך קודם לאשר עיבוד מידע רפואי (הגדרות ← הסכמות). אחר כך העבירו את המייל שוב.",
      data: { screen: "/email-receipts" },
    });
    return { status: "consent_required", receipts: 0 };
  }

  const files = (email.Attachments ?? [])
    .map((a) => ({ a, mime: attachmentMime(a), data: Buffer.from(a.Content, "base64") }))
    .filter((f) => f.mime && f.data.length > 0 && f.data.length <= MAX_UPLOAD_BYTES)
    // Inline images in the body are logos and signatures unless they're big enough to be a photo of a receipt.
    .filter((f) => f.mime === "application/pdf" || !f.a.ContentID || f.data.length >= MIN_INLINE_IMAGE_BYTES)
    .filter((f) => f.mime === "application/pdf" || f.data.length >= 5_000)
    .slice(0, MAX_ATTACHMENTS);

  const receiptIds: string[] = [];
  for (const f of files) {
    try {
      const receipt = await uploadReceipt(deps, ctx, { data: f.data, mimeType: f.mime! });
      receiptIds.push(receipt.id);
    } catch (e) {
      // The same receipt forwarded twice is simply skipped.
      if (!(e instanceof AppError && e.code === "conflict")) throw e;
    }
  }
  if (receiptIds.length) {
    await deps.sql`UPDATE receipts SET source = 'email' WHERE id IN ${deps.sql(receiptIds)}`;
  }

  if (files.length === 0) {
    await log("no_attachments", email.Attachments?.length ?? 0, 0);
    await notify(deps.sql, deps.now(), ctx.userId, {
      type: "email_receipt",
      title: "📧 קיבלנו מייל בלי קבלה מצורפת",
      body: `${from ? `מ-${from}. ` : ""}אם הקבלה בקישור – שמרו אותה כ-PDF והעבירו שוב, או צלמו אותה באפליקציה.`,
      data: { screen: "/email-receipts" },
    });
    return { status: "no_attachments", receipts: 0 };
  }
  await log("processed", files.length, receiptIds.length);
  if (receiptIds.length) {
    await notify(deps.sql, deps.now(), ctx.userId, {
      type: "email_receipt",
      title: receiptIds.length === 1 ? "🧾 קיבלנו קבלה במייל" : `🧾 קיבלנו ${receiptIds.length} קבלות במייל`,
      body: `${from ? `מ-${from}. ` : ""}בודקים כמה מגיע – אשרו את הפרטים ונגיש.`,
      data: { receiptId: receiptIds[0] },
    });
  }
  return { status: "processed", receipts: receiptIds.length };
}
