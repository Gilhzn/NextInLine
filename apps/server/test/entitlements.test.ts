import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { api, createTestEnv, expectStatus, fakeImage, login, type TestEnv } from "./helpers";

let env: TestEnv;

beforeAll(async () => {
  env = await createTestEnv();
});

afterAll(async () => {
  await env.close();
});

describe("entitlement overview", () => {
  it("shows every covered service with a worked example, what's missing, and the gaps", async () => {
    const s = await login(env, "0531110001");
    const user = api(env, s.token);
    const selfId = s.me.members[0].id;
    expectStatus(await user.patch(`/v1/members/${selfId}`, { birthDate: "1985-01-01" }), 200);
    expectStatus(
      await user.put(`/v1/members/${selfId}/enrollments`, { enrollments: [{ planId: "maccabi_sheli" }, { planId: "group_harel" }] }),
      200,
    );

    const summary = expectStatus(await user.get("/v1/coverage/summary"), 200);
    const me = summary.members[0];
    const specialist = me.categories.find((c: any) => c.category === "specialist_visit");
    // Fixture: 50% capped at ₪250 per visit, 6 a year. On a ₪650 visit → ₪250.
    expect(specialist.example).toMatchObject({ priceAgorot: 65000, refundAgorot: 25000, legs: [{ amountAgorot: 25000 }] });
    expect(specialist.remaining).toEqual([{ planName: "מכבי שלי", sessions: 6, capAgorot: null }]);
    // Child development is limited to age 18 – not shown for a 41-year-old.
    expect(me.categories.some((c: any) => c.category === "child_development")).toBe(false);
    // Sorted by money.
    const refunds = me.categories.map((c: any) => c.example.refundAgorot);
    expect([...refunds].sort((a, b) => b - a)).toEqual(refunds);

    expect(summary.missingTerms).toEqual([expect.objectContaining({ planId: "group_harel", memberId: selfId })]);
    expect(summary.gaps.map((g: any) => g.category)).toEqual(
      expect.arrayContaining(["diagnostic_imaging", "alternative_medicine", "glasses_lenses", "dental"]),
    );
    expect(summary.gaps.map((g: any) => g.category)).not.toContain("child_development"); // no children

    // Once the user enters the group policy's terms it counts.
    expectStatus(
      await user.put(`/v1/members/${selfId}/enrollments/group_harel/terms`, { category: "dental", rule: { percent: 50, perSessionCapAgorot: 30000 } }),
      200,
    );
    const after = expectStatus(await user.get("/v1/coverage/summary"), 200);
    expect(after.missingTerms).toEqual([]);
    expect(after.gaps.map((g: any) => g.category)).not.toContain("dental");
    expect(after.members[0].categories.find((c: any) => c.category === "dental").example.refundAgorot).toBe(30000);
  });

  it("counts receipts waiting to be claimed", async () => {
    const s = await login(env, "0531110002");
    const user = api(env, s.token);
    const r = expectStatus(await user.upload("/v1/receipts", { data: fakeImage("open"), mimeType: "image/png" }), 201);
    await env.sql`UPDATE receipts SET amount_agorot = 42000 WHERE id = ${r.id}`;
    const summary = expectStatus(await user.get("/v1/coverage/summary"), 200);
    expect(summary.openMoney).toMatchObject({ unclaimedReceipts: 1, unclaimedAgorot: 42000 });
  });
});

describe("3-year estimate", () => {
  it("runs the real rules year by year, so annual limits apply", async () => {
    const s = await login(env, "0531110003");
    const user = api(env, s.token);
    const selfId = s.me.members[0].id;
    expectStatus(await user.put(`/v1/members/${selfId}/enrollments`, { enrollments: [{ planId: "maccabi_sheli" }] }), 200);

    const estimate = expectStatus(
      await user.post("/v1/coverage/estimate", {
        items: [
          // 6 visits → 2 a year, ₪250 each (cap) → ₪500 × 3 years
          { memberId: selfId, category: "specialist_visit", visits: 6, priceAgorot: 65000 },
          // 45 physio sessions → 15 a year, but only 12 a year are covered at ₪60 → ₪720 × 3
          { memberId: selfId, category: "physiotherapy", visits: 45, priceAgorot: 25000 },
          // not covered at all
          { memberId: selfId, category: "dental", visits: 2, priceAgorot: 80000 },
        ],
      }),
      200,
    );
    expect(estimate.items.map((i: any) => i.refundAgorot)).toEqual([150000, 216000, 0]);
    expect(estimate.totalAgorot).toBe(366000);
  });

  it("refuses members of another household", async () => {
    const a = await login(env, "0531110004");
    const b = await login(env, "0531110005");
    expectStatus(
      await api(env, b.token).post("/v1/coverage/estimate", {
        items: [{ memberId: a.me.members[0].id, category: "physiotherapy", visits: 3, priceAgorot: 25000 }],
      }),
      404,
    );
  });
});
