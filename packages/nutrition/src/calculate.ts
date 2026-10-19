import type {
  Disclosure,
  FoodRecord,
  IngredientBreakdown,
  NutrientDefinition,
  NutrientTotal,
  RecipeForCalculation,
  RecipeNutrition,
} from "./types.ts";
import { ingredientGrams } from "./units.ts";

/** Bump when calculation semantics change; stored with every server-side nutrition snapshot. */
export const ENGINE_VERSION = "1.0.0";

/**
 * Deterministic recipe nutrition. Pure: same inputs, same output, offline or on the server.
 *
 * Rules:
 * - Values come only from the food records passed in (per 100 g).
 * - A nutrient a food does not report is not counted as zero; totals become "partial"
 *   (lower bound) or "unknown" (null).
 * - Cooking oil counts added grams minus measured discarded grams. When discard is not
 *   measured, all added oil is counted and a disclosure is returned.
 * - Ingredients whose mass cannot be resolved contribute nothing and are disclosed.
 */
export function calculateRecipe(
  recipe: RecipeForCalculation,
  foods: ReadonlyMap<string, FoodRecord>,
  nutrients: readonly NutrientDefinition[],
): RecipeNutrition {
  const disclosures: Disclosure[] = [];
  const breakdown: IngredientBreakdown[] = [];

  for (const ingredient of recipe.ingredients) {
    const food = foods.get(ingredient.foodId);
    if (!food) disclosures.push({ code: "food_not_in_catalog", ingredientId: ingredient.id });

    const grams = food ? ingredientGrams(ingredient, food) : null;
    if (food && grams === null) disclosures.push({ code: "portion_not_found", ingredientId: ingredient.id });

    let counted = grams;
    if (grams !== null && ingredient.role === "cooking_oil") {
      const discarded = ingredient.oilDiscardedGrams;
      if (discarded === null || discarded === undefined) {
        disclosures.push({ code: "oil_discard_not_measured", ingredientId: ingredient.id });
      } else if (discarded > grams) {
        disclosures.push({ code: "oil_discard_exceeds_added", ingredientId: ingredient.id });
        counted = 0;
      } else {
        counted = grams - Math.max(0, discarded);
      }
    }

    const contributions: Record<string, number | null> = {};
    for (const n of nutrients) {
      const per100 = food?.nutrientsPer100g[n.key];
      contributions[n.key] = counted !== null && per100 !== undefined ? (per100 * counted) / 100 : null;
    }
    breakdown.push({ ingredientId: ingredient.id, foodId: ingredient.foodId, grams, countedGrams: counted, contributions });
  }

  // Only ingredients with a resolved, positive counted mass decide nutrient coverage.
  const counting = breakdown.filter((b) => b.countedGrams !== null && b.countedGrams > 0);
  const totals: NutrientTotal[] = nutrients.map((n) => {
    let sum = 0;
    const missingFrom: string[] = [];
    for (const b of counting) {
      const value = b.contributions[n.key];
      if (value === null || value === undefined) missingFrom.push(b.ingredientId);
      else sum += value;
    }
    const reported = counting.length - missingFrom.length;
    const status = counting.length === 0 || reported === 0 ? "unknown" : missingFrom.length ? "partial" : "known";
    return { key: n.key, unit: n.unit, amount: status === "unknown" ? null : sum, status, missingFrom };
  });

  const servings = recipe.servings > 0 ? recipe.servings : 1;
  const perServing = totals.map((t) => ({ ...t, amount: t.amount === null ? null : t.amount / servings }));

  return { engineVersion: ENGINE_VERSION, servings, totals, perServing, ingredients: breakdown, disclosures };
}

/** Display rounding only; never round before summing. */
export function formatAmount(amount: number | null, unit: string): string {
  if (amount === null) return "Not reported";
  const abs = Math.abs(amount);
  const digits = abs >= 100 ? 0 : abs >= 10 ? 1 : abs >= 1 ? 1 : 2;
  return `${amount.toFixed(digits)} ${unit}`;
}
