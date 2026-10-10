import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { purgeExpiredFiles } from "../src/services/maintenance";
import { api, createTestEnv, expectStatus, fakeImage, login, type TestEnv } from "./helpers";

let env: TestEnv;

beforeAll(async () => {
  env = await createTestEnv();
});

afterAll(async () => {
  await env.close();
});

describe("legal pages", () => {
  it("serves the terms, privacy policy, power of attorney and accessibility statement in Hebrew", async () => {
    for (const [doc, text] of [
      ["terms", "14 יום"],
      ["privacy", "הממונה על הגנת הפרטיות"],
      ["poa", "ייפוי הכוח לא מאפשר"],
      ["accessibility", "5568"],
    ]) {
      const res = await env.app.inject({ method: "GET", url: `/legal/${doc}` });
      expect(res.statusCode, doc).toBe(200);
      expect(res.headers["content-type"]).toContain("text/html");
      expect(res.body, doc).toContain(text);
      expect(res.body, doc).not.toMatch(/\{\{\w+\}\}/); // every placeholder filled
    }
  });

  it("marks business details that are still missing instead of inventing them", async () => {
    const res = await env.app.inject({ method: "GET", url: "/legal/privacy" });
    expect(res.body).toContain("[להשלים: שם החברה]");
  });

  it("offers account deletion on the web (Google Play requirement)", async () => {
    const res = await env.app.inject({ method: "GET", url: "/legal/delete-account" });
    expect(res.body).toContain("מחיקת החשבון לצמיתות");
  });
});

describe("consents", () => {
  it("medical data cannot be stored without explicit consent", async () => {
    const s = await login(env, "0541111111", { consents: ["terms", "privacy"] });
    const user = api(env, s.token);
    const res = await user.upload("/v1/receipts", { data: fakeImage("c1"), mimeType: "image/png" });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.details).toEqual({ kind: "medical_data" });
    expectStatus(await user.post("/v1/consents", { kind: "medical_data", version: "2026-10" }), 200);
    expectStatus(await user.upload("/v1/receipts", { data: fakeImage("c1"), mimeType: "image/png" }), 201);
  });

  it("receipts go to the AI provider only with the separate AI consent", async () => {
    const s = await login(env, "0542222222", { consents: ["terms", "privacy", "medical_data"] });
    const user = api(env, s.token);
    const r = expectStatus(await user.upload("/v1/receipts", { data: fakeImage("noai"), mimeType: "image/png" }), 201);
    await env.runJobs();
    const receipt = expectStatus(await user.get(`/v1/receipts/${r.id}`), 200);
    expect(receipt.extractionStatus).toBe("manual");
  });

  it("each optional consent can be revoked on its own; terms only by deleting the account", async () => {
    const s = await login(env, "0543333333", { consents: ["terms", "privacy", "medical_data", "poa"] });
    const user = api(env, s.token);
    const me = expectStatus(await user.delete("/v1/consents/poa"), 200);
    expect(me.consents.map((c: any) => c.kind).sort()).toEqual(["medical_data", "privacy", "terms"]);
    expectStatus(await user.delete("/v1/consents/terms"), 409);
  });

  it("granting the same version twice keeps one active record", async () => {
    const s = await login(env, "0544444444");
    const user = api(env, s.token);
    expectStatus(await user.post("/v1/consents", { kind: "marketing", version: "2026-10" }), 200);
    const me = expectStatus(await user.post("/v1/consents", { kind: "marketing", version: "2026-10" }), 200);
    expect(me.consents.filter((c: any) => c.kind === "marketing")).toHaveLength(1);
  });
});

describe("family members", () => {
  it("a child needs a birth date, and a parent/guardian declaration for a minor", async () => {
    const s = await login(env, "0546666666");
    const user = api(env, s.token);
    expectStatus(await user.post("/v1/members", { fullName: "יואב", relation: "child" }), 400);
    expectStatus(await user.post("/v1/members", { fullName: "יואב", relation: "child", birthDate: "2018-03-01" }), 400);
    const child = expectStatus(
      await user.post("/v1/members", { fullName: "יואב", relation: "child", birthDate: "2018-03-01", guardianDeclared: true }),
      201,
    );
    expect(child.consentStatus).toBe("not_required");
  });
});

describe("retention", () => {
  it("deletes images of claims closed longer than the retention period, keeping the amounts", async () => {
    const s = await login(env, "0545555555");
    const user = api(env, s.token);
    const selfId = s.me.members[0].id;
    expectStatus(await user.put(`/v1/members/${selfId}/enrollments`, { enrollments: [{ planId: "maccabi_zahav" }] }), 200);
    const r = expectStatus(await user.upload("/v1/receipts", { data: fakeImage("ret"), mimeType: "image/png" }), 201);
    await env.runJobs();
    expectStatus(
      await user.patch(`/v1/receipts/${r.id}`, {
        memberId: selfId,
        category: "specialist_visit",
        providerName: "ד״ר לוי",
        serviceDate: "2026-07-01",
        amountAgorot: 50000,
        sessions: 1,
      }),
      200,
    );
    const claim = expectStatus(await user.post("/v1/claims", { receiptIds: [r.id] }), 201);
    await env.sql`UPDATE claims SET status = 'completed', updated_at = now() - interval '200 days' WHERE id = ${claim.id}`;

    expect(await purgeExpiredFiles(env.deps)).toBeGreaterThanOrEqual(1);
    const after = expectStatus(await user.get(`/v1/receipts/${r.id}`), 200);
    expect(after.imageUrl).toBeNull();
    expect(after.amountAgorot).toBe(50000);
    expect(await purgeExpiredFiles(env.deps)).toBe(0);
  });
});
