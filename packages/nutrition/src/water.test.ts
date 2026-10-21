import { describe, expect, it } from "vitest";
import type { DayIntake } from "./goals.ts";
import { goalProgress } from "./goals.ts";
import { waterDays, waterIntake } from "./water.ts";

// Labeled test fixtures: made-up amounts, not nutrient facts.
const ate = (date: string, water: number | null, status: "known" | "partial" | "unknown" = "known"): DayIntake => ({
  date,
  totals: [{ key: "water", unit: "g", amount: water, status, missingFrom: [], mealsMissing: status === "unknown" ? 1 : 0 }],
});

describe("water", () => {
  it("keeps drinks and water in food apart per day", () => {
    const days = waterDays([ate("2026-10-20", 400)], [
      { localDate: "2026-10-20", amountMl: 250 },
      { localDate: "2026-10-20", amountMl: 250 },
      { localDate: "2026-10-21", amountMl: 500 },
    ]);
    expect(days).toEqual([
      { date: "2026-10-20", drinksMl: 500, foodMl: 400, foodPartial: false },
      { date: "2026-10-21", drinksMl: 500, foodMl: null, foodPartial: false },
    ]);
  });

  it("adds both for goals, keeps unreported food water partial and never zero", () => {
    const intake = waterIntake([ate("2026-10-20", 300, "partial"), ate("2026-10-22", null, "unknown")], [{ localDate: "2026-10-20", amountMl: 1000 }, { localDate: "2026-10-21", amountMl: 750 }]);
    expect(intake.map((d) => [d.date, d.totals[0]!.amount, d.totals[0]!.status])).toEqual([
      ["2026-10-20", 1300, "partial"],
      ["2026-10-21", 750, "known"],
      ["2026-10-22", null, "unknown"],
    ]);
    const goal = { nutrientKey: "water", unit: "g", kind: "at_least" as const, min: 2000, max: null, period: "day" as const, startDate: "2026-10-01", endDate: null };
    expect(goalProgress(goal, intake, "2026-10-21").current).toMatchObject({ amount: 750, status: "below" });
  });
});
