import { CATEGORY_INFO, type BenefitCategory, type StatementCandidateDto, type StatementScanDto } from "@magiali/shared";
import type { AuthContext, Deps } from "../context";
import { AppError, notFound } from "../errors";
import type { RawTransaction } from "../statement-reader";
import { audit } from "./audit";
import { hasConsent } from "./consents";
import { routeForMember } from "./coverage";
import { listMembers } from "./households";
import { samePayment } from "./money";
import { readCsv, readXlsx, sniff, toIsoDate } from "./policy-import";

/**
 * Credit card statement scan: finds medical payments the family made and checks which of them still have no
 * receipt in the app – money that may be refundable but is easy to forget. The statement is read in memory and
 * discarded; only the rows the user then confirms are kept (payment_leads).
 */

const CLAIM_WINDOW_DAYS = 3 * 365;

const COLUMNS = {
  merchant: ["שם בית העסק", "שם בית עסק", "בית עסק", "שם העסק", "בית העסק", "תיאור", "פירוט", "תיאור התנועה", "שם בית עסק / תיאור"],
  date: ["תאריך עסקה", "תאריך רכישה", "תאריך העסקה", "תאריך", "תאריך ערך"],
  // The full purchase amount comes first: installment rows also show a smaller monthly charge.
  amount: ["סכום עסקה", "סכום העסקה", "סכום עסקה מקורי", "סכום מקורי", "סכום", "סכום חיוב", "סכום החיוב", "חיוב", "סכום בש\"ח"],
  issuerCategory: ["קטגוריה", "ענף", "סוג בית עסק"],
} as const;

const norm = (s: string) => s.replace(/["'״׳`]/g, "").replace(/\s+/g, " ").trim();

function findColumns(row: Array<string | Date>): Partial<Record<keyof typeof COLUMNS, number>> | null {
  const cells = row.map((c) => norm(String(c)));
  const found: Partial<Record<keyof typeof COLUMNS, number>> = {};
  for (const [field, names] of Object.entries(COLUMNS) as Array<[keyof typeof COLUMNS, readonly string[]]>) {
    for (const name of names) {
      const i = cells.findIndex((c) => c === norm(name));
      if (i >= 0) {
        found[field] = i;
        break;
      }
    }
  }
  return found.merchant !== undefined && found.date !== undefined && found.amount !== undefined ? found : null;
}

export function parseAmount(v: string | Date | undefined): number | null {
  if (v === undefined || v instanceof Date) return null;
  const s = String(v).replace(/[₪\s,]/g, "").replace(/^(-?)\D*/, "$1");
  if (!s) return null;
  const n = Number(s.replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

/** Card company exports: one or more tables, each with a header row (Isracard, Cal, Max all name columns in Hebrew). */
export function tableToTransactions(table: Array<Array<string | Date>>): RawTransaction[] | null {
  const out: RawTransaction[] = [];
  let cols: Partial<Record<keyof typeof COLUMNS, number>> | null = null;
  let sawHeader = false;
  for (const row of table) {
    const header = findColumns(row);
    if (header) {
      cols = header;
      sawHeader = true;
      continue;
    }
    if (!cols) continue;
    const merchant = String(row[cols.merchant!] ?? "").trim();
    const rawDate = row[cols.date!];
    const date = rawDate instanceof Date ? rawDate.toISOString().slice(0, 10) : toIsoDate(String(rawDate ?? "").trim());
    const amount = parseAmount(row[cols.amount!]);
    if (!merchant || !date || amount === null) continue; // totals, sub-headers, blank rows
    out.push({
      merchant,
      date,
      amountIls: amount,
      issuerCategory: cols.issuerCategory !== undefined ? String(row[cols.issuerCategory] ?? "").trim() || null : null,
    });
  }
  return sawHeader ? out : null;
}

// ---------- which payments are medical, and what kind ----------

const RULES: Array<{ category: BenefitCategory; keys: string[] }> = [
  { category: "child_development", keys: ["ריפוי בעיסוק", "קלינאית תקשורת", "קלינאי תקשורת", "קלינאית", "התפתחות הילד", "מכון התפתחות"] },
  { category: "physiotherapy", keys: ["פיזיו", "physio", "הידרותרפיה"] },
  { category: "psychology", keys: ["פסיכולוג", "פסיכותרפ", "פסיכיאטר", "טיפול רגשי", "psycholog"] },
  { category: "diagnostic_imaging", keys: ["mri", "אם אר איי", "דימות", "רנטגן", "אולטרסאונד", "ממוגרפ", "סי טי", " ct "] },
  { category: "lab_tests", keys: ["מעבדה", "מעבדות", " lab "] },
  { category: "alternative_medicine", keys: ["כירופרקט", "דיקור", "רפואה סינית", "נטורופת", "הומאופת", "שיאצו", "רפלקסולוג", "אוסטאופת"] },
  { category: "glasses_lenses", keys: ["אופטיק", "משקפ", "עדשות", "optic", "אופטומטר"] },
  { category: "dental", keys: ["שיניים", "דנטל", "dental", "אורתודונט", "מרפאת שן"] },
  { category: "medical_devices", keys: ["מכשירי שמיעה", "מדרסים", "אביזרים רפואיים"] },
  { category: "specialist_visit", keys: ["דוקטור", "רופא", "מרפאת", "קליניק", "clinic", "אורתופד", "קרדיולוג", "גינקולוג", "נוירולוג", "אף אוזן גרון", "אנדוקרינולוג", "גסטרו", "אורולוג", "דרמטולוג", "medical", "מדיקל", "אסותא"] },
];
/** Not refundable as private care: pharmacies, the HMOs themselves (network co-pays), insurance premiums, gyms. */
const EXCLUDE = ["סופר פארם", "סופר-פארם", "ניו פארם", "בית מרקחת", "פארם", "כללית", "מכבי", "מאוחדת", "לאומית", "ביטוח", "כושר", "ספא"];

export function classifyMerchant(merchant: string, issuerCategory: string | null): { medical: boolean; category: BenefitCategory | null } {
  const m = ` ${merchant.toLowerCase()} `;
  if (EXCLUDE.some((x) => m.includes(x))) return { medical: false, category: null };
  // "ד"ר כהן" / "דר. לוי" as a word – not inside other words ("פיצה הדר").
  const doctor = /(^|\s)ד["״']?ר\.?(\s|$)/.test(merchant);
  for (const r of RULES) {
    if (r.category === "specialist_visit" && doctor) return { medical: true, category: r.category };
    if (r.keys.some((k) => m.includes(k.toLowerCase()))) return { medical: true, category: r.category };
  }
  if (issuerCategory && /רפוא|בריאות/.test(issuerCategory)) return { medical: true, category: null };
  return { medical: false, category: null };
}

// ---------- scan & save ----------

export async function scanStatement(deps: Deps, ctx: AuthContext, data: Buffer): Promise<StatementScanDto> {
  const kind = sniff(data);
  let source: StatementScanDto["source"] = "spreadsheet";
  let rows: RawTransaction[] | null;

  const viaAi = async (input: Parameters<Deps["statementReader"]["read"]>[0]) => {
    if (!(await hasConsent(deps.sql, ctx.userId, "ai_processing"))) {
      throw new AppError("consent_required", "כדי לקרוא PDF או צילום מסך צריך את הסכמתך לקריאה אוטומטית", { kind: "ai_processing" });
    }
    if (deps.statementReader.name === "manual") {
      throw new AppError("unsupported_media_type", "קריאה אוטומטית לא זמינה כרגע. הורידו את הפירוט כקובץ אקסל מאתר או מאפליקציית חברת האשראי");
    }
    source = "ai";
    return deps.statementReader.read(input);
  };

  if (kind === "xlsx" || kind === "csv") {
    let table: Array<Array<string | Date>>;
    try {
      table = kind === "xlsx" ? await readXlsx(data) : readCsv(data);
    } catch {
      throw new AppError("unsupported_media_type", "לא הצלחנו לפתוח את הקובץ. נסו להוריד אותו שוב");
    }
    rows = tableToTransactions(table);
    if (rows === null) {
      const text = table
        .slice(0, 600)
        .map((r) => r.map((c) => (c instanceof Date ? c.toISOString().slice(0, 10) : c)).join(" | "))
        .join("\n");
      rows = await viaAi({ kind: "text", text });
    }
  } else if (kind === "xls") {
    throw new AppError("unsupported_media_type", "זה קובץ אקסל בפורמט ישן (xls). שמרו אותו כ-xlsx, או העלו PDF של הפירוט");
  } else if (kind === "pdf" || kind.startsWith("image/")) {
    rows = await viaAi({ kind: "file", data, mimeType: kind as "application/pdf" | "image/jpeg" | "image/png" | "image/webp" });
  } else {
    throw new AppError("unsupported_media_type", "אפשר להעלות את פירוט החיובים כקובץ אקסל, CSV, PDF או צילום מסך");
  }

  const now = deps.now();
  const oldest = new Date(now.getTime() - CLAIM_WINDOW_DAYS * 86_400_000).toISOString().slice(0, 10);
  const receipts = await deps.sql`
    SELECT amount_agorot, service_date::text AS service_date FROM receipts
    WHERE household_id = ${ctx.householdId} AND deleted_at IS NULL AND amount_agorot IS NOT NULL AND service_date IS NOT NULL`;
  const saved = await deps.sql`
    SELECT merchant, paid_on::text AS paid_on, amount_agorot FROM payment_leads WHERE household_id = ${ctx.householdId}`;
  const self = (await listMembers(deps.sql, ctx.householdId)).find((m) => m.relation === "self");

  const candidates: StatementCandidateDto[] = [];
  for (const [i, t] of rows.entries()) {
    if (!t.date || t.amountIls === null || t.amountIls <= 0 || t.date < oldest) continue;
    const c = classifyMerchant(t.merchant, t.issuerCategory);
    if (!c.medical) continue;
    const payment = { amountAgorot: Math.round(t.amountIls * 100), date: t.date };
    let estimate: number | null = null;
    if (c.category && self) {
      const { routing } = await routeForMember(deps.sql, {
        memberId: self.id,
        birthDate: self.birthDate,
        category: c.category,
        amountAgorot: payment.amountAgorot,
        sessions: 1,
        serviceDate: payment.date,
      });
      estimate = routing.totalExpectedAgorot;
    }
    candidates.push({
      key: String(i),
      merchant: t.merchant,
      date: payment.date,
      amountAgorot: payment.amountAgorot,
      category: c.category,
      categoryLabel: c.category ? CATEGORY_INFO[c.category].label : null,
      hasReceipt: receipts.some((r) =>
        samePayment(payment, { amountAgorot: r.amountAgorot as number, date: r.serviceDate as string }),
      ),
      alreadySaved: saved.some(
        (s) => s.merchant === t.merchant && s.paidOn === payment.date && (s.amountAgorot as number) === payment.amountAgorot,
      ),
      estimatedRefundAgorot: estimate,
    });
  }
  candidates.sort((a, b) => Number(a.hasReceipt) - Number(b.hasReceipt) || b.date.localeCompare(a.date));

  const notes: string[] = [];
  if (rows.length === 0) notes.push("לא מצאנו עסקאות בקובץ. ודאו שזה פירוט החיובים, או נסו קובץ אחר.");
  else if (candidates.length === 0) notes.push("לא מצאנו תשלומים רפואיים בתקופה הזו. 🎉");

  await audit(deps.sql, {
    actorUserId: ctx.userId,
    actorKind: "user",
    action: "card_statement_scanned",
    entity: "household",
    entityId: ctx.householdId,
    meta: { source, rows: rows.length, medical: candidates.length },
  });
  return { source, rowsScanned: rows.length, candidates, notes };
}

export async function savePaymentLeads(
  deps: Deps,
  ctx: AuthContext,
  items: Array<{ merchant: string; date: string; amountAgorot: number; category: BenefitCategory | null }>,
): Promise<{ saved: number }> {
  let saved = 0;
  for (const item of items) {
    const [row] = await deps.sql`
      INSERT INTO payment_leads (household_id, merchant, paid_on, amount_agorot, category)
      VALUES (${ctx.householdId}, ${item.merchant}, ${item.date}, ${item.amountAgorot}, ${item.category})
      ON CONFLICT (household_id, merchant, paid_on, amount_agorot) DO UPDATE SET status = 'open'
      RETURNING id`;
    if (row) saved++;
  }
  return { saved };
}

export async function dismissPaymentLead(deps: Deps, ctx: AuthContext, id: string): Promise<void> {
  const [row] = await deps.sql`
    UPDATE payment_leads SET status = 'dismissed' WHERE id = ${id} AND household_id = ${ctx.householdId} RETURNING id`;
  if (!row) throw notFound("התשלום");
}
