import { describe, expect, it } from "vitest";
import { computeFee } from "./fees";
import { canTransitionLeg, deriveSubmittedClaimStatus } from "./claimState";
import { formatILS, ilsToAgorot } from "./money";
import { normalizeIsraeliMobile } from "./api";
import { searchCategories } from "./categories";

describe("computeFee", () => {
  it("15% of what was paid", () => {
    expect(computeFee(28000, false)).toMatchObject({ amountAgorot: 4200, netToUserAgorot: 23800 });
  });
  it("20% on retro claims", () => {
    expect(computeFee(234000, true).amountAgorot).toBe(15000); // capped
    expect(computeFee(50000, true).amountAgorot).toBe(10000);
  });
  it("caps at 150 ₪ per claim", () => {
    expect(computeFee(1_000_000, false).amountAgorot).toBe(15000);
  });
  it("nothing paid, nothing charged", () => {
    expect(computeFee(0, false).amountAgorot).toBe(0);
  });
  it("rejects invalid input", () => {
    expect(() => computeFee(-1, false)).toThrow();
    expect(() => computeFee(1.5, false)).toThrow();
  });
});

describe("leg state machine", () => {
  it("allows the happy path", () => {
    expect(canTransitionLeg("blocked", "ready")).toBe(true);
    expect(canTransitionLeg("ready", "submitted")).toBe(true);
    expect(canTransitionLeg("submitted", "paid")).toBe(true);
    expect(canTransitionLeg("approved", "paid")).toBe(true);
  });
  it("blocks illegal transitions", () => {
    expect(canTransitionLeg("blocked", "paid")).toBe(false);
    expect(canTransitionLeg("paid", "rejected")).toBe(false);
    expect(canTransitionLeg("rejected", "paid")).toBe(false);
    expect(canTransitionLeg("ready", "approved")).toBe(false);
  });
  it("derives claim status", () => {
    expect(deriveSubmittedClaimStatus([{ status: "paid" }, { status: "in_review" }])).toBe("in_progress");
    expect(deriveSubmittedClaimStatus([{ status: "paid" }, { status: "paid" }])).toBe("completed");
    expect(deriveSubmittedClaimStatus([{ status: "paid" }, { status: "rejected" }])).toBe("partially_paid");
    expect(deriveSubmittedClaimStatus([{ status: "rejected" }, { status: "skipped" }])).toBe("rejected");
    expect(deriveSubmittedClaimStatus([{ status: "paid" }, { status: "skipped" }])).toBe("completed");
  });
});

describe("money", () => {
  it("formats agorot as shekels", () => {
    expect(formatILS(17500)).toBe("‏175 ₪");
    expect(formatILS(123450)).toBe("‏1,234.50 ₪");
    expect(formatILS(5)).toBe("‏0.05 ₪");
  });
  it("converts shekels to agorot without float drift", () => {
    expect(ilsToAgorot(182.5)).toBe(18250);
    expect(ilsToAgorot(0.1 + 0.2)).toBe(30);
  });
});

describe("normalizeIsraeliMobile", () => {
  it.each([
    ["050-123-4567", "+972501234567"],
    ["0501234567", "+972501234567"],
    ["+972501234567", "+972501234567"],
    ["972501234567", "+972501234567"],
    ["501234567", "+972501234567"],
  ])("%s", (input, expected) => {
    expect(normalizeIsraeliMobile(input)).toBe(expected);
  });
  it("rejects landlines and junk", () => {
    expect(normalizeIsraeliMobile("031234567")).toBeNull();
    expect(normalizeIsraeliMobile("hello")).toBeNull();
  });
});

describe("searchCategories", () => {
  it("finds categories by keyword", () => {
    expect(searchCategories("פסיכולוג")[0]).toBe("psychology");
    expect(searchCategories("MRI")[0]).toBe("diagnostic_imaging");
    expect(searchCategories("פיזיו")[0]).toBe("physiotherapy");
    expect(searchCategories("")).toEqual([]);
  });
});
