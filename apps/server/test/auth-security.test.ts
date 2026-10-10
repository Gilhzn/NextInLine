import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { deliveryTime } from "../src/services/notify";
import { api, createTestEnv, expectStatus, fakeImage, login, type TestEnv } from "./helpers";

let env: TestEnv;

beforeAll(async () => {
  env = await createTestEnv();
});

afterAll(async () => {
  await env.close();
});

describe("auth", () => {
  it("creates a household with a self member on first login", async () => {
    const session = await login(env, "0521111111");
    expect(session.me.members).toHaveLength(1);
    expect(session.me.members[0]).toMatchObject({ relation: "self", isSelf: true });
    expect(session.me.user.onboardingStep).toBe("family");
    const again = await login(env, "0521111111");
    expect(again.me.householdId).toBe(session.me.householdId);
  });

  it("rejects malformed phones", async () => {
    const res = await env.app.inject({ method: "POST", url: "/v1/auth/otp/request", payload: { phone: "031234567" } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("validation_error");
  });

  it("locks a challenge after 5 wrong codes", async () => {
    const phone = "0522222222";
    expectStatus(await env.app.inject({ method: "POST", url: "/v1/auth/otp/request", payload: { phone } }), 204);
    for (let i = 0; i < 5; i++) {
      const bad = await env.app.inject({ method: "POST", url: "/v1/auth/otp/verify", payload: { phone, code: "000000" } });
      expect(bad.json().error.code).toBe("otp_invalid");
    }
    const code = env.sms.lastCodeFor("+972522222222");
    const locked = await env.app.inject({ method: "POST", url: "/v1/auth/otp/verify", payload: { phone, code } });
    expect(locked.json().error.code).toBe("otp_locked");
  });

  it("rate-limits code requests per phone", async () => {
    const phone = "0523333333";
    for (let i = 0; i < 3; i++) {
      expectStatus(await env.app.inject({ method: "POST", url: "/v1/auth/otp/request", payload: { phone } }), 204);
    }
    const res = await env.app.inject({ method: "POST", url: "/v1/auth/otp/request", payload: { phone } });
    expect(res.statusCode).toBe(429);
  });

  it("rotates refresh tokens and revokes the family on reuse", async () => {
    const session = await login(env, "0524444444");
    const first = expectStatus(
      await env.app.inject({ method: "POST", url: "/v1/auth/refresh", payload: { refreshToken: session.refreshToken } }),
      200,
    );
    const reuse = await env.app.inject({ method: "POST", url: "/v1/auth/refresh", payload: { refreshToken: session.refreshToken } });
    expect(reuse.statusCode).toBe(401);
    const afterTheft = await env.app.inject({ method: "POST", url: "/v1/auth/refresh", payload: { refreshToken: first.refreshToken } });
    expect(afterTheft.statusCode).toBe(401);
  });

  it("requires a valid bearer token", async () => {
    expect((await env.app.inject({ method: "GET", url: "/v1/me" })).statusCode).toBe(401);
    expect((await env.app.inject({ method: "GET", url: "/v1/me", headers: { authorization: "Bearer nope" } })).statusCode).toBe(401);
  });
});

describe("household isolation", () => {
  it("never exposes another household's data", async () => {
    const a = api(env, (await login(env, "0525555555")).token);
    const bSession = await login(env, "0526666666");
    const b = api(env, bSession.token);

    const receipt = expectStatus(await a.upload("/v1/receipts", { data: fakeImage("iso"), mimeType: "image/png" }), 201);
    expect((await b.get(`/v1/receipts/${receipt.id}`)).statusCode).toBe(404);
    expect((await b.delete(`/v1/receipts/${receipt.id}`)).statusCode).toBe(404);

    const aMembers = expectStatus(await a.get("/v1/members"), 200);
    expect((await b.put(`/v1/members/${aMembers[0].id}/enrollments`, { enrollments: [] })).statusCode).toBe(404);
    expect((await b.post("/v1/coverage/simulate", { memberId: aMembers[0].id, category: "dental", amountAgorot: 100 })).statusCode).toBe(404);

    const list = expectStatus(await b.get("/v1/receipts"), 200);
    expect(list).toHaveLength(0);
  });

  it("rejects tampered or expired file links", async () => {
    const a = api(env, (await login(env, "0527777777")).token);
    const receipt = expectStatus(await a.upload("/v1/receipts", { data: fakeImage("link"), mimeType: "image/png" }), 201);
    const url = new URL(receipt.imageUrl);
    const ok = await env.app.inject({ method: "GET", url: `${url.pathname}${url.search}` });
    expect(ok.statusCode).toBe(200);
    expect(ok.headers["cache-control"]).toBe("private, no-store");

    const tampered = url.search.replace(/sig=[0-9a-f]/, (m) => (m.endsWith("0") ? m.slice(0, -1) + "1" : m.slice(0, -1) + "0"));
    expect((await env.app.inject({ method: "GET", url: `${url.pathname}${tampered}` })).statusCode).toBe(403);

    env.clock.advanceDays(1);
    expect((await env.app.inject({ method: "GET", url: `${url.pathname}${url.search}` })).statusCode).toBe(403);
  });

  it("rejects duplicate uploads and unsupported file types", async () => {
    const a = api(env, (await login(env, "0528888888")).token);
    const image = fakeImage("dup");
    expectStatus(await a.upload("/v1/receipts", { data: image, mimeType: "image/png" }), 201);
    expect((await a.upload("/v1/receipts", { data: image, mimeType: "image/png" })).statusCode).toBe(409);
    expect((await a.upload("/v1/receipts", { data: fakeImage("gif"), mimeType: "image/gif" })).statusCode).toBe(415);
  });

  it("protects admin routes", async () => {
    expect((await env.app.inject({ method: "GET", url: "/admin/legs" })).statusCode).toBe(401);
    expect((await env.app.inject({ method: "GET", url: "/admin/legs", headers: { "x-admin-token": "wrong" } })).statusCode).toBe(401);
  });
});

describe("encryption at rest", () => {
  it("stores receipts encrypted", async () => {
    const a = api(env, (await login(env, "0529999999")).token);
    const image = fakeImage("enc");
    const receipt = expectStatus(await a.upload("/v1/receipts", { data: image, mimeType: "image/png" }), 201);
    const [doc] = await env.sql`
      SELECT d.storage_key FROM receipts r JOIN documents d ON d.id = r.document_id WHERE r.id = ${receipt.id}`;
    const stored = await env.deps.storage.get(doc!.storageKey as string);
    expect(stored.includes(image)).toBe(false);
  });
});

describe("quiet hours", () => {
  it("defers non-urgent notifications to 08:00 Israel time", () => {
    // 22:30 in Jerusalem (UTC+3 in summer) = 19:30 UTC
    const late = new Date("2026-07-01T19:30:00Z");
    expect(deliveryTime(late, false).toISOString()).toBe("2026-07-02T05:00:00.000Z");
    expect(deliveryTime(late, true)).toBe(late);
    const noon = new Date("2026-07-01T09:00:00Z");
    expect(deliveryTime(noon, false)).toBe(noon);
  });
});
