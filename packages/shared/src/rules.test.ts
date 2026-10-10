import { describe, expect, it } from "vitest";
import { computeRouting, type RoutingEnrollment, type BenefitRule } from "./rules";

function rule(partial: Partial<BenefitRule>): BenefitRule {
  return {
    percent: 0,
    perSessionCapAgorot: null,
    perSessionFixedAgorot: null,
    annualCapAgorot: null,
    annualSessions: null,
    deductibleAgorot: 0,
    requiredDocs: ["receipt"],
    minAge: null,
    maxAge: null,
    ...partial,
  };
}

const shaban = (benefits: RoutingEnrollment["benefits"]): RoutingEnrollment => ({
  planId: "maccabi_sheli",
  planName: "מכבי שלי",
  payerId: "maccabi",
  planKind: "shaban",
  isShabanSupplement: false,
  validFrom: "2020-01-01",
  validTo: null,
  benefits,
});

const supplement = (benefits: RoutingEnrollment["benefits"]): RoutingEnrollment => ({
  planId: "harel_ambulatory",
  planName: "הראל",
  payerId: "harel",
  planKind: "private_individual",
  isShabanSupplement: true,
  validFrom: "2020-01-01",
  validTo: null,
  benefits,
});

const group = (benefits: RoutingEnrollment["benefits"]): RoutingEnrollment => ({
  planId: "group_generic",
  planName: "ביטוח קבוצתי",
  payerId: "migdal",
  planKind: "private_group",
  isShabanSupplement: false,
  validFrom: "2020-01-01",
  validTo: null,
  benefits,
});

const base = { sessions: 1, serviceDate: "2026-09-12" } as const;

describe("computeRouting", () => {
  it("shaban only at 50%", () => {
    const r = computeRouting({
      ...base,
      category: "child_development",
      amountAgorot: 35000,
      enrollments: [shaban({ child_development: rule({ percent: 50 }) })],
    });
    expect(r.legs).toHaveLength(1);
    expect(r.legs[0]!.expectedAgorot).toBe(17500);
    expect(r.uncoveredAgorot).toBe(17500);
  });

  it("supplement pays a percent of the remainder after shaban (350 = 175 + 105)", () => {
    const r = computeRouting({
      ...base,
      category: "child_development",
      amountAgorot: 35000,
      // listed out of order on purpose: routing must put shaban first
      enrollments: [
        supplement({ child_development: rule({ percent: 60 }) }),
        shaban({ child_development: rule({ percent: 50 }) }),
      ],
    });
    expect(r.legs.map((l) => [l.planId, l.expectedAgorot])).toEqual([
      ["maccabi_sheli", 17500],
      ["harel_ambulatory", 10500],
    ]);
    expect(r.totalExpectedAgorot).toBe(28000);
    expect(r.legs[1]!.requiredDocs).toContain("payer_payment_proof");
    expect(r.legs[0]!.requiredDocs).not.toContain("payer_payment_proof");
  });

  it("fixed per-session amount + group 50% of the remainder (psychologist 450 = 85 + 182.50)", () => {
    const r = computeRouting({
      ...base,
      category: "psychology",
      amountAgorot: 45000,
      enrollments: [
        shaban({ psychology: rule({ perSessionFixedAgorot: 8500, annualSessions: 12 }) }),
        group({ psychology: rule({ percent: 50, perSessionCapAgorot: 40000 }) }),
      ],
    });
    expect(r.legs.map((l) => l.expectedAgorot)).toEqual([8500, 18250]);
  });

  it("exhausted session quota skips the shaban and lets the private plan pay on the full amount", () => {
    const r = computeRouting({
      ...base,
      category: "physiotherapy",
      amountAgorot: 30000,
      enrollments: [
        shaban({ physiotherapy: rule({ percent: 50, annualSessions: 12 }) }),
        supplement({ physiotherapy: rule({ percent: 80 }) }),
      ],
      usage: { "maccabi_sheli:physiotherapy": { sessions: 12, amountAgorot: 0 } },
    });
    expect(r.legs).toHaveLength(1);
    expect(r.legs[0]!.planId).toBe("harel_ambulatory");
    expect(r.legs[0]!.expectedAgorot).toBe(24000);
    expect(r.notes.join(" ")).toContain("נוצלו כל 12");
  });

  it("partial session quota pays proportionally", () => {
    const r = computeRouting({
      category: "physiotherapy",
      amountAgorot: 120000,
      sessions: 4,
      serviceDate: "2026-09-12",
      enrollments: [shaban({ physiotherapy: rule({ percent: 50, annualSessions: 12 }) })],
      usage: { "maccabi_sheli:physiotherapy": { sessions: 10, amountAgorot: 0 } },
    });
    // 50% of 1200 = 600, only 2 of 4 sessions eligible -> 300
    expect(r.legs[0]!.expectedAgorot).toBe(30000);
  });

  it("annual cap trims to what is left", () => {
    const r = computeRouting({
      ...base,
      category: "diagnostic_imaging",
      amountAgorot: 200000,
      enrollments: [supplement({ diagnostic_imaging: rule({ percent: 100, annualCapAgorot: 308000 }) })],
      usage: { "harel_ambulatory:diagnostic_imaging": { sessions: 1, amountAgorot: 250000 } },
    });
    expect(r.legs[0]!.expectedAgorot).toBe(58000);
  });

  it("per-session cap limits the amount", () => {
    const r = computeRouting({
      category: "specialist_visit",
      amountAgorot: 90000,
      sessions: 1,
      serviceDate: "2026-09-12",
      enrollments: [shaban({ specialist_visit: rule({ percent: 75, perSessionCapAgorot: 30000 }) })],
    });
    expect(r.legs[0]!.expectedAgorot).toBe(30000);
  });

  it("filters enrollments outside their validity window", () => {
    const expired = { ...shaban({ specialist_visit: rule({ percent: 75 }) }), validTo: "2025-12-31" };
    const r = computeRouting({ ...base, category: "specialist_visit", amountAgorot: 50000, enrollments: [expired] });
    expect(r.legs).toHaveLength(0);
    expect(r.uncoveredAgorot).toBe(50000);
  });

  it("applies age limits", () => {
    const r = computeRouting({
      ...base,
      category: "child_development",
      amountAgorot: 35000,
      memberBirthDate: "2007-01-01",
      enrollments: [shaban({ child_development: rule({ percent: 50, maxAge: 18 }) })],
    });
    expect(r.legs).toHaveLength(0);
    expect(r.notes[0]).toContain("בגיל 19");
  });

  it("deductible reduces the payout and never goes negative", () => {
    const r = computeRouting({
      ...base,
      category: "specialist_visit",
      amountAgorot: 10000,
      enrollments: [shaban({ specialist_visit: rule({ percent: 50, deductibleAgorot: 6000 }) })],
    });
    expect(r.legs).toHaveLength(0);
  });

  it("excluded plans are skipped (e.g. after a rejection)", () => {
    const r = computeRouting({
      ...base,
      category: "child_development",
      amountAgorot: 35000,
      excludePlanIds: ["maccabi_sheli"],
      enrollments: [
        shaban({ child_development: rule({ percent: 50 }) }),
        supplement({ child_development: rule({ percent: 60 }) }),
      ],
    });
    expect(r.legs.map((l) => [l.planId, l.expectedAgorot])).toEqual([["harel_ambulatory", 21000]]);
  });

  it("is deterministic and floors to the agora", () => {
    const input = {
      ...base,
      category: "specialist_visit" as const,
      amountAgorot: 33333,
      enrollments: [shaban({ specialist_visit: rule({ percent: 33 }) })],
    };
    const a = computeRouting(input);
    const b = computeRouting(input);
    expect(a).toEqual(b);
    expect(a.legs[0]!.expectedAgorot).toBe(10999);
  });

  it("rejects non-positive amounts", () => {
    expect(() =>
      computeRouting({ ...base, category: "specialist_visit", amountAgorot: 0, enrollments: [] }),
    ).toThrow();
  });
});
