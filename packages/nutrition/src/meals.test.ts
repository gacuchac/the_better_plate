import { describe, expect, it } from "vitest";
import { percentDailyValue, scaleTotals, sumMeals } from "./meals.ts";
import type { NutrientTotal } from "./types.ts";

// Labeled test fixture values, not food data.
const t = (key: string, amount: number | null, status: NutrientTotal["status"] = "known", missingFrom: string[] = []): NutrientTotal => ({ key, amount, unit: "mg", status, missingFrom });

describe("meal totals", () => {
  it("scales fractional servings and keeps unknown as unknown", () => {
    const out = scaleTotals([t("iron", 2), t("vitamin_d", null, "unknown", ["a"])], 1.5);
    expect(out[0]!.amount).toBe(3);
    expect(out[1]).toMatchObject({ amount: null, status: "unknown" });
  });

  it("sums a day; a meal missing a nutrient makes the day a lower bound, never zero", () => {
    const day = sumMeals([
      [t("iron", 2), t("vitamin_d", 1)],
      [t("iron", 1), t("vitamin_d", null, "unknown", ["x"])],
    ]);
    expect(day.find((d) => d.key === "iron")).toMatchObject({ amount: 3, status: "known" });
    expect(day.find((d) => d.key === "vitamin_d")).toMatchObject({ amount: 1, status: "partial", mealsMissing: 1 });
  });

  it("an empty day has no totals rather than zeros", () => {
    expect(sumMeals([])).toEqual([]);
  });

  it("all meals unknown stays unknown", () => {
    expect(sumMeals([[t("zinc", null, "unknown", ["a"])]])[0]).toMatchObject({ amount: null, status: "unknown" });
  });
});

describe("percent Daily Value", () => {
  const dvs = [{ key: "iron", amount: 18, unit: "mg" }];
  it("uses the reference when units match", () => {
    expect(percentDailyValue({ key: "iron", amount: 9, unit: "mg" }, dvs)).toBe(50);
  });
  it("returns null with no reference, different units or an unknown amount", () => {
    expect(percentDailyValue({ key: "energy_kcal", amount: 100, unit: "kcal" }, dvs)).toBeNull();
    expect(percentDailyValue({ key: "iron", amount: 9, unit: "g" }, dvs)).toBeNull();
    expect(percentDailyValue({ key: "iron", amount: null, unit: "mg" }, dvs)).toBeNull();
  });
});
