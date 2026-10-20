import { describe, expect, it } from "vitest";
import { dayCount, goalProblem, goalProgress, periodWindow, shiftDate, summarizePeriod, type DayIntake, type GoalSpec } from "./goals.ts";

// Labeled test fixtures: made-up amounts, not nutrient facts.
const day = (date: string, protein: number | null, status: "known" | "partial" | "unknown" = "known", sodium?: number): DayIntake => ({
  date,
  totals: [
    { key: "protein", unit: "g", amount: protein, status, missingFrom: [], mealsMissing: status === "unknown" ? 1 : 0 },
    ...(sodium === undefined ? [] : [{ key: "sodium", unit: "mg", amount: sodium, status: "known" as const, missingFrom: [], mealsMissing: 0 }]),
  ],
});

describe("calendar periods", () => {
  it("finds days, Monday-to-Sunday weeks and months", () => {
    expect(shiftDate("2026-02-28", 1)).toBe("2026-03-01");
    expect(dayCount("2026-10-01", "2026-10-31")).toBe(31);
    expect(dayCount("2026-10-02", "2026-10-01")).toBe(0);
    expect(periodWindow("day", "2026-10-20")).toEqual({ from: "2026-10-20", to: "2026-10-20" });
    expect(periodWindow("week", "2026-10-20")).toEqual({ from: "2026-10-19", to: "2026-10-25" }); // a Tuesday
    expect(periodWindow("week", "2026-10-25")).toEqual({ from: "2026-10-19", to: "2026-10-25" }); // Sunday
    expect(periodWindow("month", "2028-02-10")).toEqual({ from: "2028-02-01", to: "2028-02-29" });
  });
});

describe("period summary", () => {
  it("adds only logged days, averages per logged day and says when days are missing", () => {
    const s = summarizePeriod([day("2026-10-18", 80), day("2026-10-19", 100, "known", 2000), day("2026-10-30", 500)], "2026-10-14", "2026-10-20");
    expect(s).toMatchObject({ days: 7, daysLogged: 2, incomplete: true });
    expect(s.nutrients.find((n) => n.key === "protein")).toMatchObject({ total: 180, averagePerLoggedDay: 90, status: "known" });
    expect(s.nutrients.find((n) => n.key === "sodium")).toMatchObject({ total: 2000, status: "known" });
  });

  it("keeps unreported nutrients unknown, never zero, and marks gaps as partial", () => {
    const s = summarizePeriod([day("2026-10-19", null, "unknown"), day("2026-10-20", 30, "partial")], "2026-10-19", "2026-10-20");
    expect(s.incomplete).toBe(false);
    expect(s.nutrients[0]).toMatchObject({ total: 30, status: "partial" });
    expect(summarizePeriod([day("2026-10-19", null, "unknown")], "2026-10-19", "2026-10-19").nutrients[0]).toMatchObject({ total: null, averagePerLoggedDay: null, status: "unknown" });
    expect(summarizePeriod([], "2026-10-19", "2026-10-25")).toMatchObject({ daysLogged: 0, incomplete: true, nutrients: [] });
  });
});

describe("goals", () => {
  const daily: GoalSpec = { nutrientKey: "protein", unit: "g", kind: "at_least", min: 100, max: null, period: "day", startDate: "2026-10-15", endDate: null };

  it("tracks a daily goal and counts ended days that met it", () => {
    const intake = [day("2026-10-16", 120), day("2026-10-17", 90), day("2026-10-19", 100), day("2026-10-20", 40)];
    const p = goalProgress(daily, intake, "2026-10-20");
    expect(p.state).toBe("active");
    expect(p.current).toMatchObject({ from: "2026-10-20", amount: 40, status: "below", inProgress: true, daysLogged: 1 });
    // Ended days back to the start date: 19 met, 18 nothing logged, 17 below, 16 met, 15 nothing logged.
    expect(p.past.map((w) => [w.from, w.status])).toEqual([
      ["2026-10-19", "met"],
      ["2026-10-18", "no_data"],
      ["2026-10-17", "below"],
      ["2026-10-16", "met"],
      ["2026-10-15", "no_data"],
    ]);
    expect(p.pastMet).toBe(2);
  });

  it("keeps weekly and monthly windows inside the goal's own dates", () => {
    const weekly: GoalSpec = { nutrientKey: "sodium", unit: "mg", kind: "at_most", min: null, max: 10_000, period: "week", startDate: "2026-10-21", endDate: "2026-11-03" };
    const intake = [day("2026-10-20", 50, "known", 9000), day("2026-10-21", 50, "known", 6000), day("2026-10-22", 50, "known", 5000)];
    const p = goalProgress(weekly, intake, "2026-10-22");
    // The week is Mon 19–Sun 25, but the goal starts on the 21st, so the 20th doesn't count.
    expect(p.current).toMatchObject({ from: "2026-10-21", to: "2026-10-25", amount: 11_000, status: "above", inProgress: true, days: 5, daysLogged: 2 });
    expect(p.past).toEqual([]);
    const ended = goalProgress(weekly, intake, "2026-11-10");
    expect(ended.state).toBe("ended");
    expect(ended.current).toMatchObject({ from: "2026-11-02", to: "2026-11-03", status: "no_data", inProgress: false });
    expect(goalProgress(weekly, intake, "2026-10-01")).toMatchObject({ state: "upcoming", current: { from: "2026-10-21", to: "2026-10-25" } });

    const range: GoalSpec = { nutrientKey: "protein", unit: "g", kind: "between", min: 100, max: 200, period: "month", startDate: "2026-10-01", endDate: null };
    expect(goalProgress(range, intake, "2026-10-22").current).toMatchObject({ from: "2026-10-01", to: "2026-10-31", amount: 150, status: "met", inProgress: true });
  });

  it("flags lower-bound amounts when some meals don't report the nutrient", () => {
    const p = goalProgress(daily, [day("2026-10-20", 60, "partial")], "2026-10-20");
    expect(p.current).toMatchObject({ amount: 60, status: "below", partialData: true });
  });

  it("checks the goal's own numbers and dates", () => {
    expect(goalProblem(daily)).toBeNull();
    expect(goalProblem({ ...daily, min: null })).toBe("Set the lower amount");
    expect(goalProblem({ ...daily, max: 5 })).toBe("This kind of goal has no upper amount");
    expect(goalProblem({ kind: "between", min: 10, max: 5, startDate: "2026-10-01", endDate: null })).toBe("The lower amount must not be above the upper amount");
    expect(goalProblem({ ...daily, endDate: "2026-10-01" })).toBe("The end date must be on or after the start date");
  });
});
