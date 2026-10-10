import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { api, createTestEnv, expectStatus, fakeImage, login, type TestEnv } from "./helpers";

let env: TestEnv;

beforeAll(async () => {
  env = await createTestEnv();
});

afterAll(async () => {
  await env.close();
});

async function receiptFor(user: ReturnType<typeof api>, memberId: string, category: string, amountAgorot: number, seed: string) {
  const r = expectStatus(await user.upload("/v1/receipts", { data: fakeImage(seed), mimeType: "image/png" }), 201);
  await env.runJobs();
  return expectStatus(
    await user.patch(`/v1/receipts/${r.id}`, {
      memberId,
      category,
      providerName: "ד״ר לוי",
      serviceDate: "2026-08-20",
      amountAgorot,
      sessions: 1,
    }),
    200,
  );
}

describe("adult family members need consent", () => {
  it("blocks claims for a spouse until they confirm by SMS code", async () => {
    const user = api(env, (await login(env, "0541111111")).token);
    const spouse = expectStatus(await user.post("/v1/members", { fullName: "אבי", relation: "spouse", phone: "052-765-4321" }), 201);
    expect(spouse.consentStatus).toBe("pending");
    const sms = env.sms.sent.at(-1)!;
    expect(sms.to).toBe("+972527654321");

    expectStatus(await user.put(`/v1/members/${spouse.id}/enrollments`, { enrollments: [{ planId: "maccabi_zahav" }] }), 200);
    const receipt = await receiptFor(user, spouse.id, "specialist_visit", 60000, "spouse");

    const blocked = await user.post("/v1/claims", { receiptIds: [receipt.id] });
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json().error.code).toBe("consent_required");

    const code = env.sms.lastCodeFor("+972527654321");
    const confirmed = expectStatus(await user.post("/v1/members/consent/confirm", { memberId: spouse.id, code }), 200);
    expect(confirmed.consentStatus).toBe("granted");

    const claim = expectStatus(await user.post("/v1/claims", { receiptIds: [receipt.id] }), 201);
    expect(claim.legs[0]).toMatchObject({ planId: "maccabi_zahav", expectedAgorot: 25000 }); // 50% capped at 250 ₪
    expect(claim.status).toBe("ready");
  });

  it("requires a phone for adults", async () => {
    const user = api(env, (await login(env, "0542222222")).token);
    const res = await user.post("/v1/members", { fullName: "סבתא רחל", relation: "parent" });
    expect(res.statusCode).toBe(400);
  });
});

describe("claims edge cases", () => {
  it("explains when nothing is covered", async () => {
    const session = await login(env, "0543333333");
    const user = api(env, session.token);
    const selfId = session.me.members[0].id;
    expectStatus(await user.put(`/v1/members/${selfId}/enrollments`, { enrollments: [{ planId: "clalit_mushlam" }] }), 200);
    const receipt = await receiptFor(user, selfId, "dental", 80000, "dental");
    const res = await user.post("/v1/claims", { receiptIds: [receipt.id] });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("no_coverage");
    expect(res.json().error.details.routing.notes[0]).toContain("לא נמצא כיסוי");
  });

  it("allows only one shaban tier per member", async () => {
    const session = await login(env, "0544444444");
    const user = api(env, session.token);
    const res = await user.put(`/v1/members/${session.me.members[0].id}/enrollments`, {
      enrollments: [{ planId: "maccabi_zahav" }, { planId: "maccabi_sheli" }],
    });
    expect(res.statusCode).toBe(400);
  });

  it("submits by email with a power of attorney when the payer accepts email claims", async () => {
    await env.sql`UPDATE payers SET claims_email = 'claims@harel.test' WHERE id = 'harel'`;
    const session = await login(env, "0545555555");
    const user = api(env, session.token);
    const selfId = session.me.members[0].id;
    expectStatus(await user.put(`/v1/members/${selfId}/enrollments`, { enrollments: [{ planId: "harel_ambulatory" }] }), 200);
    const receipt = await receiptFor(user, selfId, "second_opinion", 90000, "poa");
    const claim = expectStatus(await user.post("/v1/claims", { receiptIds: [receipt.id], isRetro: true }), 201);
    expect(claim.legs[0]).toMatchObject({ submissionChannel: "email_poa", expectedAgorot: 61000 });
    expect(claim.feePreview.rateBps).toBe(2000);

    const noPoa = await user.post(`/v1/claims/${claim.id}/submit`);
    expect(noPoa.json().error.code).toBe("consent_required");

    expectStatus(await user.post("/v1/consents", { kind: "poa", version: "1.0" }), 200);
    expectStatus(await user.post(`/v1/claims/${claim.id}/submit`), 200);
    await env.runJobs();

    const mail = env.email.sent.at(-1)!;
    expect(mail.to).toBe("claims@harel.test");
    expect(mail.subject).toContain("חוות דעת שנייה");
    expect(mail.attachments).toHaveLength(1);
    const after = expectStatus(await user.get(`/v1/claims/${claim.id}`), 200);
    expect(after.legs[0].status).toBe("submitted");
    expect(after.legs[0].expectedDecisionBy).not.toBeNull();
    await env.sql`UPDATE payers SET claims_email = NULL WHERE id = 'harel'`;
  });

  it("falls back to manual entry when extraction keeps failing", async () => {
    const user = api(env, (await login(env, "0546666666")).token);
    env.extractor.next = "retryable";
    const r = expectStatus(await user.upload("/v1/receipts", { data: fakeImage("flaky"), mimeType: "image/png" }), 201);
    for (let i = 0; i < 3; i++) {
      await env.runJobs();
      env.clock.advanceDays(1);
    }
    const after = expectStatus(await user.get(`/v1/receipts/${r.id}`), 200);
    expect(after.extractionStatus).toBe("manual");
    expect(env.extractor.calls).toBeGreaterThanOrEqual(3);
    const [job] = await env.sql`SELECT failed_at, attempts FROM jobs WHERE type = 'extract_receipt' AND payload->>'receiptId' = ${r.id}`;
    expect(job!.attempts).toBe(3);
    expect(job!.failedAt).not.toBeNull();
  });
});

describe("privacy", () => {
  it("exports the user's data", async () => {
    const user = api(env, (await login(env, "0547777777")).token);
    const data = expectStatus(await user.get("/v1/privacy/export"), 200);
    expect(data.user[0].phoneE164).toBe("+972547777777");
    expect(Array.isArray(data.claims)).toBe(true);
  });

  it("deletes the account immediately and purges files after 30 days", async () => {
    const session = await login(env, "0548888888");
    const user = api(env, session.token);
    const r = expectStatus(await user.upload("/v1/receipts", { data: fakeImage("bye"), mimeType: "image/png" }), 201);
    const [doc] = await env.sql`SELECT d.storage_key FROM receipts r JOIN documents d ON d.id = r.document_id WHERE r.id = ${r.id}`;

    expectStatus(await user.delete("/v1/me"), 204);
    expect((await user.get("/v1/me")).statusCode).toBe(401);
    const refresh = await env.app.inject({ method: "POST", url: "/v1/auth/refresh", payload: { refreshToken: session.refreshToken } });
    expect(refresh.statusCode).toBe(401);

    // The phone number is free again: logging in creates a brand-new household.
    const fresh = await login(env, "0548888888");
    expect(fresh.me.householdId).not.toBe(session.me.householdId);

    env.clock.advanceDays(31);
    await env.runJobs();
    await expect(env.deps.storage.get(doc!.storageKey as string)).rejects.toThrow();
    const [member] = await env.sql`SELECT full_name FROM members WHERE household_id = ${session.me.householdId}`;
    expect(member!.fullName).toBe("נמחק");
  });
});
