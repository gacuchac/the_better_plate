import { describe, expect, it } from "vitest";
import { calculateRecipe, formatAmount } from "./calculate.ts";
import { ingredientGrams } from "./units.ts";
import type { FoodRecord, NutrientDefinition, RecipeIngredient } from "./types.ts";

// TEST FIXTURES ONLY: synthetic round numbers chosen for arithmetic checks.
// They are not nutrient facts and are never shipped in the catalog.
const fixtureSource = { publisher: "TEST FIXTURE", dataset: "synthetic", url: "about:blank", retrievedAt: "2026-01-01T00:00:00Z" };
const foods = new Map<string, FoodRecord>([
  ["fx:grain", { id: "fx:grain", description: "Fixture grain", nutrientsPer100g: { energy_kcal: 100, protein: 10, iron: 2 }, portions: [{ label: "1 cup", gramWeight: 150 }], source: fixtureSource }],
  ["fx:veg", { id: "fx:veg", description: "Fixture vegetable (no iron reported)", nutrientsPer100g: { energy_kcal: 20, protein: 1 }, portions: [], source: fixtureSource }],
  ["fx:oil", { id: "fx:oil", description: "Fixture oil", nutrientsPer100g: { energy_kcal: 900, protein: 0 }, portions: [{ label: "1 tbsp", gramWeight: 10 }], source: fixtureSource }],
]);
const nutrients: NutrientDefinition[] = [
  { key: "energy_kcal", name: "Energy", unit: "kcal" },
  { key: "protein", name: "Protein", unit: "g" },
  { key: "iron", name: "Iron", unit: "mg" },
  { key: "vitamin_d", name: "Vitamin D", unit: "µg" },
];
const ing = (over: Partial<RecipeIngredient>): RecipeIngredient => ({ id: "i1", foodId: "fx:grain", quantity: 100, unit: "g", role: "ingredient", ...over });
const total = (r: ReturnType<typeof calculateRecipe>, key: string) => r.totals.find((t) => t.key === key)!;

describe("units", () => {
  it("converts exact mass units", () => {
    expect(ingredientGrams(ing({ quantity: 1, unit: "lb" }), foods.get("fx:grain"))).toBeCloseTo(453.59237, 6);
    expect(ingredientGrams(ing({ quantity: 2, unit: "oz" }), foods.get("fx:grain"))).toBeCloseTo(56.69904625, 8);
    expect(ingredientGrams(ing({ quantity: 0.5, unit: "kg" }), foods.get("fx:grain"))).toBe(500);
  });
  it("resolves fractional household portions from the food record", () => {
    expect(ingredientGrams(ing({ quantity: 1.5, unit: "portion", portionIndex: 0 }), foods.get("fx:grain"))).toBe(225);
  });
  it("returns null for an unknown portion", () => {
    expect(ingredientGrams(ing({ unit: "portion", portionIndex: 3 }), foods.get("fx:grain"))).toBeNull();
  });
});

describe("calculateRecipe", () => {
  it("sums ingredients and divides by fractional servings", () => {
    const r = calculateRecipe({ servings: 2.5, ingredients: [ing({ id: "a", quantity: 200 }), ing({ id: "b", foodId: "fx:veg", quantity: 50 })] }, foods, nutrients);
    expect(total(r, "energy_kcal")).toMatchObject({ amount: 210, status: "known" });
    expect(r.perServing.find((t) => t.key === "energy_kcal")!.amount).toBeCloseTo(84, 10);
  });

  it("never treats a missing nutrient as zero", () => {
    const r = calculateRecipe({ servings: 1, ingredients: [ing({ id: "a" }), ing({ id: "b", foodId: "fx:veg" })] }, foods, nutrients);
    expect(total(r, "iron")).toMatchObject({ amount: 2, status: "partial", missingFrom: ["b"] });
    expect(total(r, "vitamin_d")).toMatchObject({ amount: null, status: "unknown" });
  });

  it("counts all oil and discloses it when discard is not measured", () => {
    const r = calculateRecipe({ servings: 1, ingredients: [ing({ id: "o", foodId: "fx:oil", quantity: 2, unit: "portion", portionIndex: 0, role: "cooking_oil" })] }, foods, nutrients);
    expect(total(r, "energy_kcal").amount).toBe(180);
    expect(r.disclosures).toEqual([{ code: "oil_discard_not_measured", ingredientId: "o" }]);
  });

  it("subtracts measured discarded oil (added vs consumed)", () => {
    const r = calculateRecipe({ servings: 1, ingredients: [ing({ id: "o", foodId: "fx:oil", quantity: 20, role: "cooking_oil", oilDiscardedGrams: 5 })] }, foods, nutrients);
    expect(total(r, "energy_kcal").amount).toBe(135);
    expect(r.ingredients[0]).toMatchObject({ grams: 20, countedGrams: 15 });
    expect(r.disclosures).toEqual([]);
  });

  it("does not double count fried-entry oil listed once as cooking oil", () => {
    const fried = calculateRecipe({ servings: 1, ingredients: [ing({ id: "g" }), ing({ id: "o", foodId: "fx:oil", quantity: 10, role: "cooking_oil", oilDiscardedGrams: 0 })] }, foods, nutrients);
    expect(total(fried, "energy_kcal").amount).toBe(190);
  });

  it("flags discard larger than added and counts nothing for that oil", () => {
    const r = calculateRecipe({ servings: 1, ingredients: [ing({ id: "o", foodId: "fx:oil", quantity: 5, role: "cooking_oil", oilDiscardedGrams: 8 })] }, foods, nutrients);
    expect(total(r, "energy_kcal")).toMatchObject({ status: "unknown", amount: null });
    expect(r.disclosures[0]?.code).toBe("oil_discard_exceeds_added");
  });

  it("discloses foods missing from the catalog instead of guessing", () => {
    const r = calculateRecipe({ servings: 1, ingredients: [ing({ id: "x", foodId: "fdc:999999" })] }, foods, nutrients);
    expect(r.disclosures).toEqual([{ code: "food_not_in_catalog", ingredientId: "x" }]);
    expect(total(r, "energy_kcal").amount).toBeNull();
  });

  it("is deterministic", () => {
    const recipe = { servings: 3, ingredients: [ing({ id: "a", quantity: 133.3 }), ing({ id: "b", foodId: "fx:veg", quantity: 77.7 })] };
    expect(calculateRecipe(recipe, foods, nutrients)).toEqual(calculateRecipe(recipe, foods, nutrients));
  });
});

describe("formatAmount", () => {
  it("shows not reported instead of zero", () => {
    expect(formatAmount(null, "mg")).toBe("Not reported");
    expect(formatAmount(0.123, "mg")).toBe("0.12 mg");
    expect(formatAmount(254.6, "kcal")).toBe("255 kcal");
  });
});
