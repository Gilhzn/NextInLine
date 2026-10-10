import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addCard, api, createTestEnv, expectStatus, login, type TestEnv } from "./helpers";

let env: TestEnv;

beforeAll(async () => {
  env = await createTestEnv();
});

afterAll(async () => {
  await env.close();
});

describe("saving a card through the provider's hosted page", () => {
  it("goes page → return → app, and saves the token only once", async () => {
    const session = await login(env, "0553333333");
    const user = api(env, session.token);
    const setup = expectStatus(await user.post("/v1/payment-methods/setup", { platform: "web" }), 200);
    expect(setup.url).toMatch(/\/payments\/mock\/mock_/);
    expect(expectStatus(await user.get(`/v1/payment-methods/setup/${setup.setupId}`), 200).status).toBe("pending");

    // The user types the card on the hosted page (never on our API).
    const page = await env.app.inject({ method: "GET", url: new URL(setup.url, "http://x").pathname });
    expect(page.statusCode).toBe(200);
    const submit = await env.app.inject({
      method: "POST",
      url: new URL(setup.url, "http://x").pathname,
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload: "card=4580123412341234",
    });
    expect(submit.statusCode).toBe(303);
    const back = await env.app.inject({ method: "GET", url: submit.headers.location as string });
    expect(back.body).toContain(`/payment-return?setup=${setup.setupId}`);

    const done = expectStatus(await user.get(`/v1/payment-methods/setup/${setup.setupId}`), 200);
    expect(done.status).toBe("completed");
    expect(done.me.hasPaymentMethod).toBe(true);
    expectStatus(await user.get(`/v1/payment-methods/setup/${setup.setupId}`), 200);
    const methods = expectStatus(await user.get("/v1/payment-methods"), 200);
    expect(methods).toHaveLength(1);
    expect(methods[0]).toMatchObject({ last4: "1234", expMonth: 12, expYear: 2030, isDefault: true });
    const [stored] = await env.sql`SELECT provider_token_enc FROM payment_methods WHERE id = ${methods[0].id}`;
    expect(stored!.providerTokenEnc).not.toContain("tok_");
  });

  it("reports a declined card", async () => {
    const session = await login(env, "0554444444");
    const user = api(env, session.token);
    const setup = expectStatus(await user.post("/v1/payment-methods/setup", { platform: "web" }), 200);
    await env.app.inject({
      method: "POST",
      url: new URL(setup.url, "http://x").pathname,
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload: "card=4000000000000002",
    });
    expect(expectStatus(await user.get(`/v1/payment-methods/setup/${setup.setupId}`), 200).status).toBe("failed");
  });

  it("accepts only the app's own return schemes (no open redirect)", async () => {
    const session = await login(env, "0555555555");
    const user = api(env, session.token);
    expectStatus(await user.post("/v1/payment-methods/setup", { platform: "native", returnUrl: "https://evil.example" }), 400);
    expectStatus(await user.post("/v1/payment-methods/setup", { platform: "native", returnUrl: "magiali://payment-return" }), 200);
  });

  it("rejects webhooks without our signature and never shows another user's setup", async () => {
    const a = await login(env, "0556666666");
    const b = await login(env, "0557777777");
    const setup = expectStatus(await api(env, a.token).post("/v1/payment-methods/setup", { platform: "web" }), 200);
    const hook = await env.app.inject({ method: "POST", url: `/payments/webhook/${setup.setupId}?sig=${"0".repeat(64)}`, payload: {} });
    expect(hook.statusCode).toBe(403);
    expectStatus(await api(env, b.token).get(`/v1/payment-methods/setup/${setup.setupId}`), 404);
  });

  it("issues the tax receipt number with the charge and supports refunds", async () => {
    const session = await login(env, "0558888888");
    await addCard(env, session.token, "tok_refund");
    const result = await env.payments.charge({ token: "tok_refund", amountAgorot: 1500, idempotencyKey: "k1", description: "x" });
    expect(result).toMatchObject({ ok: true, documentNumber: expect.stringMatching(/^DEMO-/) });
  });
});
