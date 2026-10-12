import { afterAll, beforeAll, describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { classifyMerchant, parseAmount, tableToTransactions } from "../src/services/card-scan";
import { api, createTestEnv, expectStatus, fakeImage, login, type TestEnv } from "./helpers";

let env: TestEnv;

beforeAll(async () => {
  env = await createTestEnv();
});

afterAll(async () => {
  await env.close();
});

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

async function receipt(user: ReturnType<typeof api>, memberId: string, r: { category: string; amount: number; date: string; provider: string }) {
  const up = expectStatus(await user.upload("/v1/receipts", { data: fakeImage(`${r.provider}${r.date}${r.amount}`), mimeType: "image/png" }), 201);
  await env.runJobs();
  expectStatus(
    await user.patch(`/v1/receipts/${up.id}`, {
      memberId,
      category: r.category,
      providerName: r.provider,
      serviceDate: r.date,
      amountAgorot: r.amount,
      sessions: 1,
    }),
    200,
  );
  return up.id as string;
}

describe("our health money", () => {
  it("shows what we paid and got back, what we missed, what's on its way and where we can save", async () => {
    const s = await login(env, "0541230001");
    const user = api(env, s.token);
    const selfId = s.me.members[0].id;
    expectStatus(await user.patch(`/v1/members/${selfId}`, { birthDate: "1985-01-01" }), 200);
    expectStatus(await user.put(`/v1/members/${selfId}/enrollments`, { enrollments: [{ planId: "maccabi_sheli" }] }), 200);
    const thisYear = `${new Date().getUTCFullYear()}-01-15`;

    // Unclaimed specialist visit (fixture: 50% up to ₪250).
    const specialistReceipt = await receipt(user, selfId, { category: "specialist_visit", amount: 65000, date: thisYear, provider: "ד״ר לוי" });
    // A receipt about to pass the 3-year limit.
    await receipt(user, selfId, { category: "specialist_visit", amount: 40000, date: daysAgo(3 * 365 - 20), provider: "ד״ר ישן" });
    // Dental – not covered at all.
    await receipt(user, selfId, { category: "dental", amount: 80000, date: thisYear, provider: "מרפאת שיניים" });
    // A photo still waiting for details.
    expectStatus(await user.upload("/v1/receipts", { data: fakeImage("no-details"), mimeType: "image/png" }), 201);
    await env.sql`UPDATE receipts SET extraction_status = 'manual' WHERE confirmed_at IS NULL`;
    // A physio claim on its way (fixture: ₪60 fixed per session).
    const physio = await receipt(user, selfId, { category: "physiotherapy", amount: 25000, date: thisYear, provider: "פיזיו פלוס" });
    const claim = expectStatus(await user.post("/v1/claims", { receiptIds: [physio] }), 201);
    expectStatus(await user.post(`/v1/claims/${claim.id}/submit`), 200);

    const money = expectStatus(await user.get("/v1/money"), 200);
    expect(money.range).toBe("year");
    expect(money.paidAgorot).toBe(65000 + 80000 + 25000);

    const unclaimed = money.missed.items.filter((i: any) => i.kind === "unclaimed_receipt");
    expect(unclaimed[0]).toMatchObject({ urgent: true, amountAgorot: 20000 }); // the old one first: about to expire
    expect(unclaimed[0].detail).toContain("נשארו");
    expect(unclaimed.find((i: any) => i.action.id === specialistReceipt)).toMatchObject({ amountAgorot: 25000, urgent: false });
    expect(money.missed.items.some((i: any) => i.kind === "receipt_needs_details")).toBe(true);

    expect(money.waiting.items).toEqual([expect.objectContaining({ amountAgorot: 6000, action: { type: "claim", id: claim.id } })]);

    const save = money.save.items;
    expect(save.find((i: any) => i.kind === "uncovered_spend").title).toContain("שיניים");
    // 6 specialist consultations a year, none used yet, each worth ₪250 at what this family pays.
    expect(save.find((i: any) => i.kind === "unused_quota")).toMatchObject({ amountAgorot: 6 * 25000 });

    const specialist = money.services.find((x: any) => x.category === "specialist_visit");
    expect(specialist).toMatchObject({ visits: 1, paidAgorot: 65000, refundedAgorot: 0, unclaimedAgorot: 25000, covered: true });
    expect(money.services.find((x: any) => x.category === "dental")).toMatchObject({ covered: false, paidAgorot: 80000 });

    // Next steps: the receipt about to expire first, never a claim that only needs patience.
    expect(money.nextSteps[0]).toMatchObject({ kind: "unclaimed_receipt", urgent: true });
    expect(money.nextSteps.length).toBeLessThanOrEqual(4);
    expect(money.nextSteps.some((i: any) => i.kind === "in_flight")).toBe(false);
    expect(money.discovery).toEqual({ receipts: 5, policiesImported: false, cardScanned: false, premiumsEntered: false });

    // The last 3 years include the old receipt too.
    const three = expectStatus(await user.get("/v1/money?range=3y"), 200);
    expect(three.paidAgorot).toBe(money.paidAgorot + 40000);
  });
});

describe("credit card statement scan", () => {
  it("recognises medical merchants without false alarms", () => {
    expect(classifyMerchant('ד"ר לוי אורתופד', null)).toEqual({ medical: true, category: "specialist_visit" });
    expect(classifyMerchant("מכון פיזיו פלוס", null)).toEqual({ medical: true, category: "physiotherapy" });
    expect(classifyMerchant("קלינאית תקשורת שירה", null)).toEqual({ medical: true, category: "child_development" });
    expect(classifyMerchant("אופטיקה הלפרין", null)).toEqual({ medical: true, category: "glasses_lenses" });
    expect(classifyMerchant("פיצה הדר", null).medical).toBe(false);
    expect(classifyMerchant("הוט תקשורת", null).medical).toBe(false);
    expect(classifyMerchant("סופר-פארם", "רפואה ובריאות").medical).toBe(false);
    expect(classifyMerchant("מכבי שירותי בריאות", null).medical).toBe(false);
    expect(classifyMerchant("אבג בע\"מ", "רפואה ובריאות")).toEqual({ medical: true, category: null });
    expect(parseAmount("₪1,234.50")).toBe(1234.5);
    expect(parseAmount("-80.00")).toBe(-80);
  });

  it("reads an Isracard-style export", () => {
    const rows = tableToTransactions([
      ["פירוט עסקאות לכרטיס 1234"],
      ["תאריך רכישה", "שם בית עסק", "סכום עסקה", "מטבע", "סכום חיוב"],
      ["05/03/2026", "מכון פיזיו פלוס", "250.00", "₪", "250.00"],
      ["סה\"כ", "", "", "", "250.00"],
    ]);
    expect(rows).toEqual([{ merchant: "מכון פיזיו פלוס", date: "2026-03-05", amountIls: 250, issuerCategory: null }]);
  });

  it("finds medical payments without a receipt, and tracks the ones the user saves", async () => {
    const s = await login(env, "0541230002");
    const user = api(env, s.token);
    const selfId = s.me.members[0].id;
    expectStatus(await user.put(`/v1/members/${selfId}/enrollments`, { enrollments: [{ planId: "maccabi_sheli" }] }), 200);
    // This one already has a receipt in the app.
    await receipt(user, selfId, { category: "physiotherapy", amount: 25000, date: daysAgo(40), provider: "פיזיו פלוס" });

    const wb = new ExcelJS.Workbook();
    const sheet = wb.addWorksheet("עסקאות");
    sheet.addRow(["פירוט חיובים – כרטיס מסתיים ב-1234"]);
    sheet.addRow(["תאריך עסקה", "שם בית העסק", "קטגוריה", "סכום חיוב", "סכום עסקה מקורי"]);
    const d = (n: number) => daysAgo(n).split("-").reverse().join("/");
    sheet.addRow([d(10), 'ד"ר לוי אורתופד', "רפואה ובריאות", "650.00", "650.00"]);
    sheet.addRow([d(42), "מכון פיזיו פלוס", "רפואה ובריאות", "250.00", "250.00"]);
    sheet.addRow([d(15), "פיצה הדר", "מסעדות", "80.00", "80.00"]);
    sheet.addRow([d(20), "סופר-פארם", "רפואה ובריאות", "120.00", "120.00"]);
    sheet.addRow([d(30), "קלינאית תקשורת שירה", "שונות", "116.67", "350.00"]);
    sheet.addRow([d(5), 'ד"ר לוי אורתופד', "רפואה ובריאות", "-650.00", "-650.00"]);
    sheet.addRow([d(4 * 365), "מרפאת שיניים ישנה", "רפואה ובריאות", "900.00", "900.00"]);

    const scan = expectStatus(
      await user.upload("/v1/statement-scan", { data: Buffer.from(await wb.xlsx.writeBuffer()), mimeType: "application/octet-stream" }),
      200,
    );
    expect(scan.source).toBe("spreadsheet");
    expect(expectStatus(await user.get("/v1/money"), 200).discovery.cardScanned).toBe(true);
    expect(scan.rowsScanned).toBe(7);
    expect(scan.candidates.map((c: any) => c.merchant)).toEqual(['ד"ר לוי אורתופד', "קלינאית תקשורת שירה", "מכון פיזיו פלוס"]);
    const [doctor, clinician, physio] = scan.candidates;
    expect(doctor).toMatchObject({ category: "specialist_visit", amountAgorot: 65000, hasReceipt: false, estimatedRefundAgorot: 25000 });
    expect(clinician).toMatchObject({ amountAgorot: 35000, category: "child_development" }); // full amount, not the installment
    expect(physio).toMatchObject({ hasReceipt: true });

    expectStatus(
      await user.post("/v1/payment-leads", {
        items: [
          { merchant: doctor.merchant, date: doctor.date, amountAgorot: doctor.amountAgorot, category: doctor.category },
          { merchant: clinician.merchant, date: clinician.date, amountAgorot: clinician.amountAgorot, category: clinician.category },
        ],
      }),
      200,
    );
    let money = expectStatus(await user.get("/v1/money"), 200);
    const leads = money.missed.items.filter((i: any) => i.kind === "payment_without_receipt");
    expect(leads).toHaveLength(2);
    expect(leads.find((l: any) => l.title.includes("לוי"))).toMatchObject({ amountAgorot: 25000 });

    // Adding the receipt resolves the lead; dismissing removes the other.
    await receipt(user, selfId, { category: "specialist_visit", amount: 65000, date: daysAgo(10), provider: 'ד"ר לוי' });
    const clinicianLead = leads.find((l: any) => l.title.includes("קלינאית"));
    expectStatus(await user.post(`/v1/payment-leads/${clinicianLead.action.id}/dismiss`), 204);
    money = expectStatus(await user.get("/v1/money"), 200);
    expect(money.missed.items.filter((i: any) => i.kind === "payment_without_receipt")).toHaveLength(0);

    // A second scan says what's already tracked.
    const again = expectStatus(
      await user.upload("/v1/statement-scan", { data: Buffer.from(await wb.xlsx.writeBuffer()), mimeType: "application/octet-stream" }),
      200,
    );
    expect(again.candidates.find((c: any) => c.merchant === 'ד"ר לוי אורתופד')).toMatchObject({ alreadySaved: true, hasReceipt: true });
  });

  it("reads a PDF statement only with the AI consent, and nobody else's leads can be touched", async () => {
    const s = await login(env, "0541230003", { consents: ["terms", "privacy", "medical_data"] });
    const user = api(env, s.token);
    env.statementReader.next = [{ merchant: "מכון רנטגן העיר", date: daysAgo(3), amountIls: 450, issuerCategory: null }];
    const pdf = Buffer.from("%PDF-1.7 statement");
    const denied = await user.upload("/v1/statement-scan", { data: pdf, mimeType: "application/pdf" });
    expect(denied.statusCode).toBe(403);
    expectStatus(await user.post("/v1/consents", { kind: "ai_processing", version: "2026-10" }), 200);
    const scan = expectStatus(await user.upload("/v1/statement-scan", { data: pdf, mimeType: "application/pdf" }), 200);
    expect(scan).toMatchObject({ source: "ai", candidates: [expect.objectContaining({ category: "diagnostic_imaging" })] });

    expectStatus(
      await user.post("/v1/payment-leads", { items: [{ merchant: "מכון רנטגן העיר", date: daysAgo(3), amountAgorot: 45000, category: "diagnostic_imaging" }] }),
      200,
    );
    const [lead] = await env.sql`SELECT id FROM payment_leads WHERE merchant = 'מכון רנטגן העיר'`;
    const other = await login(env, "0541230004");
    expectStatus(await api(env, other.token).post(`/v1/payment-leads/${lead!.id}/dismiss`), 404);
  });
});
