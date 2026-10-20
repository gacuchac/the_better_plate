import { describe, expect, it } from "vitest";
import type { GoalBody } from "@betterplate/contracts";
import type { DayIntake } from "@betterplate/nutrition";
import type { LocalGoal } from "./localdb.ts";
import { barScale, goalBars } from "./goalBars.ts";

// Labeled test fixture amounts, not food data.
const goal = (id: string, body: Partial<GoalBody>): LocalGoal => ({
  id,
  body: { nutrientKey: "protein", unit: "g", kind: "at_least", min: 100, max: null, period: "day", startDate: "2026-10-01", endDate: null, ...body },
  serverVersion: 1,
  state: "synced",
  updatedAt: "2026-10-01T00:00:00Z",
});
const day = (date: string, protein: number | null, status: "known" | "partial" = "known", kcal: number | null = 500): DayIntake => ({
  date,
  totals: [
    { key: "protein", unit: "g", amount: protein, status: protein === null ? "unknown" : status, mealsMissing: 0, missingFrom: [] },
    { key: "energy_kcal", unit: "kcal", amount: kcal, status: "known", mealsMissing: 0, missingFrom: [] },
  ],
});

describe("eaten against daily goals over a range", () => {
  it("averages logged days only, within the goal's own dates", () => {
    const intake = [day("2026-10-08", 200), day("2026-10-10", 60), day("2026-10-12", 80)];
    const [bar] = goalBars([goal("a", { startDate: "2026-10-10" })], intake, "2026-10-06", "2026-10-12");
    expect(bar).toMatchObject({ amount: 70, daysLogged: 2, status: "below", partial: false });
  });

  it("marks at most and between goals, and keeps unreported as unknown, not zero", () => {
    const intake = [day("2026-10-10", null, "known", 2000)];
    const bars = goalBars(
      [
        goal("kcal", { nutrientKey: "energy_kcal", unit: "kcal", kind: "at_most", min: null, max: 1800 }),
        goal("range", { nutrientKey: "energy_kcal", unit: "kcal", kind: "between", min: 1500, max: 2200 }),
        goal("p", {}),
      ],
      intake,
      "2026-10-10",
      "2026-10-10",
    );
    expect(bars.map((b) => b.status)).toEqual(["above", "met", "no_data"]);
    expect(bars[2]!.amount).toBeNull();
  });

  it("flags partial data and leaves out weekly, monthly, deleted and out-of-range goals", () => {
    const intake = [day("2026-10-10", 50, "partial")];
    const bars = goalBars(
      [goal("p", {}), goal("w", { period: "week" }), goal("m", { period: "month" }), goal("old", { endDate: "2026-10-05" }), { ...goal("d", {}), deleted: true }],
      intake,
      "2026-10-06",
      "2026-10-12",
    );
    expect(bars.map((b) => b.goal.id)).toEqual(["p"]);
    expect(bars[0]!.partial).toBe(true);
  });

  it("scales each bar to the larger of eaten and the goal", () => {
    expect(barScale({ amount: 50, goal: goal("a", {}) })).toBeCloseTo(110);
    expect(barScale({ amount: 300, goal: goal("a", {}) })).toBeCloseTo(330);
    expect(barScale({ amount: null, goal: goal("a", { kind: "between", min: 10, max: 20 }) })).toBeCloseTo(22);
  });
});
