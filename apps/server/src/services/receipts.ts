import { randomUUID } from "node:crypto";
import type { BenefitCategory, ExtractedFields, ReceiptDto } from "@magiali/shared";
import type { AuthContext, Deps } from "../context";
import { hmacHex, sha256Hex } from "../crypto";
import type { Db } from "../db";
import { AppError, notFound } from "../errors";
import { EXTRACTABLE_MIME_TYPES, ManualExtractor, RetryableExtractionError, type ExtractableMime } from "../extraction";
import { iso } from "../http";
import { audit } from "./audit";
import { hasConsent, requireConsent } from "./consents";
import { getMemberForHousehold, listMembers } from "./households";
import { enqueue, PermanentJobError, registerJobFailureHook, registerJobHandler } from "./jobs";
import { notify } from "./notify";

export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
const DOC_KINDS = ["receipt", "visit_summary", "referral", "payer_payment_proof", "policy", "other"] as const;
export type StoredDocKind = (typeof DOC_KINDS)[number];

export function signedFileUrl(deps: Deps, documentId: string, ttlSeconds = 300): string {
  const exp = Math.floor(deps.now().getTime() / 1000) + ttlSeconds;
  const sig = hmacHex(deps.config.FILES_SIGNING_SECRET, `${documentId}:${exp}`);
  return `${deps.config.PUBLIC_BASE_URL}/v1/files/${documentId}?exp=${exp}&sig=${sig}`;
}

export async function storeDocument(
  deps: Deps,
  ctx: AuthContext,
  input: { data: Buffer; mimeType: string; kind: StoredDocKind; memberId?: string | null },
): Promise<{ id: string; sha256: string }> {
  await requireConsent(deps.sql, ctx.userId, "medical_data");
  if (!(EXTRACTABLE_MIME_TYPES as readonly string[]).includes(input.mimeType)) {
    throw new AppError("unsupported_media_type", "אפשר להעלות תמונה (JPG/PNG/WEBP) או PDF");
  }
  if (input.data.length === 0) throw new AppError("validation_error", "הקובץ ריק");
  if (input.data.length > MAX_UPLOAD_BYTES) throw new AppError("payload_too_large", "הקובץ גדול מדי (עד 15MB)");
  if (input.memberId) await getMemberForHousehold(deps.sql, ctx.householdId, input.memberId);

  const sha256 = sha256Hex(input.data);
  const { ciphertext, wrappedKey } = deps.crypto.encryptFile(input.data);
  const storageKey = `docs/${ctx.householdId}/${randomUUID()}`;
  await deps.storage.put(storageKey, ciphertext);
  const [doc] = await deps.sql`
    INSERT INTO documents (household_id, member_id, kind, storage_key, wrapped_key, mime_type, size_bytes, sha256, uploaded_by)
    VALUES (${ctx.householdId}, ${input.memberId ?? null}, ${input.kind}, ${storageKey}, ${wrappedKey},
            ${input.mimeType}, ${input.data.length}, ${sha256}, ${ctx.userId})
    RETURNING id`;
  return { id: doc!.id as string, sha256 };
}

export async function readDocument(deps: Deps, documentId: string): Promise<{ data: Buffer; mimeType: string; householdId: string }> {
  const [doc] = await deps.sql`
    SELECT storage_key, wrapped_key, mime_type, household_id FROM documents WHERE id = ${documentId} AND deleted_at IS NULL`;
  if (!doc) throw notFound("הקובץ");
  const encrypted = await deps.storage.get(doc.storageKey as string);
  return {
    data: deps.crypto.decryptFile(encrypted, doc.wrappedKey as string),
    mimeType: doc.mimeType as string,
    householdId: doc.householdId as string,
  };
}

export async function uploadReceipt(
  deps: Deps,
  ctx: AuthContext,
  input: { data: Buffer; mimeType: string; memberId?: string | null },
): Promise<ReceiptDto> {
  const hash = sha256Hex(input.data);
  const [dup] = await deps.sql`
    SELECT r.id FROM receipts r JOIN documents d ON d.id = r.document_id
    WHERE r.household_id = ${ctx.householdId} AND d.sha256 = ${hash} AND r.deleted_at IS NULL`;
  if (dup) throw new AppError("conflict", "הקבלה הזו כבר הועלתה", { receiptId: dup.id });

  const doc = await storeDocument(deps, ctx, { ...input, kind: "receipt" });
  const [receipt] = await deps.sql`
    INSERT INTO receipts (household_id, document_id, member_id)
    VALUES (${ctx.householdId}, ${doc.id}, ${input.memberId ?? null})
    RETURNING id`;
  await enqueue(deps.sql, "extract_receipt", { receiptId: receipt!.id }, { maxAttempts: 3 });
  return getReceipt(deps, ctx, receipt!.id as string);
}

const MANUAL = new ManualExtractor();

type ReceiptRow = {
  id: string;
  documentId: string;
  memberId: string | null;
  extractionStatus: ReceiptDto["extractionStatus"];
  extracted: ExtractedFields | null;
  confirmedAt: Date | null;
  category: BenefitCategory | null;
  providerName: string | null;
  serviceDate: string | null;
  amountAgorot: number | null;
  sessions: number;
  createdAt: Date;
  /** false once the image was deleted under the retention policy */
  fileAvailable: boolean;
};

function toDto(deps: Deps, r: ReceiptRow): ReceiptDto {
  return {
    id: r.id,
    memberId: r.memberId,
    extractionStatus: r.extractionStatus,
    extracted: r.extracted,
    confirmed: r.confirmedAt !== null,
    category: r.category,
    providerName: r.providerName,
    serviceDate: r.serviceDate,
    amountAgorot: r.amountAgorot,
    sessions: r.sessions,
    imageUrl: r.fileAvailable ? signedFileUrl(deps, r.documentId) : null,
    createdAt: iso(r.createdAt)!,
  };
}

export async function getReceipt(deps: Deps, ctx: AuthContext, receiptId: string): Promise<ReceiptDto> {
  const [r] = await deps.sql`
    SELECT id, document_id, member_id, extraction_status, extracted, confirmed_at, category, provider_name,
           service_date, amount_agorot, sessions, created_at,
           (SELECT d.deleted_at IS NULL FROM documents d WHERE d.id = receipts.document_id) AS file_available
    FROM receipts WHERE id = ${receiptId} AND household_id = ${ctx.householdId} AND deleted_at IS NULL`;
  if (!r) throw notFound("הקבלה");
  return toDto(deps, r as unknown as ReceiptRow);
}

export async function listReceipts(deps: Deps, ctx: AuthContext, filter: { unclaimedOnly?: boolean }): Promise<ReceiptDto[]> {
  const rows = await deps.sql`
    SELECT r.id, r.document_id, r.member_id, r.extraction_status, r.extracted, r.confirmed_at, r.category,
           r.provider_name, r.service_date, r.amount_agorot, r.sessions, r.created_at,
           (SELECT d.deleted_at IS NULL FROM documents d WHERE d.id = r.document_id) AS file_available
    FROM receipts r
    WHERE r.household_id = ${ctx.householdId} AND r.deleted_at IS NULL
      AND (${filter.unclaimedOnly ?? false} = false
           OR NOT EXISTS (SELECT 1 FROM claim_receipts cr JOIN claims c ON c.id = cr.claim_id
                          WHERE cr.receipt_id = r.id AND c.status <> 'cancelled'))
    ORDER BY r.created_at DESC LIMIT 200`;
  return rows.map((r) => toDto(deps, r as unknown as ReceiptRow));
}

async function assertNotInActiveClaim(db: Db, receiptId: string): Promise<void> {
  const [inClaim] = await db`
    SELECT 1 FROM claim_receipts cr JOIN claims c ON c.id = cr.claim_id
    WHERE cr.receipt_id = ${receiptId} AND c.status <> 'cancelled'`;
  if (inClaim) throw new AppError("conflict", "הקבלה כבר שייכת לתביעה");
}

export async function confirmReceipt(
  deps: Deps,
  ctx: AuthContext,
  receiptId: string,
  input: { memberId: string; category: BenefitCategory; providerName: string; serviceDate: string; amountAgorot: number; sessions: number },
): Promise<ReceiptDto> {
  await getReceipt(deps, ctx, receiptId);
  await getMemberForHousehold(deps.sql, ctx.householdId, input.memberId);
  await assertNotInActiveClaim(deps.sql, receiptId);
  if (input.serviceDate > deps.now().toISOString().slice(0, 10)) {
    throw new AppError("validation_error", "תאריך השירות לא יכול להיות בעתיד");
  }
  await deps.sql`
    UPDATE receipts SET member_id = ${input.memberId}, category = ${input.category}, provider_name = ${input.providerName},
           service_date = ${input.serviceDate}, amount_agorot = ${input.amountAgorot}, sessions = ${input.sessions},
           confirmed_at = ${deps.now()}, updated_at = ${deps.now()},
           extraction_status = CASE WHEN extraction_status IN ('pending', 'processing', 'failed') THEN 'manual' ELSE extraction_status END
    WHERE id = ${receiptId}`;
  return getReceipt(deps, ctx, receiptId);
}

export async function deleteReceipt(deps: Deps, ctx: AuthContext, receiptId: string): Promise<void> {
  await getReceipt(deps, ctx, receiptId);
  await assertNotInActiveClaim(deps.sql, receiptId);
  await deps.sql`UPDATE receipts SET deleted_at = ${deps.now()} WHERE id = ${receiptId}`;
  await audit(deps.sql, { actorUserId: ctx.userId, actorKind: "user", action: "receipt_deleted", entity: "receipt", entityId: receiptId });
}

function normalize(name: string): string {
  return name.replace(/[^\p{L}\s]/gu, "").trim();
}

/** Picks the household member whose name appears on the receipt, if exactly one matches. */
export function guessMember(members: Array<{ id: string; fullName: string }>, patientName: string | null): string | null {
  if (!patientName) return null;
  const patient = normalize(patientName);
  const matches = members.filter((m) => {
    const first = normalize(m.fullName).split(/\s+/)[0];
    return first !== undefined && first.length >= 2 && patient.includes(first);
  });
  return matches.length === 1 ? matches[0]!.id : null;
}

registerJobHandler("extract_receipt", async (deps, payload) => {
  const receiptId = payload.receiptId as string;
  const [r] = await deps.sql`
    SELECT r.id, r.household_id, r.document_id, r.member_id, r.confirmed_at, h.owner_user_id
    FROM receipts r JOIN households h ON h.id = r.household_id
    WHERE r.id = ${receiptId} AND r.deleted_at IS NULL`;
  if (!r) throw new PermanentJobError("receipt not found");
  if (r.confirmedAt) return; // user already filled it in

  await deps.sql`UPDATE receipts SET extraction_status = 'processing' WHERE id = ${receiptId}`;
  const doc = await readDocument(deps, r.documentId as string);
  // The receipt goes to the AI provider (abroad) only with the user's explicit, separate consent.
  const extractor = (await hasConsent(deps.sql, r.ownerUserId as string, "ai_processing")) ? deps.extractor : MANUAL;

  let fields: ExtractedFields;
  try {
    fields = await extractor.extract({ data: doc.data, mimeType: doc.mimeType as ExtractableMime });
  } catch (error) {
    if (error instanceof RetryableExtractionError) throw error;
    throw new PermanentJobError(error instanceof Error ? error.message : "extraction failed");
  }

  const members = await listMembers(deps.sql, r.householdId as string);
  const memberId = (r.memberId as string | null) ?? guessMember(members, fields.patientName);
  const status = extractor.name === "manual" ? "manual" : "done";

  await deps.sql`
    UPDATE receipts SET
      extraction_status = ${status},
      extracted = ${deps.sql.json(fields as never)},
      member_id = ${memberId},
      category = COALESCE(category, ${fields.category}),
      provider_name = COALESCE(provider_name, ${fields.providerName}),
      service_date = COALESCE(service_date, ${fields.serviceDate}),
      amount_agorot = COALESCE(amount_agorot, ${fields.amountAgorot}),
      sessions = ${fields.sessions ?? 1},
      updated_at = ${deps.now()}
    WHERE id = ${receiptId} AND confirmed_at IS NULL`;

  if (status === "done") {
    await notify(deps.sql, deps.now(), r.ownerUserId as string, {
      type: "receipt_ready",
      title: "הקבלה מוכנה",
      body: fields.isMedicalReceipt ? "בדוק את הפרטים ב-10 שניות ונחשב כמה מגיע לך" : "לא בטוחים שזו קבלה רפואית. כדאי לבדוק",
      data: { receiptId },
      urgent: true,
    });
  }
});

registerJobFailureHook("extract_receipt", async (deps, payload) => {
  await deps.sql`
    UPDATE receipts SET extraction_status = 'manual', updated_at = ${deps.now()}
    WHERE id = ${payload.receiptId as string} AND confirmed_at IS NULL`;
});
