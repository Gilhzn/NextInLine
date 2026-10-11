import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { remindUnusedQuotas } from "../src/services/maintenance";
import { api, createTestEnv, expectStatus, fakeImage, login, type TestEnv } from "./helpers";

let env: TestEnv;

beforeAll(async () => {
  env = await createTestEnv();
});

afterAll(async () => {
  await env.close();
});

const isoDay = (d: Date) => d.toISOString().slice(0, 10);

async function receipt(user: ReturnType<typeof api>, memberId: string, r: { category: string; amount: number; date: string }) {
  const up = expectStatus(await user.upload("/v1/receipts", { data: fakeImage(`${r.category}${r.date}${r.amount}`), mimeType: "image/png" }), 201);
  await env.runJobs();
  expectStatus(
    await user.patch(`/v1/receipts/${up.id}`, { memberId, category: r.category, providerName: "מטפל", serviceDate: r.date, amountAgorot: r.amount, sessions: 1 }),
    200,
  );
}

describe("before booking", () => {
  it("compares places by what the family really pays, and says what to arrange first", async () => {
    const s = await login(env, "0541240001");
    const user = api(env, s.token);
    const selfId = s.me.members[0].id;
    expectStatus(
      await user.put(`/v1/members/${selfId}/enrollments`, { enrollments: [{ planId: "maccabi_sheli" }, { planId: "harel_ambulatory" }] }),
      200,
    );

    // No options: one private visit at a typical price, plus everything to know before booking.
    const first = expectStatus(await user.post("/v1/before-booking", { memberId: selfId, category: "specialist_visit" }), 200);
    expect(first).toMatchObject({ covered: true, suggestedFrom: "typical", history: null, renewsOn: null });
    expect(first.options).toHaveLength(1);
    // Shaban: 50% up to ₪250. Harel: 80% of the full price up to ₪500, at most what is left. Max ₪750 from ₪750.
    expect(first.maxRefund).toEqual({ refundAgorot: 75000, fromPriceAgorot: 75000 });
    expect(first.quota).toEqual([
      { planName: "מכבי שלי", perYear: 6, sessionsLeft: 6, capLeftAgorot: null },
      { planName: "הראל – שירותים אמבולטוריים", perYear: 3, sessionsLeft: 3, capLeftAgorot: null },
    ]);
    expect(first.checklist.join("\n")).toContain("הפניה מרופא המשפחה – הראל");
    expect(first.checklist.join("\n")).toContain("קודם מגישים למכבי שלי");

    const cmp = expectStatus(
      await user.post("/v1/before-booking", {
        memberId: selfId,
        category: "specialist_visit",
        options: [
          { label: "ד״ר כהן", priceAgorot: 120000 },
          { label: "ד״ר לוי", priceAgorot: 65000 },
          { label: "בהסדר", priceAgorot: 10000, kind: "network" },
        ],
      }),
      200,
    );
    expect(cmp.options.map((o: any) => [o.label, o.refundAgorot, o.netAgorot, o.best])).toEqual([
      ["ד״ר כהן", 75000, 45000, false],
      ["ד״ר לוי", 65000, 0, true],
      ["בהסדר", 0, 10000, false],
    ]);
    expect(cmp.checklist.join("\n")).toContain("ההחזר כבר לא גדל");

    // More sessions than the quota has left.
    const many = expectStatus(await user.post("/v1/before-booking", { memberId: selfId, category: "specialist_visit", sessions: 5 }), 200);
    expect(many.checklist.join("\n")).toContain("נשארו השנה רק 3 מפגשים");

    // The family's own price wins over the typical one once there are receipts.
    await receipt(user, selfId, { category: "specialist_visit", amount: 90000, date: isoDay(new Date(Date.now() - 20 * 86_400_000)) });
    const again = expectStatus(await user.post("/v1/before-booking", { memberId: selfId, category: "specialist_visit" }), 200);
    expect(again).toMatchObject({ suggestedFrom: "history", suggestedPriceAgorot: 90000, history: { visits: 1, avgPriceAgorot: 90000 } });

    // Not covered: says so, and points to in-network care.
    const dental = expectStatus(await user.post("/v1/before-booking", { memberId: selfId, category: "dental" }), 200);
    expect(dental).toMatchObject({ covered: false, maxRefund: null, quota: [] });
    expect(dental.options[0].refundAgorot).toBe(0);
    expect(dental.checklist.join("\n")).toContain("לא מצאנו כיסוי");

    // Someone else's family member.
    const other = await login(env, "0541240002");
    expectStatus(await api(env, other.token).post("/v1/before-booking", { memberId: selfId, category: "dental" }), 404);
  });
});

describe("year-end quota reminders", () => {
  it("reminds once per wave about quotas the family actually uses", async () => {
    // A November date that is not in the future (receipts can't be).
    const real = new Date();
    const year = real.getUTCMonth() === 11 || (real.getUTCMonth() === 10 && real.getUTCDate() >= 20) ? real.getUTCFullYear() : real.getUTCFullYear() - 1;
    const november = new Date(Date.UTC(year, 10, 20, 8));
    const s = await login(env, "0541240003");
    const user = api(env, s.token);
    const selfId = s.me.members[0].id;
    expectStatus(await user.put(`/v1/members/${selfId}/enrollments`, { enrollments: [{ planId: "maccabi_sheli" }] }), 200);
    await receipt(user, selfId, { category: "physiotherapy", amount: 25000, date: isoDay(new Date(november.getTime() - 30 * 86_400_000)) });

    const at = (d: Date) => ({ ...env.deps, now: () => d });
    expect(await remindUnusedQuotas(at(new Date(Date.UTC(year, 9, 1))))).toBe(0); // October: too early
    await remindUnusedQuotas(at(november));
    await remindUnusedQuotas(at(november));
    const sent = await env.sql`SELECT title, body, data FROM notifications WHERE user_id = ${s.me.user.id} AND type = 'quota_reminder'`;
    expect(sent).toHaveLength(1);
    // 12 physiotherapy sessions a year, ₪60 back for each.
    expect(sent[0]!.title).toContain("720");
    expect(sent[0]!.body).toContain("12 פיזיותרפיה");
    expect(sent[0]!.data).toMatchObject({ screen: "/money" });

    // Second wave in December.
    await remindUnusedQuotas(at(new Date(Date.UTC(year, 11, 6, 8))));
    const [{ n }] = (await env.sql`SELECT count(*)::int AS n FROM notifications WHERE user_id = ${s.me.user.id} AND type = 'quota_reminder'`) as any;
    expect(n).toBe(2);
  });
});
