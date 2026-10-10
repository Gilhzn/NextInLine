import { afterAll, beforeAll, describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { classify, matchPlanId, readCsv, rowsToPolicies, sniff, toIsoDate } from "../src/services/policy-import";
import { api, createTestEnv, expectStatus, fakeImage, login, type TestEnv } from "./helpers";

/** A report shaped like the Har HaBituach export: a title, then the table. */
async function harHabituachXlsx(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet("פוליסות");
  sheet.addRow(["הר הביטוח – ריכוז פוליסות"]);
  sheet.addRow(["תאריך הפקה: 10/10/2026"]);
  sheet.addRow([]);
  sheet.addRow(["ענף ראשי", "ענף (משני)", "סוג מוצר", "חברה", "תקופת ביטוח", "פרמיה בש\"ח", "מספר פוליסה", "סיווג תכנית"]);
  sheet.addRow(["ביטוח בריאות", "אמבולטורי", "ייעוץ ובדיקות", "הראל חברה לביטוח בע\"מ", "01/03/2021 - ", "54.20", "800123456", "פרט"]);
  sheet.addRow(["ביטוח בריאות", "ניתוחים בארץ", "ניתוחים והתייעצויות", "הראל חברה לביטוח בע\"מ", "01/03/2021 - ", "88.10", "800123457", "פרט"]);
  sheet.addRow(["ביטוח בריאות", "אמבולטורי", "ביטוח בריאות קבוצתי", "כלל חברה לביטוח בע\"מ", "01/01/2024 - 31/12/2026", "0", "G-55501", "קבוצתי"]);
  sheet.addRow(["ביטוח בריאות", "כתב שירות", "שירותים לילד", "מנורה מבטחים ביטוח", "15.06.2022 - ", "19.90", "M-777", "פרט"]);
  sheet.addRow(["ביטוח חיים", "ריסק", "ריסק טהור", "מגדל חברה לביטוח", "01/01/2019 - ", "120", "R-1", "פרט"]);
  sheet.addRow(["ביטוח בריאות", "אמבולטורי", "אמבולטורי פלוס", "ביטוח ישיר", "01/01/2025 - ", "30", "D-9", "פרט"]);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

describe("reading the report", () => {
  it("recognises file types by content", async () => {
    expect(sniff(await harHabituachXlsx())).toBe("xlsx");
    expect(sniff(Buffer.from("%PDF-1.7 ..."))).toBe("pdf");
    expect(sniff(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0]))).toBe("xls");
    expect(sniff(Buffer.from("חברה,ענף ראשי\nהראל,בריאות\n"))).toBe("csv");
  });

  it("parses Israeli dates and periods", () => {
    expect(toIsoDate("01/03/2021")).toBe("2021-03-01");
    expect(toIsoDate("15.6.22")).toBe("2022-06-15");
    expect(toIsoDate("2026-12-31")).toBe("2026-12-31");
    expect(toIsoDate("")).toBeNull();
  });

  it("finds the header row and maps columns, including CSV with quotes", () => {
    const rows = readCsv(Buffer.from('﻿כותרת\nחברה;ענף ראשי;ענף משני;מספר פוליסה;תקופת ביטוח\n"הראל; בע""מ";ביטוח בריאות;אמבולטורי;123;01/01/2020 - 31/12/2026\n'));
    const policies = rowsToPolicies(rows)!;
    expect(policies).toEqual([
      expect.objectContaining({ insurer: 'הראל; בע"מ', mainBranch: "ביטוח בריאות", subBranch: "אמבולטורי", policyNumber: "123", startDate: "2020-01-01", endDate: "2026-12-31" }),
    ]);
    expect(rowsToPolicies([["a", "b"], ["c", "d"]])).toBeNull();
  });

  it("keeps policies that refund receipts and explains the rest", () => {
    const base = { insurer: "הראל", product: null, productType: null, policyNumber: null, startDate: null, endDate: null, insuredName: null };
    expect(classify({ ...base, mainBranch: "ביטוח בריאות", subBranch: "אמבולטורי" }).relevance).toBe("relevant");
    expect(classify({ ...base, mainBranch: "ביטוח בריאות", subBranch: "תרופות מחוץ לסל" })).toMatchObject({ relevance: "not_relevant" });
    expect(classify({ ...base, mainBranch: "ביטוח סיעודי", subBranch: "סיעוד" }).relevance).toBe("not_relevant");
    expect(classify({ ...base, mainBranch: "ביטוח בריאות", subBranch: "כתב שירות" }).relevance).toBe("maybe");
    expect(classify({ ...base, mainBranch: "ביטוח חיים", subBranch: "ריסק" }).relevance).toBe("not_relevant");
  });

  it("matches insurer and product to the catalog", () => {
    const base = { mainBranch: "ביטוח בריאות", productType: null, policyNumber: null, startDate: null, endDate: null, insuredName: null };
    expect(matchPlanId({ ...base, insurer: "הראל חברה לביטוח", subBranch: "אמבולטורי", product: "ייעוץ ובדיקות" })).toEqual({ planId: "harel_consult_527", confidence: "likely" });
    expect(matchPlanId({ ...base, insurer: "הראל", subBranch: "אמבולטורי", product: "תכנית 521 התפתחות הילד" })).toEqual({ planId: "harel_child_521", confidence: "exact" });
    expect(matchPlanId({ ...base, insurer: "הפניקס", subBranch: "שירותים", product: null, productType: "קולקטיב" })).toEqual({ planId: "group_phoenix", confidence: "generic" });
    expect(matchPlanId({ ...base, insurer: "איילון", subBranch: "אמבולטורי", product: null })).toEqual({ planId: "ayalon_health", confidence: "generic" });
    expect(matchPlanId({ ...base, insurer: "ביטוח ישיר", subBranch: "אמבולטורי", product: null })).toBeNull();
  });
});

let env: TestEnv;

beforeAll(async () => {
  env = await createTestEnv();
});

afterAll(async () => {
  await env.close();
});

describe("import from Har HaBituach", () => {
  it("previews the Excel report without saving anything, then adds what the user confirmed", async () => {
    const s = await login(env, "0521230001");
    const user = api(env, s.token);
    const selfId = s.me.members[0].id;
    const child = expectStatus(
      await user.post("/v1/members", { fullName: "תמר", relation: "child", birthDate: "2019-02-02", guardianDeclared: true }),
      201,
    );

    const preview = expectStatus(
      await user.upload("/v1/coverage/import", {
        data: await harHabituachXlsx(),
        mimeType: "application/octet-stream",
        filename: "har-habituach.xlsx",
      }),
      200,
    );
    expect(preview.source).toBe("spreadsheet");
    const byNumber = Object.fromEntries(preview.policies.map((p: any) => [p.policyNumber, p]));
    expect(byNumber["800123456"]).toMatchObject({
      relevance: "relevant",
      startDate: "2021-03-01",
      match: { planId: "harel_consult_527", confidence: "likely" },
    });
    expect(byNumber["800123457"]).toMatchObject({ relevance: "not_relevant", match: null });
    expect(byNumber["G-55501"]).toMatchObject({ isGroup: true, endDate: "2026-12-31", match: { planId: "group_clal" } });
    expect(byNumber["M-777"]).toMatchObject({ relevance: "relevant", match: { planId: "menora_health", confidence: "generic" } });
    expect(byNumber["R-1"]).toMatchObject({ relevance: "not_relevant" });
    expect(byNumber["D-9"]).toMatchObject({ relevance: "relevant", match: null });
    expect(preview.notes.join(" ")).toContain("ביטוח ישיר");

    // Nothing was stored by the preview.
    expect(expectStatus(await user.get(`/v1/members/${selfId}/enrollments`), 200)).toHaveLength(0);

    const applied = expectStatus(
      await user.post("/v1/coverage/import/apply", {
        memberIds: [selfId, child.id],
        items: [
          { planId: "harel_consult_527", policyNumber: "800123456", startDate: "2021-03-01" },
          { planId: "group_clal", policyNumber: "G-55501", startDate: "2024-01-01", endDate: "2026-12-31" },
        ],
      }),
      200,
    );
    expect(applied).toEqual({ added: 4, updated: 0 });
    const enrolled = expectStatus(await user.get(`/v1/members/${child.id}/enrollments`), 200);
    expect(enrolled.map((e: any) => e.planId).sort()).toEqual(["group_clal", "harel_consult_527"]);
    const [row] = await env.sql`SELECT source, policy_number_enc, valid_to FROM enrollments WHERE member_id = ${selfId} AND plan_id = 'group_clal'`;
    expect(row).toMatchObject({ source: "har_habituach", validTo: "2026-12-31" });
    expect(row!.policyNumberEnc).not.toContain("G-55501");

    // Importing again updates instead of duplicating; the next preview says it's already there.
    const again = expectStatus(
      await user.post("/v1/coverage/import/apply", { memberIds: [selfId], items: [{ planId: "harel_consult_527" }] }),
      200,
    );
    expect(again).toEqual({ added: 0, updated: 1 });
    const second = expectStatus(
      await user.upload("/v1/coverage/import", { data: await harHabituachXlsx(), mimeType: "application/octet-stream" }),
      200,
    );
    expect(second.policies.find((p: any) => p.policyNumber === "800123456").alreadyEnrolled).toBe(true);
  });

  it("reads a screenshot only with the AI consent", async () => {
    const s = await login(env, "0521230002", { consents: ["terms", "privacy", "medical_data"] });
    const user = api(env, s.token);
    env.policyReader.next = [
      { insurer: "מגדל", mainBranch: "ביטוח בריאות", subBranch: "רפואה משלימה", product: null, productType: "פרט", policyNumber: "77", startDate: "2023-01-01", endDate: null, insuredName: null },
    ];
    const denied = await user.upload("/v1/coverage/import", { data: fakeImage("screenshot"), mimeType: "image/png" });
    expect(denied.statusCode).toBe(403);
    expect(denied.json().error.details).toEqual({ kind: "ai_processing" });
    expect(env.policyReader.calls).toBe(0);

    expectStatus(await user.post("/v1/consents", { kind: "ai_processing", version: "2026-10" }), 200);
    const preview = expectStatus(await user.upload("/v1/coverage/import", { data: fakeImage("screenshot"), mimeType: "image/png" }), 200);
    expect(preview.source).toBe("ai");
    expect(preview.policies[0]).toMatchObject({ relevance: "relevant", match: { planId: "migdal_complementary" } });
  });

  it("refuses the old xls format, the shaban, and other households' members", async () => {
    const s = await login(env, "0521230003");
    const user = api(env, s.token);
    const xls = await user.upload("/v1/coverage/import", {
      data: Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 1, 2, 3]),
      mimeType: "application/vnd.ms-excel",
    });
    expect(xls.statusCode).toBe(415);
    expect(xls.json().error.message).toContain("xlsx");

    const selfId = s.me.members[0].id;
    expectStatus(await user.post("/v1/coverage/import/apply", { memberIds: [selfId], items: [{ planId: "maccabi_sheli" }] }), 400);

    const other = await login(env, "0521230004");
    expectStatus(
      await api(env, other.token).post("/v1/coverage/import/apply", { memberIds: [selfId], items: [{ planId: "harel_consult_527" }] }),
      404,
    );
  });
});
