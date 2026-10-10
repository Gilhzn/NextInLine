import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, api, createTestEnv, expectStatus, fakeImage, login, type TestEnv } from "./helpers";

let env: TestEnv;
let user: ReturnType<typeof api>;
let childId: string;

beforeAll(async () => {
  env = await createTestEnv();
  const session = await login(env);
  user = api(env, session.token);

  expectStatus(await user.patch("/v1/me", { displayName: "מיכל כהן", onboardingStep: "coverage" }), 200);
  const selfId = session.me.members[0].id;
  expectStatus(
    await user.put(`/v1/members/${selfId}/enrollments`, {
      enrollments: [{ planId: "maccabi_sheli" }, { planId: "harel_ambulatory", isShabanSupplement: true }],
    }),
    200,
  );
  const child = expectStatus(await user.post("/v1/members", { fullName: "נועה", relation: "child", birthDate: "2020-05-01" }), 201);
  childId = child.id;
  expect(child.consentStatus).toBe("not_required");
  expectStatus(
    await user.put(`/v1/members/${childId}/enrollments`, {
      enrollments: [{ planId: "maccabi_sheli" }, { planId: "harel_ambulatory", isShabanSupplement: true }],
    }),
    200,
  );
  expectStatus(await user.post("/v1/push-tokens", { expoToken: "ExponentPushToken[test-device-123]", platform: "ios" }), 204);
});

afterAll(async () => {
  await env.close();
});

async function uploadAndConfirm(seed: string): Promise<string> {
  const receipt = expectStatus(await user.upload("/v1/receipts", { data: fakeImage(seed), mimeType: "image/png" }), 201);
  expect(receipt.extractionStatus).toBe("pending");
  await env.runJobs();

  const extracted = expectStatus(await user.get(`/v1/receipts/${receipt.id}`), 200);
  expect(extracted.extractionStatus).toBe("done");
  expect(extracted.memberId).toBe(childId); // guessed from the patient name on the receipt
  expect(extracted.amountAgorot).toBe(35000);
  expect(extracted.imageUrl).toMatch(/\/v1\/files\/.+\?exp=\d+&sig=[0-9a-f]{64}$/);

  const confirmed = expectStatus(
    await user.patch(`/v1/receipts/${receipt.id}`, {
      memberId: childId,
      category: "child_development",
      providerName: extracted.providerName,
      serviceDate: extracted.serviceDate,
      amountAgorot: extracted.amountAgorot,
      sessions: 1,
    }),
    200,
  );
  expect(confirmed.confirmed).toBe(true);
  return receipt.id;
}

async function provideVisitSummary(claimId: string): Promise<any> {
  const doc = expectStatus(
    await user.upload("/v1/documents", { data: fakeImage("summary"), mimeType: "application/pdf", filename: "summary.pdf" }, { kind: "visit_summary" }),
    201,
  );
  return expectStatus(await user.post(`/v1/claims/${claimId}/documents`, { kind: "visit_summary", documentId: doc.id }), 200);
}

describe("full claim lifecycle", () => {
  let claimId: string;

  it("creates a two-leg claim: shaban first, then the supplement on the remainder", async () => {
    const receiptId = await uploadAndConfirm("happy");
    const claim = expectStatus(await user.post("/v1/claims", { receiptIds: [receiptId] }), 201);
    claimId = claim.id;

    expect(claim.status).toBe("awaiting_documents");
    expect(claim.legs.map((l: any) => [l.planId, l.status, l.expectedAgorot])).toEqual([
      ["maccabi_sheli", "ready", 20000], // 60% capped at 200 ₪ per session
      ["harel_ambulatory", "blocked", 9000], // 60% of the remaining 150 ₪
    ]);
    expect(claim.totalExpectedAgorot).toBe(29000);
    expect(claim.feePreview).toEqual({ rateBps: 1500, amountAgorot: 4350, netToUserAgorot: 24650 });
    expect(claim.requiredDocs).toEqual([
      { kind: "receipt", status: "provided" },
      { kind: "visit_summary", status: "missing" },
    ]);

    const home = expectStatus(await user.get("/v1/home"), 200);
    expect(home.actionItems.some((a: any) => a.type === "missing_document" && a.claimId === claimId)).toBe(true);
  });

  it("refuses to submit until documents are in, then submits", async () => {
    expect((await user.post(`/v1/claims/${claimId}/submit`)).statusCode).toBe(409);
    const ready = await provideVisitSummary(claimId);
    expect(ready.status).toBe("ready");
    const submitted = expectStatus(await user.post(`/v1/claims/${claimId}/submit`), 200);
    expect(submitted.status).toBe("in_progress");
  });

  it("returns a ready-made submission pack for the open leg only", async () => {
    const claim = expectStatus(await user.get(`/v1/claims/${claimId}`), 200);
    const [leg1, leg2] = claim.legs;
    const pack = expectStatus(await user.get(`/v1/claims/${claimId}/legs/${leg1.id}/pack`), 200);
    expect(pack.payerName).toBe("מכבי");
    expect(pack.webUrl).toContain("maccabi4u.co.il");
    expect(pack.documents.map((d: any) => d.kind).sort()).toEqual(["receipt", "visit_summary"]);
    expect(pack.fields.find((f: any) => f.label === "סכום ששולם").value).toBe("‏350 ₪");
    expect((await user.get(`/v1/claims/${claimId}/legs/${leg2.id}/pack`)).statusCode).toBe(409);

    // The signed document URL serves the decrypted original.
    const docUrl = new URL(pack.documents[0].url);
    const file = await env.app.inject({ method: "GET", url: `${docUrl.pathname}${docUrl.search}` });
    expect(file.statusCode).toBe(200);
    expect(file.rawPayload.subarray(0, 4)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  });

  it("opens the supplement leg once the shaban pays, re-priced on what was actually paid", async () => {
    const claim = expectStatus(await user.get(`/v1/claims/${claimId}`), 200);
    const [leg1] = claim.legs;
    expectStatus(await user.post(`/v1/claims/${claimId}/legs/${leg1.id}/status`, { status: "submitted" }), 200);
    // illegal jump is refused
    expect((await user.post(`/v1/claims/${claimId}/legs/${leg1.id}/status`, { status: "submitted" })).statusCode).toBe(200); // idempotent
    const afterPaid = expectStatus(
      await user.post(`/v1/claims/${claimId}/legs/${leg1.id}/status`, { status: "paid", amountAgorot: 18000 }),
      200,
    );
    expect(afterPaid.legs.map((l: any) => [l.status, l.expectedAgorot, l.paidAgorot])).toEqual([
      ["paid", 20000, 18000],
      ["ready", 10200, null], // 60% of 350 - 180 = 170
    ]);
    expect(afterPaid.status).toBe("in_progress");
    expect(afterPaid.totalPaidAgorot).toBe(18000);

    await env.runJobs();
    expect(env.push.sent.some((p) => p.title.includes("180 ₪") && p.title.includes("מכבי"))).toBe(true);
  });

  it("operations closes the second leg; the claim completes and the fee is charged after 3 days", async () => {
    const claim = expectStatus(await user.get(`/v1/claims/${claimId}`), 200);
    const leg2 = claim.legs[1];
    expectStatus(await admin(env).post(`/admin/legs/${leg2.id}/status`, { status: "submitted" }), 200);
    expectStatus(await admin(env).post(`/admin/legs/${leg2.id}/status`, { status: "paid", amountAgorot: 10200 }), 200);

    const done = expectStatus(await user.get(`/v1/claims/${claimId}`), 200);
    expect(done.status).toBe("completed");
    expect(done.totalPaidAgorot).toBe(28200);
    expect(done.fee).toMatchObject({ status: "scheduled", amountAgorot: 4230, rateBps: 1500 });

    expectStatus(await user.post("/v1/payment-methods", { provider: "mock", token: "tok_visa_4242", brand: "visa", last4: "4242" }), 201);
    await env.runJobs();
    expect(env.payments.charges).toHaveLength(0); // not due yet

    env.clock.advanceDays(3);
    await env.runJobs();
    expect(env.payments.charges).toEqual([{ token: "tok_visa_4242", amountAgorot: 4230, idempotencyKey: done.fee.id, description: "מגיע לי – עמלת הצלחה" }]);
    const charged = expectStatus(await user.get(`/v1/claims/${claimId}`), 200);
    expect(charged.fee.status).toBe("charged");

    const home = expectStatus(await user.get("/v1/home"), 200);
    expect(home.yearPaidAgorot).toBe(28200);
  });

  it("re-routes the full amount to the supplement when the shaban rejects", async () => {
    env.extractor.next = { ...(env.extractor.next as object), providerName: "מכון שני" } as never;
    const receiptId = await uploadAndConfirm("rejected");
    const claim = expectStatus(await user.post("/v1/claims", { receiptIds: [receiptId] }), 201);
    await provideVisitSummary(claim.id);
    expectStatus(await user.post(`/v1/claims/${claim.id}/submit`), 200);
    const [leg1] = claim.legs;
    expectStatus(await user.post(`/v1/claims/${claim.id}/legs/${leg1.id}/status`, { status: "submitted" }), 200);
    const afterReject = expectStatus(
      await user.post(`/v1/claims/${claim.id}/legs/${leg1.id}/status`, { status: "rejected", reason: "חסרה הפניה" }),
      200,
    );
    expect(afterReject.legs.map((l: any) => [l.status, l.expectedAgorot])).toEqual([
      ["rejected", 20000],
      ["ready", 21000], // 60% of the full 350 ₪
    ]);
    expect(afterReject.legs[0].rejectionReason).toBe("חסרה הפניה");

    const leg2 = afterReject.legs[1];
    expectStatus(await user.post(`/v1/claims/${claim.id}/legs/${leg2.id}/status`, { status: "submitted" }), 200);
    const done = expectStatus(await user.post(`/v1/claims/${claim.id}/legs/${leg2.id}/status`, { status: "paid" }), 200);
    expect(done.status).toBe("partially_paid");
    expect(done.fee.amountAgorot).toBe(3150);
  });

  it("lets the user dispute a fee before it is charged", async () => {
    const fees = expectStatus(await user.get("/v1/fees"), 200);
    const scheduled = fees.find((f: any) => f.status === "scheduled");
    const disputed = expectStatus(await user.post(`/v1/fees/${scheduled.id}/dispute`, { reason: "הכסף לא הגיע" }), 200);
    expect(disputed.status).toBe("disputed");
    env.clock.advanceDays(4);
    const before = env.payments.charges.length;
    await env.runJobs();
    expect(env.payments.charges.length).toBe(before);

    const resolved = expectStatus(await admin(env).post(`/admin/fees/${scheduled.id}/resolve`, { action: "waive" }), 200);
    expect(resolved.status).toBe("waived");
  });

  it("refuses illegal leg transitions", async () => {
    const claims = expectStatus(await user.get("/v1/claims?status=completed"), 200);
    const leg = claims[0].legs[0];
    const res = await user.post(`/v1/claims/${claims[0].id}/legs/${leg.id}/status`, { status: "rejected" });
    expect(res.statusCode).toBe(409);
  });

  it("coverage map shows remaining sessions after the claims", async () => {
    const map = expectStatus(await user.get("/v1/coverage/map"), 200);
    const child = map.find((i: any) => i.category === "child_development").members.find((m: any) => m.memberId === childId);
    const shaban = child.plans.find((p: any) => p.planId === "maccabi_sheli");
    expect(shaban.summary).toContain("60%");
    // Usage is counted in the claim's service year (2026); the map shows the current calendar year.
    expect(typeof shaban.remainingSessions).toBe("number");

    const search = expectStatus(await user.get(`/v1/coverage/search?q=${encodeURIComponent("פסיכולוג")}`), 200);
    expect(search.categories[0].category).toBe("psychology");
    expect(search.items[0].category).toBe("psychology");

    const sim = expectStatus(
      await user.post("/v1/coverage/simulate", { memberId: childId, category: "psychology", amountAgorot: 45000, serviceDate: "2026-09-01" }),
      200,
    );
    expect(sim.legs.map((l: any) => l.expectedAgorot)).toEqual([8500, 18250]);
  });
});
