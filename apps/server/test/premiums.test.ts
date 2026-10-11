import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { rowsToPolicies } from "../src/services/policy-import";
import { api, createTestEnv, expectStatus, fakeImage, login, type TestEnv } from "./helpers";

let env: TestEnv;

beforeAll(async () => {
  env = await createTestEnv();
});

afterAll(async () => {
  await env.close();
});

describe("premiums vs. refunds", () => {
  it("puts what each policy cost next to what it returned, and points out overlapping cover", async () => {
    const s = await login(env, "0541250001");
    const user = api(env, s.token);
    const selfId = s.me.members[0].id;
    expectStatus(
      await user.put(`/v1/members/${selfId}/enrollments`, {
        enrollments: [{ planId: "maccabi_sheli" }, { planId: "harel_ambulatory" }, { planId: "group_migdal" }],
      }),
      200,
    );
    // The group policy also covers specialists (terms the user entered) – the same service as Harel.
    expectStatus(
      await user.put(`/v1/members/${selfId}/enrollments/group_migdal/terms`, {
        category: "specialist_visit",
        rule: { percent: 70, perSessionCapAgorot: 30000, annualSessions: 6 },
      }),
      200,
    );

    // A specialist visit, claimed and paid: Maccabi ₪250, Harel ₪400.
    const up = expectStatus(await user.upload("/v1/receipts", { data: fakeImage("premiums"), mimeType: "image/png" }), 201);
    await env.runJobs();
    expectStatus(
      await user.patch(`/v1/receipts/${up.id}`, {
        memberId: selfId,
        category: "specialist_visit",
        providerName: "ד״ר לוי",
        serviceDate: new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10),
        amountAgorot: 65000,
        sessions: 1,
      }),
      200,
    );
    const claim = expectStatus(await user.post("/v1/claims", { receiptIds: [up.id] }), 201);
    await env.sql`UPDATE claim_legs SET status = 'paid', paid_agorot = expected_agorot, paid_at = now() WHERE claim_id = ${claim.id}`;

    let overview = expectStatus(await user.get("/v1/premiums"), 200);
    expect(overview.totals).toMatchObject({ premiumsAgorot: 0, plansWithoutPremium: 3 });
    expect(overview.notes[0]).toContain("הזינו כמה משלמים בחודש");

    expectStatus(await user.put(`/v1/members/${selfId}/enrollments/maccabi_sheli/premium`, { monthlyPremiumAgorot: 3000 }), 204);
    expectStatus(await user.put(`/v1/members/${selfId}/enrollments/harel_ambulatory/premium`, { monthlyPremiumAgorot: 12000 }), 204);

    overview = expectStatus(await user.get("/v1/premiums"), 200);
    const plan = (id: string) => overview.plans.find((p: any) => p.planId === id);
    expect(overview.plans.map((p: any) => p.planId)).toEqual(["maccabi_sheli", "harel_ambulatory", "group_migdal"]);
    expect(plan("maccabi_sheli")).toMatchObject({ monthlyPremiumAgorot: 3000, premiumsAgorot: 36000, refundsAgorot: 25000, servicesUsed: ["רופא מומחה"] });
    expect(plan("harel_ambulatory")).toMatchObject({ monthlyPremiumAgorot: 12000, premiumsAgorot: 144000, refundsAgorot: 40000, servicesCovered: 4 });
    expect(plan("group_migdal")).toMatchObject({ monthlyPremiumAgorot: null, premiumsAgorot: null, servicesCovered: 1 });
    expect(overview.totals).toEqual({ premiumsAgorot: 180000, refundsAgorot: 65000, waitingAgorot: 0, plansWithoutPremium: 1 });
    expect(overview.overlaps).toEqual([
      expect.objectContaining({ label: "רופא מומחה", planNames: ["הראל – שירותים אמבולטוריים", expect.stringContaining("מגדל")] }),
    ]);
    expect(overview.notes.join(" ")).toContain("לא ייעוץ ולא המלצה");
    expect(overview.notes.join(" ")).toContain("כפל ביטוחי");

    // Clearing a premium, and nobody else can set one.
    expectStatus(await user.put(`/v1/members/${selfId}/enrollments/harel_ambulatory/premium`, { monthlyPremiumAgorot: null }), 204);
    expectStatus(await user.put(`/v1/members/${selfId}/enrollments/dental_x/premium`, { monthlyPremiumAgorot: 100 }), 404);
    const other = await login(env, "0541250002");
    expectStatus(await api(env, other.token).put(`/v1/members/${selfId}/enrollments/maccabi_sheli/premium`, { monthlyPremiumAgorot: 1 }), 404);
    const exported = expectStatus(await user.get("/v1/privacy/export"), 200);
    expect(JSON.stringify(exported)).toContain("monthlyPremiumAgorot");
  });

  it("reads premiums from the Har HaBituach report and saves a family policy's premium once", async () => {
    const policies = rowsToPolicies([
      ["חברה", "ענף ראשי", "ענף (משני)", "סוג מוצר", "מספר פוליסה", "פרמיה", "סוג פרמיה"],
      ["הראל", "ביטוח בריאות", "אמבולטורי", "שירותים אמבולטוריים", "1", "120.50", "חודשית"],
      ["כלל", "ביטוח בריאות", "אמבולטורי", "בריאות", "2", "₪1,200", "שנתית"],
      ["מגדל", "ביטוח בריאות", "אמבולטורי", "בריאות", "3", "", ""],
    ])!;
    expect(policies.map((p) => p.monthlyPremiumAgorot)).toEqual([12050, 10000, null]);

    const s = await login(env, "0541250003");
    const user = api(env, s.token);
    const selfId = s.me.members[0].id;
    const child = expectStatus(await user.post("/v1/members", { fullName: "נועה", relation: "child", birthDate: "2020-05-01", guardianDeclared: true }), 201);
    expectStatus(
      await user.post("/v1/coverage/import/apply", {
        memberIds: [selfId, child.id],
        items: [{ planId: "harel_ambulatory", policyNumber: "1", monthlyPremiumAgorot: 12050 }],
      }),
      200,
    );
    const overview = expectStatus(await user.get("/v1/premiums"), 200);
    expect(overview.plans[0].members.map((m: any) => m.monthlyPremiumAgorot)).toEqual([12050, null]);
    expect(overview.plans[0].monthlyPremiumAgorot).toBe(12050);
  });
});
