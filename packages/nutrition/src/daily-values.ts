import type { DailyValue } from "./meals.ts";

/**
 * FDA reference Daily Values used on U.S. Nutrition Facts labels (21 CFR 101.9), copied from
 * the FDA page below. Reference amounts for label percentages, not personal targets.
 * Calories (no FDA Daily Value) and total sugars (FDA's value covers added sugars only)
 * are deliberately left out.
 */
export const DAILY_VALUE_SOURCE = {
  publisher: "U.S. Food and Drug Administration",
  title: "Daily Value on the Nutrition and Supplement Facts Labels",
  url: "https://www.fda.gov/food/nutrition-facts-label/daily-value-nutrition-and-supplement-facts-labels",
  contentCurrentAsOf: "2024-03-05",
  retrievedAt: "2026-10-19",
} as const;

export const FDA_DAILY_VALUES: DailyValue[] = [
  { key: "protein", amount: 50, unit: "g" },
  { key: "fat_total", amount: 78, unit: "g" },
  { key: "fat_saturated", amount: 20, unit: "g" },
  { key: "carbohydrate", amount: 275, unit: "g" },
  { key: "fiber", amount: 28, unit: "g" },
  { key: "cholesterol", amount: 300, unit: "mg" },
  { key: "sodium", amount: 2300, unit: "mg" },
  { key: "potassium", amount: 4700, unit: "mg" },
  { key: "calcium", amount: 1300, unit: "mg" },
  { key: "iron", amount: 18, unit: "mg" },
  { key: "magnesium", amount: 420, unit: "mg" },
  { key: "zinc", amount: 11, unit: "mg" },
  { key: "vitamin_c", amount: 90, unit: "mg" },
  { key: "vitamin_a_rae", amount: 900, unit: "µg" },
  { key: "vitamin_d", amount: 20, unit: "µg" },
  { key: "vitamin_b12", amount: 2.4, unit: "µg" },
  { key: "folate_dfe", amount: 400, unit: "µg" },
];
