import { describe, it, expect } from "vitest";
import { goalNeed, daysBetween } from "./engine.mjs";

describe("daysBetween", () => {
  it("counts days within the same month", () => {
    expect(daysBetween("2026-01-01", "2026-01-11")).toBe(10);
  });
  it("spans across months and years", () => {
    expect(daysBetween("2025-12-31", "2026-01-01")).toBe(1);
    expect(daysBetween("2026-01-01", "2027-01-01")).toBe(365);
  });
  it("is signed", () => {
    expect(daysBetween("2026-01-11", "2026-01-01")).toBe(-10);
  });
});

describe("goalNeed", () => {
  it("returns null when there is no goal", () => {
    expect(goalNeed(null, 0, "2026-01", 0, 0)).toBeNull();
  });

  it("monthly: needs target minus available", () => {
    const g = { type: "monthly", target: 500 };
    expect(goalNeed(g, 200, "2026-01", 0, 0).need).toBe(300);
    expect(goalNeed(g, 600, "2026-01", 0, 0).need).toBe(0);
  });

  it("monthly: derives target from lastAssigned/avgSpend when target is 0", () => {
    const g = { type: "monthly", target: 0 };
    expect(goalNeed(g, 0, "2026-01", 100, 250).need).toBe(250);
  });

  it("targetBalance: needs target minus available", () => {
    const g = { type: "targetBalance", target: 1000 };
    expect(goalNeed(g, 400, "2026-01", 0, 0).need).toBe(600);
  });

  it("targetByDate: spreads remaining need across months left", () => {
    const g = { type: "targetByDate", target: 1200, target_month: "2026-04" };
    const r = goalNeed(g, 0, "2026-01", 0, 0);
    expect(r.monthsLeft).toBe(4);
    expect(r.need).toBe(300);
  });

  it("targetByDate: never negative need", () => {
    const g = { type: "targetByDate", target: 1200, target_month: "2026-04" };
    const r = goalNeed(g, 2000, "2026-01", 0, 0);
    expect(r.need).toBe(0);
  });
});
