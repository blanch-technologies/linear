import { describe, expect, it } from "vitest";
import { branchName, isCalendarDate, isValidEstimate, orderBetween, priorityRank } from "./index";

describe("issue properties", () => {
  it("orders between neighbors", () => {
    expect(orderBetween(null, null)).toBe(0);
    expect(orderBetween(null, 5)).toBe(-995);
    expect(orderBetween(5, null)).toBe(1005);
    expect(orderBetween(1, 2)).toBe(1.5);
    expect(() => orderBetween(2, 1)).toThrow();
  });

  it("validates dates and estimates", () => {
    expect(isCalendarDate("2026-02-28")).toBe(true);
    expect(isCalendarDate("2026-02-30")).toBe(false);
    expect(isCalendarDate("26-2-3")).toBe(false);
    expect(isValidEstimate("fibonacci", 5)).toBe(true);
    expect(isValidEstimate("fibonacci", 4)).toBe(false);
    expect(isValidEstimate(undefined, 1)).toBe(false);
  });

  it("ranks urgent first and no priority last", () => {
    expect([0, 3, 1, 4, 2].sort((a, b) => priorityRank(a) - priorityRank(b))).toEqual([1, 2, 3, 4, 0]);
  });

  it("makes branch names", () => {
    expect(branchName("ENG-12", "Fix the Sidebar!")).toBe("eng-12-fix-the-sidebar");
    expect(branchName("ENG-12", "x", "ada")).toBe("ada/eng-12-x");
  });
});
