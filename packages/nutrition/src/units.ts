import type { FoodRecord, MassUnit, RecipeIngredient } from "./types.ts";

/** Exact definitions: international avoirdupois pound (1959) and ounce. */
export const GRAMS_PER_UNIT: Record<MassUnit, number> = {
  g: 1,
  kg: 1000,
  oz: 28.349523125,
  lb: 453.59237,
};

export function isMassUnit(unit: string): unit is MassUnit {
  return unit in GRAMS_PER_UNIT;
}

/** Grams for an ingredient amount, or null when a portion cannot be resolved. */
export function ingredientGrams(ingredient: RecipeIngredient, food: FoodRecord | undefined): number | null {
  if (!Number.isFinite(ingredient.quantity) || ingredient.quantity < 0) return null;
  if (isMassUnit(ingredient.unit)) return ingredient.quantity * GRAMS_PER_UNIT[ingredient.unit];
  if (ingredient.unit === "portion") {
    const index = ingredient.portionIndex ?? -1;
    const portion = food?.portions[index];
    return portion ? ingredient.quantity * portion.gramWeight : null;
  }
  return null;
}
