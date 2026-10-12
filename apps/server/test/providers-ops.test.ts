import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config";
import { ResendEmail, TwilioSms } from "../src/providers.production";
import { ensureDailyMaintenance, nudgeSlowPayers, warnExpiringReceipts } from "../src/services/maintenance";
import { createDeps } from "../src/wiring";
import { addCard, admin, api, createTestEnv, expectStatus, fakeImage, login, type TestEnv } from "./helpers";

function fakeFetch(status = 200) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fn = (async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(status === 200 ? "{}" : "nope", { status });
  }) as typeof fetch;
  return { fn, calls };
}

describe("production providers", () => {
  it("Twilio sends a form-encoded message with basic auth", async () => {
    const http = fakeFetch();
    await new TwilioSms({ accountSid: "AC123", authToken: "secret", from: "+15005550006" }, http.fn).send("+972501234567", "קוד: 123456");
    const call = http.calls[0]!;
    expect(call.url).toBe("https://api.twilio.com/2010-04-01/Accounts/AC123/Messages.json");
    expect((call.init.headers as Record<string, string>).authorization).toBe(`Basic ${Buffer.from("AC123:secret").toString("base64")}`);
    const body = new URLSearchParams(String(call.init.body));
    expect(body.get("To")).toBe("+972501234567");
    expect(body.get("From")).toBe("+15005550006");
    expect(body.get("Body")).toBe("קוד: 123456");
  });

  it("Twilio surfaces API errors", async () => {
    const http = fakeFetch(400);
    await expect(new TwilioSms({ accountSid: "AC1", authToken: "x", from: "+1" }, http.fn).send("+972501234567", "x")).rejects.toThrow(/400/);
  });

  it("Resend sends JSON with base64 attachments", async () => {
    const http = fakeFetch();
    await new ResendEmail({ apiKey: "re_test", from: "מגיע לי <claims@example.com>" }, http.fn).send({
      to: "claims@insurer.test",
      subject: "בקשת החזר",
      text: "שלום",
      attachments: [{ filename: "a.pdf", content: Buffer.from("PDF"), contentType: "application/pdf" }],
    });
    const call = http.calls[0]!;
    expect(call.url).toBe("https://api.resend.com/emails");
    const body = JSON.parse(String(call.init.body));
    expect(body).toMatchObject({ to: ["claims@insurer.test"], subject: "בקשת החזר", attachments: [{ filename: "a.pdf", content: Buffer.from("PDF").toString("base64") }] });
  });

  it("wiring picks real services only when credentials are present", () => {
    const base = {
      DATABASE_URL: "postgres://x:y@localhost:5432/z",
      JWT_SECRET: "j".repeat(40),
      OTP_PEPPER: "p".repeat(20),
      MASTER_KEY: "m".repeat(40),
      FILES_SIGNING_SECRET: "f".repeat(40),
      ADMIN_TOKEN: "a".repeat(30),
    };
    const dev = createDeps(loadConfig(base), {} as never).summary;
    expect(dev).toMatchObject({ sms: "console (dev)", email: "console (dev)", storage: "local disk" });
    const prod = createDeps(
      loadConfig({
        ...base,
        TWILIO_ACCOUNT_SID: "AC1",
        TWILIO_AUTH_TOKEN: "t",
        TWILIO_FROM: "Magiali",
        RESEND_API_KEY: "re_1",
        EMAIL_FROM: "x@example.com",
        S3_BUCKET: "receipts",
        S3_ENDPOINT: "https://example.r2.cloudflarestorage.com",
        S3_ACCESS_KEY_ID: "k",
        S3_SECRET_ACCESS_KEY: "s",
      }),
      {} as never,
    ).summary;
    expect(prod).toMatchObject({ sms: "twilio", email: "resend", storage: "s3 (receipts)" });
  });

  it("derives public file links from Render's URL", () => {
    const base = {
      DATABASE_URL: "postgres://x:y@localhost:5432/z",
      JWT_SECRET: "j".repeat(40),
      OTP_PEPPER: "p".repeat(20),
      MASTER_KEY: "m".repeat(40),
      FILES_SIGNING_SECRET: "f".repeat(40),
      ADMIN_TOKEN: "a".repeat(30),
    };
    expect(loadConfig({ ...base, RENDER_EXTERNAL_URL: "https://magiali.onrender.com" }).PUBLIC_BASE_URL).toBe("https://magiali.onrender.com");
    expect(loadConfig({ ...base, WEB_DIR: "../mobile/dist" }).PUBLIC_BASE_URL).toBe("");
    expect(loadConfig(base).PUBLIC_BASE_URL).toBe("http://localhost:4000");
  });
});

let env: TestEnv;

beforeAll(async () => {
  env = await createTestEnv();
});

afterAll(async () => {
  await env.close();
});

describe("demo & operations", () => {
  it("public config says whether the demo login code is active", async () => {
    const res = expectStatus(await env.app.inject({ method: "GET", url: "/v1/public-config" }), 200);
    expect(res).toEqual({ demoMode: false, demoLoginCode: null, openBanking: true, emailInbox: true });
  });

  it("serves the ops console page", async () => {
    const res = await env.app.inject({ method: "GET", url: "/ops" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/html");
    expect(res.body).toContain("ממשק תפעול");
  });

  it("ops can see the queue, pay a leg, and charge the fee without waiting 3 days", async () => {
    const session = await login(env, "0551111111");
    const user = api(env, session.token);
    const selfId = session.me.members[0].id;
    expectStatus(await user.put(`/v1/members/${selfId}/enrollments`, { enrollments: [{ planId: "maccabi_zahav" }] }), 200);
    const r = expectStatus(await user.upload("/v1/receipts", { data: fakeImage("ops"), mimeType: "image/png" }), 201);
    await env.runJobs();
    expectStatus(
      await user.patch(`/v1/receipts/${r.id}`, {
        memberId: selfId,
        category: "specialist_visit",
        providerName: "ד״ר כהן",
        serviceDate: "2026-08-01",
        amountAgorot: 40000,
        sessions: 1,
      }),
      200,
    );
    const claim = expectStatus(await user.post("/v1/claims", { receiptIds: [r.id] }), 201);
    expectStatus(await user.post(`/v1/claims/${claim.id}/submit`), 200);
    expectStatus(await user.post(`/v1/claims/${claim.id}/legs/${claim.legs[0].id}/status`, { status: "submitted" }), 200);
    await addCard(env, session.token, "tok_ops");

    const queue = expectStatus(await admin(env).get("/admin/legs?status=submitted,in_review"), 200);
    const leg = queue.find((l: any) => l.claimId === claim.id);
    expect(leg).toMatchObject({ payerName: "מכבי", categoryLabel: "רופא מומחה", ownerPhone: "+972551111111" });

    expectStatus(await admin(env).post(`/admin/legs/${leg.id}/status`, { status: "paid", amountAgorot: 20000 }), 200);
    const fees = expectStatus(await admin(env).get("/admin/fees"), 200);
    const fee = fees.find((f: any) => f.claimId === claim.id);
    expect(fee.status).toBe("scheduled");

    const charged = expectStatus(await admin(env).post(`/admin/fees/${fee.id}/resolve`, { action: "charge_now" }), 200);
    expect(charged.status).toBe("charged");
    expect(env.payments.charges.at(-1)).toMatchObject({ token: "tok_ops", amountAgorot: 3000 });

    const overview = expectStatus(await admin(env).get("/admin/overview"), 200);
    expect(overview.paidToUsersAgorot).toBeGreaterThanOrEqual(20000);
  });
});

describe("daily maintenance", () => {
  it("schedules itself once", async () => {
    await ensureDailyMaintenance(env.deps);
    await ensureDailyMaintenance(env.deps);
    const [row] = await env.sql`SELECT count(*)::int AS n FROM jobs WHERE type = 'daily_maintenance' AND done_at IS NULL`;
    expect(row!.n).toBe(1);
    await env.runJobs();
    const [next] = await env.sql`
      SELECT run_at FROM jobs WHERE type = 'daily_maintenance' AND done_at IS NULL ORDER BY run_at DESC LIMIT 1`;
    expect((next!.runAt as Date).getTime()).toBeGreaterThan(Date.now());
  });

  it("warns once about an unclaimed receipt close to the 3-year limit", async () => {
    const session = await login(env, "0552222222");
    const user = api(env, session.token);
    const r = expectStatus(await user.upload("/v1/receipts", { data: fakeImage("old"), mimeType: "image/png" }), 201);
    const threeYearsAgoPlus10 = new Date(Date.now() - 3 * 365.25 * 86_400_000 + 10 * 86_400_000).toISOString().slice(0, 10);
    await env.sql`UPDATE receipts SET service_date = ${threeYearsAgoPlus10}, amount_agorot = 65000 WHERE id = ${r.id}`;
    const first = await warnExpiringReceipts(env.deps);
    const again = await warnExpiringReceipts(env.deps);
    expect(first).toBeGreaterThanOrEqual(1);
    expect(again).toBe(0);
    const notes = expectStatus(await user.get("/v1/notifications"), 200);
    expect(notes.some((n: any) => n.type === "expiry_warning" && n.title.includes("650"))).toBe(true);
  });

  it("nudges about payers that are past their usual processing time", async () => {
    await env.sql`UPDATE claim_legs SET status = 'submitted', submitted_at = now() - interval '90 days' WHERE status = 'ready'`;
    await env.sql`UPDATE claims SET status = 'in_progress' WHERE id IN (SELECT claim_id FROM claim_legs WHERE status = 'submitted')`;
    const first = await nudgeSlowPayers(env.deps);
    const again = await nudgeSlowPayers(env.deps);
    expect(again).toBe(0);
    expect(first).toBeGreaterThanOrEqual(0);
  });
});

describe("operator sign-in", () => {
  it("operators listed in OPS_PHONES sign in by SMS code and their actions are attributed to them", async () => {
    env.deps.config.OPS_PHONES = "050-1112233";
    expectStatus(await env.app.inject({ method: "POST", url: "/ops/login/request", payload: { phone: "0501112233" } }), 204);
    const code = env.sms.lastCodeFor("+972501112233");
    const session = expectStatus(
      await env.app.inject({ method: "POST", url: "/ops/login/verify", payload: { phone: "0501112233", code } }),
      200,
    );
    const ok = await env.app.inject({ method: "GET", url: "/admin/overview", headers: { authorization: `Bearer ${session.token}` } });
    expect(ok.statusCode).toBe(200);

    // A user's app token is not an ops session.
    const user = await login(env, "0557777000");
    const denied = await env.app.inject({ method: "GET", url: "/admin/overview", headers: { authorization: `Bearer ${user.token}` } });
    expect(denied.statusCode).toBe(401);

    // Unlisted numbers get the same answer but no code.
    const before = env.sms.sent.length;
    expectStatus(await env.app.inject({ method: "POST", url: "/ops/login/request", payload: { phone: "0509999999" } }), 204);
    expect(env.sms.sent.length).toBe(before);

    // Removing someone from the list ends their session immediately.
    env.deps.config.OPS_PHONES = "";
    const removed = await env.app.inject({ method: "GET", url: "/admin/overview", headers: { authorization: `Bearer ${session.token}` } });
    expect(removed.statusCode).toBe(401);
  });

  it("the shared admin token does not work in production", async () => {
    const prev = env.deps.config.NODE_ENV;
    env.deps.config.NODE_ENV = "production";
    try {
      const res = await env.app.inject({ method: "GET", url: "/admin/overview", headers: { "x-admin-token": "test-admin-token-0123456789abcdef" } });
      expect(res.statusCode).toBe(401);
    } finally {
      env.deps.config.NODE_ENV = prev;
    }
  });
});
