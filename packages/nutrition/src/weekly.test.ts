import { describe, expect, it } from "vitest";
import type { DayIntake, GoalSpec } from "./goals.ts";
import { reviseGoal, rollingWeek } from "./weekly.ts";

// Labeled test fixtures: made-up amounts, not nutrient facts.
const day = (date: string, kcal: number | null, status: "known" | "partial" | "unknown" = "known"): DayIntake => ({
  date,
  totals: [{ key: "energy_kcal", unit: "kcal", amount: kcal, status, missingFrom: [], mealsMissing: status === "unknown" ? 1 : 0 }],
});
const goal = (over: Partial<GoalSpec> = {}): GoalSpec => ({
  nutrientKey: "energy_kcal", unit: "kcal", kind: "at_most", min: null, max: 2000, period: "day", startDate: "2026-11-01", endDate: null, ...over,
});
const TODAY = "2026-11-11"; // window 2026-11-05 .. 2026-11-11

describe("goal history", () => {
  it("ends a goal that was in effect the day before a new amount starts today", () => {
    const r = reviseGoal(goal(), goal({ max: 1800 }), TODAY);
    expect(r).toEqual({ kind: "split", ended: goal({ endDate: "2026-11-10" }), next: goal({ max: 1800, startDate: TODAY }) });
  });

  it("starts the new amount on a later start date the person chose, even a past one", () => {
    const r = reviseGoal(goal(), goal({ max: 1800, startDate: "2026-11-09" }), TODAY);
    expect(r).toMatchObject({ kind: "split", ended: { endDate: "2026-11-08" }, next: { startDate: "2026-11-09", max: 1800 } });
  });

  it("overwrites date-only edits, goals that start today or later, ended goals and earlier starts", () => {
    expect(reviseGoal(goal(), goal({ endDate: "2026-11-20" }), TODAY).kind).toBe("overwrite");
    expect(reviseGoal(goal({ startDate: TODAY }), goal({ startDate: TODAY, max: 1800 }), TODAY).kind).toBe("overwrite");
    expect(reviseGoal(goal({ startDate: "2026-11-20" }), goal({ startDate: "2026-11-20", max: 1800 }), TODAY).kind).toBe("overwrite");
    expect(reviseGoal(goal({ endDate: "2026-11-05" }), goal({ endDate: "2026-11-05", max: 1800 }), TODAY).kind).toBe("overwrite");
    expect(reviseGoal(goal(), goal({ startDate: "2026-10-01", max: 1800 }), TODAY).kind).toBe("overwrite");
  });

  it("keeps the old amount running until a change planned for a later day", () => {
    const r = reviseGoal(goal(), goal({ max: 1800, startDate: "2026-11-20" }), TODAY);
    expect(r).toMatchObject({ kind: "split", ended: { endDate: "2026-11-19", max: 2000 }, next: { startDate: "2026-11-20", max: 1800 } });
  });
});

describe("rolling seven days", () => {
  it("adds each day's goal as it stood that day, not seven times today's", () => {
    // 2000 until Nov 8, 1500 from Nov 9: logged Nov 7, 8, 9, 10 and today.
    const goals = [goal({ endDate: "2026-11-08" }), goal({ max: 1500, startDate: "2026-11-09" })];
    const intake = [day("2026-11-07", 2100), day("2026-11-08", 1900), day("2026-11-09", 1500), day("2026-11-10", 1600), day(TODAY, 700)];
    const w = rollingWeek(goals, intake, TODAY);
    expect(w).toMatchObject({ from: "2026-11-05", to: TODAY, daysLogged: 5 });
    expect(w.lines).toEqual([
      expect.objectContaining({ nutrientKey: "energy_kcal", max: 2000 * 2 + 1500 * 3, min: null, eaten: 7800, days: 5, status: "met", roomLeft: 700, over: null, toGo: null }),
    ]);
  });

  it("leaves out days with nothing logged but always counts today", () => {
    const w = rollingWeek([goal({ kind: "at_least", min: 100, max: null, nutrientKey: "protein", unit: "g" })], [
      { date: "2026-11-06", totals: [{ key: "protein", unit: "g", amount: 120, status: "known", missingFrom: [], mealsMissing: 0 }] },
    ], TODAY);
    expect(w.lines[0]).toMatchObject({ days: 2, min: 200, eaten: 120, status: "below", toGo: 80, roomLeft: null });
  });

  it("only counts days a daily goal applied, and ignores weekly and monthly goals", () => {
    const goals = [goal({ startDate: "2026-11-10" }), goal({ period: "week", max: 14000, nutrientKey: "sodium", unit: "mg" })];
    const w = rollingWeek(goals, [day("2026-11-06", 3000), day("2026-11-10", 2500)], TODAY);
    expect(w.lines).toHaveLength(1);
    expect(w.lines[0]).toMatchObject({ days: 2, max: 4000, eaten: 2500, status: "met", roomLeft: 1500 });
  });

  it("says how far over the week is and keeps unreported amounts unknown", () => {
    const over = rollingWeek([goal()], [day("2026-11-10", 2600), day(TODAY, 1600)], TODAY).lines[0]!;
    expect(over).toMatchObject({ max: 4000, eaten: 4200, status: "above", over: 200, roomLeft: null });
    const unknown = rollingWeek([goal()], [day("2026-11-10", null, "unknown")], TODAY).lines[0]!;
    expect(unknown).toMatchObject({ eaten: 0, partial: true }); // today counts as nothing so far; the logged day is a gap
    const none = rollingWeek([goal()], [day("2026-11-10", null, "unknown"), day(TODAY, null, "unknown")], TODAY).lines[0]!;
    expect(none).toMatchObject({ eaten: null, status: "no_data", toGo: null, roomLeft: null, over: null });
  });

  it("handles a between goal: to go below the lower bound, room under the upper one", () => {
    const g = goal({ kind: "between", min: 1800, max: 2200 });
    expect(rollingWeek([g], [day("2026-11-10", 1700), day(TODAY, 1000)], TODAY).lines[0]).toMatchObject({ min: 3600, max: 4400, toGo: 900, roomLeft: null });
    expect(rollingWeek([g], [day("2026-11-10", 2000), day(TODAY, 1900)], TODAY).lines[0]).toMatchObject({ toGo: null, roomLeft: 500, status: "met" });
  });

  it("uses water intake for water goals when given", () => {
    const water = goal({ nutrientKey: "water", unit: "g", kind: "at_least", min: 2000, max: null });
    const drinks = [{ date: TODAY, totals: [{ key: "water", unit: "g", amount: 1500, status: "known" as const, missingFrom: [], mealsMissing: 0 }] }];
    expect(rollingWeek([water], [], TODAY, { key: "water", intake: drinks }).lines[0]).toMatchObject({ days: 1, min: 2000, eaten: 1500, toGo: 500 });
  });
});
