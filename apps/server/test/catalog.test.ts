import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { benefitRuleSchema } from "@magiali/shared";
import { CATALOG_EDITION, SEED_PLANS, seedCatalog } from "../src/catalog";
import { api, createTestEnv, expectStatus, fakeImage, login, type TestEnv } from "./helpers";

describe("researched coverage catalog", () => {
  it("every value is a valid rule with a source link and a confidence level", () => {
    for (const plan of SEED_PLANS) {
      for (const [category, b] of Object.entries(plan.benefits)) {
        expect(() => benefitRuleSchema.parse(b!.rule), `${plan.id}.${category}`).not.toThrow();
        expect(b!.source, `${plan.id}.${category}`).toMatch(/^https:\/\//);
        expect(["official", "secondary"]).toContain(b!.confidence);
      }
    }
  });

  it("lists only refunds: no private policy is marked as a shaban supplement by default", () => {
    expect(SEED_PLANS.filter((p) => p.kind === "shaban").map((p) => p.payerId).sort()).toEqual(
      ["clalit", "clalit", "leumit", "leumit", "maccabi", "maccabi", "meuhedet", "meuhedet"],
    );
  });
});

let env: TestEnv;

beforeAll(async () => {
  env = await createTestEnv();
});

afterAll(async () => {
  await env.close();
});

describe("catalog sync", () => {
  it("publishes a new version only when the edition changes and deactivates retired plans", async () => {
    await seedCatalog(env.sql); // test fixture is current → the researched edition is published again
    const [v1] = await env.sql`SELECT id, notes FROM catalog_versions ORDER BY id DESC LIMIT 1`;
    expect(v1!.notes).toBe(CATALOG_EDITION);
    await seedCatalog(env.sql);
    const [v2] = await env.sql`SELECT id FROM catalog_versions ORDER BY id DESC LIMIT 1`;
    expect(v2!.id).toBe(v1!.id);
    const [retired] = await env.sql`SELECT active FROM plans WHERE id = 'harel_ambulatory'`;
    expect(retired!.active).toBe(false);
    const [row] = await env.sql`
      SELECT confidence, source_note FROM benefits WHERE catalog_version = ${v1!.id as number}
        AND plan_id = 'clalit_mushlam' AND category = 'physiotherapy'`;
    expect(row).toMatchObject({ confidence: "official", sourceNote: expect.stringContaining("https://www.clalit.co.il/") });
  });

  it("the user can enter their own policy terms; routing and the coverage map follow them", async () => {
    const session = await login(env, "0559999999");
    const user = api(env, session.token);
    const selfId = session.me.members[0].id;
    expectStatus(await user.put(`/v1/members/${selfId}/enrollments`, { enrollments: [{ planId: "group_migdal" }] }), 200);

    // A group policy has no catalog values: nothing is covered until the user enters their terms.
    const before = expectStatus(await user.get(`/v1/members/${selfId}/enrollments/group_migdal/terms`), 200);
    expect(before.terms.find((t: any) => t.category === "physiotherapy")).toMatchObject({ catalog: null });

    const terms = expectStatus(
      await user.put(`/v1/members/${selfId}/enrollments/group_migdal/terms`, {
        category: "physiotherapy",
        rule: { percent: 70, perSessionCapAgorot: 15000, annualSessions: 12 },
      }),
      200,
    );
    expect(terms.terms.find((t: any) => t.category === "physiotherapy").custom).toMatchObject({ percent: 70, perSessionCapAgorot: 15000 });

    const map = expectStatus(await user.get("/v1/coverage/map"), 200);
    const physio = map.find((c: any) => c.category === "physiotherapy").members[0].plans[0];
    expect(physio).toMatchObject({ planId: "group_migdal", confidence: "custom" });

    const r = expectStatus(await user.upload("/v1/receipts", { data: fakeImage("physio"), mimeType: "image/png" }), 201);
    await env.runJobs();
    expectStatus(
      await user.patch(`/v1/receipts/${r.id}`, {
        memberId: selfId,
        category: "physiotherapy",
        providerName: "פיזיו פלוס",
        serviceDate: "2026-09-01",
        amountAgorot: 30000,
        sessions: 1,
      }),
      200,
    );
    const claim = expectStatus(await user.post("/v1/claims", { receiptIds: [r.id] }), 201);
    expect(claim.legs.map((l: any) => [l.planId, l.expectedAgorot])).toEqual([["group_migdal", 15000]]);

    // "Not covered by my policy" and back to the catalog.
    expectStatus(await user.put(`/v1/members/${selfId}/enrollments/group_migdal/terms`, { category: "physiotherapy", rule: null }), 200);
    const off = expectStatus(await user.get("/v1/coverage/map"), 200);
    expect(off.find((c: any) => c.category === "physiotherapy")).toBeUndefined();
    const reset = expectStatus(await user.put(`/v1/members/${selfId}/enrollments/group_migdal/terms`, { category: "physiotherapy", rule: "reset" }), 200);
    expect(reset.terms.find((t: any) => t.category === "physiotherapy").custom).toBeUndefined();
  });

  it("refuses another household's policy", async () => {
    const a = await login(env, "0551212121");
    const b = await login(env, "0553434343");
    const memberId = a.me.members[0].id;
    expectStatus(await api(env, a.token).put(`/v1/members/${memberId}/enrollments`, { enrollments: [{ planId: "group_clal" }] }), 200);
    expectStatus(await api(env, b.token).get(`/v1/members/${memberId}/enrollments/group_clal/terms`), 404);
    expectStatus(
      await api(env, b.token).put(`/v1/members/${memberId}/enrollments/group_clal/terms`, { category: "dental", rule: null }),
      404,
    );
  });
});
