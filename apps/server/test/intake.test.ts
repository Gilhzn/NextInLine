import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { enqueueDueBankSyncs } from "../src/services/open-banking";
import { INBOUND_SECRET, api, createTestEnv, expectStatus, fakeImage, login, type TestEnv } from "./helpers";

let env: TestEnv;

beforeAll(async () => {
  env = await createTestEnv();
});

afterAll(async () => {
  await env.close();
});

const photo = (seed: string, extra = 6000) => Buffer.concat([fakeImage(seed), Buffer.alloc(extra, 1)]);
const auth = { authorization: `Basic ${Buffer.from(`postmark:${INBOUND_SECRET}`).toString("base64")}` };
async function householdOf(s: { me: any }): Promise<string> {
  const [row] = await env.sql`SELECT household_id FROM members WHERE id = ${s.me.members[0].id}`;
  return row!.householdId as string;
}
const inbound = (payload: unknown, headers: Record<string, string> = auth) =>
  env.app.inject({ method: "POST", url: "/webhooks/inbound-email", headers, payload: payload as object });

describe("receipts by email", () => {
  it("turns receipt attachments sent to the family's private address into receipts to confirm", async () => {
    const s = await login(env, "0541260001");
    const user = api(env, s.token);
    const inbox = expectStatus(await user.get("/v1/inbox"), 200);
    expect(inbox.address).toMatch(/^r-[a-z0-9]{12}@in\.magiali\.test$/);
    expect(expectStatus(await user.get("/v1/inbox"), 200).address).toBe(inbox.address); // stable

    const pdf = Buffer.from("%PDF-1.7 receipt from the clinic");
    const email = {
      FromFull: { Email: "billing@clinic.example" },
      ToFull: [{ Email: inbox.address.toUpperCase() }],
      Attachments: [
        { Name: "receipt-1042.pdf", Content: pdf.toString("base64"), ContentType: "application/pdf" },
        { Name: "photo.jpg", Content: photo("a").toString("base64"), ContentType: "application/octet-stream" },
        // A logo in the signature, and something that isn't a receipt.
        { Name: "logo.png", Content: photo("logo", 100).toString("base64"), ContentType: "image/png", ContentID: "logo@x" },
        { Name: "notes.docx", Content: Buffer.from("doc").toString("base64"), ContentType: "application/msword" },
      ],
    };
    expect((await inbound(email, {})).statusCode).toBe(401);
    expect((await inbound(email, { "x-inbound-secret": "wrong-secret-0123456789abcdef" })).statusCode).toBe(401);
    expect(expectStatus(await inbound(email), 200)).toMatchObject({ status: "processed", receipts: 2 });

    const receipts = await env.sql`SELECT source FROM receipts WHERE household_id = ${await householdOf(s)}`;
    expect(receipts.map((r) => r.source)).toEqual(["email", "email"]);
    const [note] = await env.sql`SELECT title, data FROM notifications WHERE user_id = ${s.me.user.id} AND type = 'email_receipt'`;
    expect(note!.title).toContain("2 קבלות במייל");

    // The same email again: nothing new. An email without attachments is explained to the family.
    expect(expectStatus(await inbound(email), 200)).toMatchObject({ receipts: 0 });
    expect(expectStatus(await inbound({ ToFull: [{ Email: inbox.address }], Attachments: [] }), 200)).toMatchObject({ status: "no_attachments" });

    const after = expectStatus(await user.get("/v1/inbox"), 200);
    expect(after.recent.map((r: any) => r.status)).toEqual(["no_attachments", "processed", "processed"]);
    expect(after.recent[2]).toMatchObject({ from: "billing@clinic.example", receipts: 2 });
    const money = expectStatus(await user.get("/v1/money"), 200);
    expect(money.discovery.emailInbox).toBe(true);

    // A new address: the old one stops working.
    const rotated = expectStatus(await user.post("/v1/inbox/rotate"), 200);
    expect(rotated.address).not.toBe(inbox.address);
    expect(expectStatus(await inbound(email), 200)).toMatchObject({ status: "unknown_recipient" });
  });

  it("needs the medical data consent, and ignores unknown addresses", async () => {
    const s = await login(env, "0541260002", { consents: ["terms", "privacy"] });
    const { address } = expectStatus(await api(env, s.token).get("/v1/inbox"), 200);
    const email = { To: address, Attachments: [{ Name: "r.pdf", Content: Buffer.from("%PDF-1.7 x").toString("base64"), ContentType: "application/pdf" }] };
    expect(expectStatus(await inbound(email), 200)).toMatchObject({ status: "consent_required" });
    expect(expectStatus(await inbound({ ...email, To: "r-nosuchtoken12@in.magiali.test" }), 200)).toMatchObject({ status: "unknown_recipient" });
    const [{ n }] = (await env.sql`SELECT count(*)::int AS n FROM receipts WHERE household_id = ${await householdOf(s)}`) as any;
    expect(n).toBe(0);
  });
});

describe("open banking", () => {
  it("connects through the provider's consent page, keeps only medical payments without a receipt, and can be revoked", async () => {
    const s = await login(env, "0541260003");
    const user = api(env, s.token);
    const config = expectStatus(await env.app.inject({ method: "GET", url: "/v1/public-config" }), 200);
    expect(config).toMatchObject({ openBanking: true, emailInbox: true });

    // A separate, explicit consent for reading payments.
    expect((await user.post("/v1/bank-connections", { platform: "web" })).statusCode).toBe(403);
    expectStatus(await user.post("/v1/consents", { kind: "financial_data", version: "2026-10" }), 200);
    expectStatus(await user.put(`/v1/members/${s.me.members[0].id}/enrollments`, { enrollments: [{ planId: "maccabi_sheli" }] }), 200);
    const started = expectStatus(await user.post("/v1/bank-connections", { platform: "web" }), 200);
    expect(started.url).toMatch(/^\/open-banking\/mock\/mockob_/);

    // The consent page: pick two institutions and approve.
    const pageRes = await env.app.inject({ method: "GET", url: started.url });
    expect(pageRes.body).toContain("ישראכרט");
    const approved = await env.app.inject({
      method: "POST",
      url: started.url,
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload: "i=%D7%99%D7%A9%D7%A8%D7%90%D7%9B%D7%A8%D7%98&i=%D7%9E%D7%A7%D7%A1&decision=approve",
    });
    expect(approved.statusCode).toBe(303);
    expect(approved.headers.location).toContain(`/open-banking/return/${started.connectionId}`);
    const back = await env.app.inject({ method: "GET", url: approved.headers.location as string });
    expect(back.body).toContain(`/bank-return?connection=${started.connectionId}`);

    const connection = expectStatus(await user.get(`/v1/bank-connections/${started.connectionId}`), 200);
    expect(connection).toMatchObject({ status: "active", institutions: ["ישראכרט", "מקס"] });
    await env.runJobs();

    // Physiotherapy, the psychologist and the optician – not the supermarket, fuel, pharmacy or a refund.
    const leads = await env.sql`SELECT merchant, amount_agorot, category, source FROM payment_leads WHERE household_id = ${await householdOf(s)} ORDER BY paid_on DESC`;
    expect(leads.map((l) => [l.merchant, l.amountAgorot, l.category, l.source])).toEqual([
      ["מכון פיזיותרפיה גוף ונפש", 28000, "physiotherapy", "bank"],
      ['ד"ר אורית לוי פסיכולוגית', 45000, "psychology", "bank"],
      ["אופטיקה הלפרין", 120000, "glasses_lenses", "bank"],
    ]);
    const [note] = await env.sql`SELECT title FROM notifications WHERE user_id = ${s.me.user.id} AND type = 'bank_sync'`;
    expect(note!.title).toContain("3 תשלומים");
    const money = expectStatus(await user.get("/v1/money"), 200);
    expect(money.discovery.bankConnected).toBe(true);
    expect(money.missed.items.filter((i: any) => i.kind === "payment_without_receipt")).toHaveLength(3);

    // Syncing again finds nothing new; the daily job queues only connections not synced lately.
    const again = expectStatus(await user.post(`/v1/bank-connections/${started.connectionId}/sync`), 200);
    expect(again).toMatchObject({ leadsFound: 3 });
    expect(await enqueueDueBankSyncs(env.deps)).toBe(0);
    env.clock.advanceDays(1);
    expect(await enqueueDueBankSyncs(env.deps)).toBe(1);

    // Another family can't see or touch it.
    const other = await login(env, "0541260004");
    expectStatus(await api(env, other.token).get(`/v1/bank-connections/${started.connectionId}`), 404);
    expectStatus(await api(env, other.token).delete(`/v1/bank-connections/${started.connectionId}`), 404);

    expectStatus(await user.delete(`/v1/bank-connections/${started.connectionId}`), 204);
    expect(await env.openBanking.getConsent((await env.sql`SELECT provider_ref FROM bank_connections`)[0]!.providerRef)).toMatchObject({ status: "revoked" });
    expect(expectStatus(await user.get("/v1/bank-connections"), 200)[0]).toMatchObject({ status: "revoked" });
  });

  it("a declined consent ends as failed", async () => {
    const s = await login(env, "0541260005", { consents: ["terms", "privacy", "medical_data", "financial_data"] });
    const user = api(env, s.token);
    const started = expectStatus(await user.post("/v1/bank-connections", { platform: "web" }), 200);
    await env.app.inject({
      method: "POST",
      url: started.url,
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload: "decision=decline",
    });
    expect(expectStatus(await user.get(`/v1/bank-connections/${started.connectionId}`), 200)).toMatchObject({ status: "failed" });
    expect(expectStatus(await user.get("/v1/bank-connections"), 200)).toEqual([]);

    // Withdrawing the payments consent ends any connection.
    const second = expectStatus(await user.post("/v1/bank-connections", { platform: "web" }), 200);
    await env.app.inject({ method: "POST", url: second.url, headers: { "content-type": "application/x-www-form-urlencoded" }, payload: "i=%D7%9E%D7%A7%D7%A1&decision=approve" });
    expect(expectStatus(await user.get(`/v1/bank-connections/${second.connectionId}`), 200)).toMatchObject({ status: "active" });
    expectStatus(await user.delete("/v1/consents/financial_data"), 200);
    expect(expectStatus(await user.get(`/v1/bank-connections/${second.connectionId}`), 200)).toMatchObject({ status: "revoked" });
  });
});
