import ExcelJS from "exceljs";
import type { ImportedPolicyDto, PolicyImportPreviewDto, PolicyRelevance } from "@magiali/shared";
import type { AuthContext, Deps } from "../context";
import { AppError } from "../errors";
import type { RawPolicy } from "../policy-reader";
import { audit } from "./audit";
import { hasConsent } from "./consents";
import { getMemberForHousehold } from "./households";

/**
 * "Import from Har HaBituach": the user downloads their own policy report from the Finance Ministry's site
 * (harb.cma.gov.il) and uploads it. We never log in on their behalf. The file is read in memory and discarded.
 */
export const HAR_HABITUACH_URL = "https://harb.cma.gov.il/";

type Sniffed = "xlsx" | "xls" | "csv" | "pdf" | "image/jpeg" | "image/png" | "image/webp" | "unknown";

/** Decides by content, not by the (often missing or generic) mime type the phone sends. */
export function sniff(data: Buffer): Sniffed {
  const head = data.subarray(0, 8);
  if (head.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))) return "xlsx";
  if (head.equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]))) return "xls";
  if (head.subarray(0, 4).toString("latin1") === "%PDF") return "pdf";
  if (head[0] === 0xff && head[1] === 0xd8) return "image/jpeg";
  if (head.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]))) return "image/png";
  if (head.subarray(0, 4).toString("latin1") === "RIFF" && data.subarray(8, 12).toString("latin1") === "WEBP") return "image/webp";
  const sample = data.subarray(0, 4096).toString("utf8");
  if (!sample.includes("\u0000") && /[,;\t]/.test(sample)) return "csv";
  return "unknown";
}

// ---------- spreadsheet → rows ----------

/** Header synonyms seen on Har HaBituach and insurers' reports. Matched after normalising spaces and quotes. */
const COLUMNS: Record<keyof RawPolicy | "period", string[]> = {
  insurer: ["חברה", "חברת ביטוח", "שם חברה", "חברה מנהלת", "גוף מוסדי", "מבטח"],
  mainBranch: ["ענף ראשי", "ענף", "תחום", "תחום ראשי", "סוג ביטוח"],
  subBranch: ["ענף משני", "ענף (משני)", "תחום משני", "כיסוי", "סוג כיסוי"],
  product: ["סוג מוצר", "שם מוצר", "מוצר", "שם תכנית", "שם התכנית", "תכנית", "פרטים נוספים", "שם פוליסה"],
  productType: ["סיווג תכנית", "סוג פוליסה", "פרט/קבוצתי", "סוג תכנית", "קולקטיב"],
  policyNumber: ["מספר פוליסה", "מס' פוליסה", "מס פוליסה", "פוליסה"],
  period: ["תקופת ביטוח", "תקופת הביטוח", "תקופה"],
  startDate: ["תאריך תחילה", "תחילת ביטוח", "תאריך תחילת ביטוח", "מתאריך"],
  endDate: ["תאריך סיום", "סיום ביטוח", "תאריך סיום ביטוח", "עד תאריך"],
  insuredName: ["שם המבוטח", "מבוטח", "שם מבוטח"],
};

const norm = (s: string) =>
  s
    .replace(/[֑-ׇ]/g, "")
    .replace(/["'״׳`]/g, "")
    .replace(/\s+/g, " ")
    .trim();

function headerField(cell: string): keyof typeof COLUMNS | null {
  const c = norm(cell);
  if (!c) return null;
  // Exact synonyms first, then "contains" (e.g. "ענף ראשי *").
  for (const [field, names] of Object.entries(COLUMNS)) if (names.some((n) => norm(n) === c)) return field as keyof typeof COLUMNS;
  for (const [field, names] of Object.entries(COLUMNS)) if (names.some((n) => c.includes(norm(n)) && norm(n).length >= 4)) return field as keyof typeof COLUMNS;
  return null;
}

/** dd/mm/yyyy, dd.mm.yy, yyyy-mm-dd, Excel dates → yyyy-mm-dd. */
export function toIsoDate(value: unknown): string | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  const s = String(value ?? "").trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/);
  if (m) {
    const year = m[3]!.length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    return `${year}-${m[2]!.padStart(2, "0")}-${m[1]!.padStart(2, "0")}`;
  }
  return null;
}

function splitPeriod(value: string): { startDate: string | null; endDate: string | null } {
  const dates = value.match(/\d{1,4}[./-]\d{1,2}[./-]\d{2,4}/g) ?? [];
  return { startDate: toIsoDate(dates[0]), endDate: toIsoDate(dates[1]) };
}

function cellText(v: ExcelJS.CellValue): string | Date {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v;
  if (typeof v === "object") {
    if ("richText" in v) return v.richText.map((r) => r.text).join("");
    if ("text" in v) return String(v.text);
    if ("result" in v) return v.result instanceof Date ? v.result : String(v.result ?? "");
  }
  return String(v);
}

/** Finds the header row (the first row naming at least two known columns) and maps the rows below it. */
export function rowsToPolicies(table: Array<Array<string | Date>>): RawPolicy[] | null {
  const headerIndex = table.findIndex((row) => new Set(row.map((c) => headerField(String(c))).filter(Boolean)).size >= 2);
  if (headerIndex < 0) return null;
  const fields = table[headerIndex]!.map((c) => headerField(String(c)));
  const policies: RawPolicy[] = [];
  for (const row of table.slice(headerIndex + 1)) {
    const raw: Record<string, string | Date> = {};
    fields.forEach((f, i) => {
      if (f && row[i] !== undefined && raw[f] === undefined) raw[f] = row[i]!;
    });
    const text = (k: string) => {
      const v = raw[k];
      const t = v instanceof Date ? "" : String(v ?? "").trim();
      return t || null;
    };
    if (!text("insurer") && !text("mainBranch") && !text("policyNumber")) continue; // blank or totals row
    const period = text("period") ? splitPeriod(text("period")!) : { startDate: null, endDate: null };
    policies.push({
      insurer: text("insurer"),
      mainBranch: text("mainBranch"),
      subBranch: text("subBranch"),
      product: text("product"),
      productType: text("productType"),
      policyNumber: text("policyNumber"),
      startDate: toIsoDate(raw.startDate) ?? period.startDate,
      endDate: toIsoDate(raw.endDate) ?? period.endDate,
      insuredName: text("insuredName"),
    });
  }
  return policies;
}

export async function readXlsx(data: Buffer): Promise<Array<Array<string | Date>>> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(data as unknown as ArrayBuffer);
  const table: Array<Array<string | Date>> = [];
  // All sheets: some reports split health / life into tabs.
  wb.eachSheet((sheet) => {
    sheet.eachRow({ includeEmpty: false }, (row) => {
      const values = (row.values as ExcelJS.CellValue[]).slice(1).map(cellText);
      table.push(values);
    });
  });
  return table;
}

export function readCsv(data: Buffer): Array<Array<string>> {
  let text = data.toString("utf8").replace(/^﻿/, "");
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  const sep = [";", "\t", ","].sort((a, b) => firstLine.split(b).length - firstLine.split(a).length)[0]!;
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  text += "\n";
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === sep) {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      if (row.some((c) => c.trim())) rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  return rows;
}

// ---------- interpretation ----------

const INSURERS: Array<{ id: string; keys: string[] }> = [
  { id: "harel", keys: ["הראל"] },
  { id: "clal", keys: ["כלל"] },
  { id: "phoenix", keys: ["הפניקס", "פניקס"] },
  { id: "migdal", keys: ["מגדל"] },
  { id: "menora", keys: ["מנורה"] },
  { id: "ayalon", keys: ["איילון", "אילון"] },
  { id: "hachshara", keys: ["הכשרה"] },
];

const RELEVANT = ["אמבולטור", "ייעוץ", "יעוץ", "בדיקות", "רפואה משלימה", "התפתחות", "ילד", "שירותים רפואיים", "שירותים אמבולטוריים", "שיניים", "רופא מומחה", "חוות דעת"];
const NOT_FOR_RECEIPTS: Array<{ keys: string[]; reason: string }> = [
  { keys: ["ניתוח", "השתל"], reason: "ניתוחים והשתלות – לא החזר על קבלות רגילות" },
  { keys: ["תרופ"], reason: "תרופות מחוץ לסל – דורש תהליך נפרד" },
  { keys: ["מחלות קשות", "מחלה קשה", "סרטן"], reason: "מחלות קשות – תשלום חד-פעמי, לא החזר על קבלות" },
  { keys: ["סיעוד"], reason: "ביטוח סיעודי – לא החזר על קבלות רגילות" },
  { keys: ["אובדן כושר", "א.כ.ע"], reason: "אובדן כושר עבודה – לא רלוונטי" },
  { keys: ["תאונ"], reason: "תאונות אישיות – לא רלוונטי לקבלות רגילות" },
  { keys: ["נסיעות", "חוץ לארץ"], reason: "ביטוח נסיעות לחו״ל – לא רלוונטי" },
];
const NOT_HEALTH = ["חיים", "ריסק", "משכנתא", "רכב", "דירה", "מבנה", "תכולה", "חיסכון", "פנסיה", "גמל", "השתלמות"];

const has = (text: string, keys: string[]) => keys.some((k) => text.includes(k));

export function classify(p: RawPolicy): { relevance: PolicyRelevance; reason: string } {
  const all = norm([p.mainBranch, p.subBranch, p.product].filter(Boolean).join(" "));
  const health = /בריאות|רפוא|אמבולטור/.test(all);
  if (has(all, RELEVANT)) return { relevance: "relevant", reason: "מחזיר כסף על קבלות של רופאים, טיפולים ובדיקות" };
  for (const n of NOT_FOR_RECEIPTS) if (has(all, n.keys)) return { relevance: "not_relevant", reason: n.reason };
  if (!health && has(all, NOT_HEALTH)) return { relevance: "not_relevant", reason: "לא ביטוח בריאות" };
  if (health) return { relevance: "maybe", reason: "ביטוח בריאות – לא בטוח שהוא מחזיר על קבלות. בדוק בפוליסה" };
  return { relevance: "not_relevant", reason: "לא זיהינו ביטוח בריאות" };
}

export function insurerId(name: string | null): string | null {
  if (!name) return null;
  const n = norm(name);
  return INSURERS.find((i) => has(n, i.keys))?.id ?? null;
}

const isGroup = (p: RawPolicy) => /קבוצ|קולקטיב|מעסיק/.test(norm([p.productType, p.product].filter(Boolean).join(" ")));

/** Picks the catalog plan for a relevant policy. Product names vary by edition, so only "likely" at best. */
export function matchPlanId(p: RawPolicy): { planId: string; confidence: "exact" | "likely" | "generic" } | null {
  const payer = insurerId(p.insurer);
  if (!payer) return null;
  if (isGroup(p)) return { planId: `group_${payer}`, confidence: "generic" };
  const text = norm([p.subBranch, p.product].filter(Boolean).join(" "));
  const child = /ילד|התפתחות/.test(text);
  const complementary = text.includes("רפואה משלימה");
  const consult = /אמבולטור|ייעוץ|יעוץ|בדיקות|שירותים/.test(text);
  const byPayer: Record<string, { child?: string; complementary?: string; consult?: string }> = {
    harel: { child: "harel_child_521", consult: "harel_consult_527" },
    clal: { child: "clal_child_3061", consult: "clal_consult_4065" },
    phoenix: { consult: "phoenix_consult_6782" },
    migdal: { complementary: "migdal_complementary", consult: "migdal_consult_2395" },
  };
  const known = byPayer[payer] ?? {};
  const code = /\b(527|521|4065|3061|6782|2395|2386)\b/.exec(text)?.[1];
  if (child && known.child) return { planId: known.child, confidence: code ? "exact" : "likely" };
  if (complementary && known.complementary) return { planId: known.complementary, confidence: code ? "exact" : "likely" };
  if (consult && known.consult) return { planId: known.consult, confidence: code ? "exact" : "likely" };
  return { planId: `${payer}_health`, confidence: "generic" };
}

// ---------- preview & apply ----------

export async function previewPolicyImport(deps: Deps, ctx: AuthContext, data: Buffer): Promise<PolicyImportPreviewDto> {
  const kind = sniff(data);
  const notes: string[] = [];
  let raw: RawPolicy[] | null = null;
  let source: PolicyImportPreviewDto["source"] = "spreadsheet";

  const viaAi = async (input: Parameters<Deps["policyReader"]["read"]>[0]) => {
    if (!(await hasConsent(deps.sql, ctx.userId, "ai_processing"))) {
      throw new AppError("consent_required", "כדי לקרוא צילום מסך או PDF צריך את הסכמתך לקריאה אוטומטית", { kind: "ai_processing" });
    }
    if (deps.policyReader.name === "manual") {
      throw new AppError("unsupported_media_type", "קריאה אוטומטית לא זמינה כרגע. העלה את קובץ האקסל מהר הביטוח, או בחר את הביטוחים ידנית");
    }
    source = "ai";
    return deps.policyReader.read(input);
  };

  if (kind === "xlsx" || kind === "csv") {
    let table: Array<Array<string | Date>>;
    try {
      table = kind === "xlsx" ? await readXlsx(data) : readCsv(data);
    } catch {
      throw new AppError("unsupported_media_type", "לא הצלחנו לפתוח את הקובץ. נסה להוריד אותו שוב מהר הביטוח");
    }
    raw = rowsToPolicies(table);
    if (raw === null) {
      // A table we don't recognise: let the AI read it as text (only with consent).
      const text = table
        .slice(0, 200)
        .map((r) => r.map((c) => (c instanceof Date ? c.toISOString().slice(0, 10) : c)).join(" | "))
        .join("\n");
      raw = await viaAi({ kind: "text", text });
    }
  } else if (kind === "xls") {
    throw new AppError("unsupported_media_type", "זה קובץ אקסל בפורמט ישן (xls). שמור אותו כ-xlsx, או העלה צילום מסך של הרשימה");
  } else if (kind === "pdf" || kind.startsWith("image/")) {
    raw = await viaAi({ kind: "file", data, mimeType: kind as "application/pdf" | "image/jpeg" | "image/png" | "image/webp" });
  } else {
    throw new AppError("unsupported_media_type", "אפשר להעלות את קובץ האקסל מהר הביטוח, PDF או צילום מסך");
  }

  if (raw.length === 0) notes.push("לא מצאנו פוליסות בקובץ. ודא שזה הדוח מהר הביטוח, או בחר את הביטוחים ידנית.");

  const planIds = [...new Set(raw.map(matchPlanId).filter(Boolean).map((m) => m!.planId))];
  const plans = planIds.length
    ? await deps.sql`SELECT id, name_he FROM plans WHERE id IN ${deps.sql(planIds)} AND active`
    : [];
  const planName = new Map(plans.map((p) => [p.id as string, p.nameHe as string]));
  const enrolled = new Set(
    (
      await deps.sql`
        SELECT DISTINCT e.plan_id FROM enrollments e JOIN members m ON m.id = e.member_id
        WHERE m.household_id = ${ctx.householdId} AND m.deleted_at IS NULL`
    ).map((r) => r.planId as string),
  );

  const policies: ImportedPolicyDto[] = raw.map((p, i) => {
    const c = classify(p);
    const m = c.relevance === "not_relevant" ? null : matchPlanId(p);
    const name = m ? planName.get(m.planId) : undefined;
    if (c.relevance !== "not_relevant" && p.insurer && !insurerId(p.insurer)) {
      notes.push(`את ${p.insurer} עוד אין אצלנו ברשימה – אפשר להוסיף ידנית כ״ביטוח קבוצתי״ או לפנות אלינו`);
    }
    return {
      key: String(i),
      insurer: p.insurer,
      branch: [p.mainBranch, p.subBranch].filter(Boolean).join(" · ") || null,
      product: p.product,
      isGroup: isGroup(p),
      policyNumber: p.policyNumber,
      startDate: p.startDate,
      endDate: p.endDate,
      insuredName: p.insuredName,
      relevance: c.relevance,
      reason: c.reason,
      match: m && name ? { planId: m.planId, planName: name, confidence: m.confidence } : null,
      alreadyEnrolled: !!m && enrolled.has(m.planId),
    };
  });

  await audit(deps.sql, {
    actorUserId: ctx.userId,
    actorKind: "user",
    action: "policy_report_read",
    entity: "household",
    entityId: ctx.householdId,
    meta: { source, rows: policies.length },
  });
  return { source, policies, notes: [...new Set(notes)] };
}

/** Adds the confirmed policies to the chosen family members. Existing enrollments are updated, never removed. */
export async function applyPolicyImport(
  deps: Deps,
  ctx: AuthContext,
  input: { memberIds: string[]; items: Array<{ planId: string; policyNumber?: string | null; startDate?: string | null; endDate?: string | null }> },
): Promise<{ added: number; updated: number }> {
  for (const memberId of input.memberIds) await getMemberForHousehold(deps.sql, ctx.householdId, memberId);
  const planIds = [...new Set(input.items.map((i) => i.planId))];
  const plans = await deps.sql`SELECT id, plan_kind FROM plans WHERE id IN ${deps.sql(planIds)} AND active`;
  const kinds = new Map(plans.map((p) => [p.id as string, p.planKind as string]));
  for (const id of planIds) {
    if (!kinds.has(id)) throw new AppError("validation_error", "ביטוח לא מוכר");
    if (kinds.get(id) === "shaban") throw new AppError("validation_error", "את השב״ן בוחרים במסך הכיסויים (הוא לא מופיע בהר הביטוח)");
  }

  let added = 0;
  let updated = 0;
  await deps.sql.begin(async (tx) => {
    for (const memberId of input.memberIds) {
      for (const item of input.items) {
        const [row] = await tx`
          INSERT INTO enrollments (member_id, plan_id, is_shaban_supplement, policy_number_enc, source, valid_from, valid_to)
          VALUES (${memberId}, ${item.planId}, false,
                  ${item.policyNumber ? deps.crypto.encryptString(item.policyNumber) : null}, 'har_habituach',
                  ${item.startDate ?? "2000-01-01"}, ${item.endDate ?? null})
          ON CONFLICT (member_id, plan_id) DO UPDATE SET
            policy_number_enc = COALESCE(EXCLUDED.policy_number_enc, enrollments.policy_number_enc),
            source = 'har_habituach',
            valid_from = CASE WHEN ${item.startDate ?? null}::date IS NULL THEN enrollments.valid_from ELSE EXCLUDED.valid_from END,
            valid_to = CASE WHEN ${item.endDate ?? null}::date IS NULL THEN enrollments.valid_to ELSE EXCLUDED.valid_to END
          RETURNING (xmax = 0) AS inserted`;
        if (row?.inserted) added++;
        else updated++;
      }
    }
  });
  await audit(deps.sql, {
    actorUserId: ctx.userId,
    actorKind: "user",
    action: "policies_imported",
    entity: "household",
    entityId: ctx.householdId,
    meta: { added, updated, plans: planIds },
  });
  return { added, updated };
}
