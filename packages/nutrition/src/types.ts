/** Food record as stored in the versioned catalog (values per 100 g, as published by the source). */
export interface FoodPortion {
  label: string;
  gramWeight: number;
}

export interface FoodSource {
  publisher: string;
  dataset: string;
  url: string;
  retrievedAt: string;
  license?: string;
}

export interface FoodRecord {
  id: string;
  fdcId?: number;
  description: string;
  category?: string | null;
  /** Nutrient key -> amount per 100 g. A missing key means "not reported", never zero. */
  nutrientsPer100g: Record<string, number>;
  portions: FoodPortion[];
  source: FoodSource;
}

export interface NutrientDefinition {
  key: string;
  name: string;
  unit: string;
  fdcNutrientId?: number;
}

export type MassUnit = "g" | "kg" | "oz" | "lb";
export type IngredientUnit = MassUnit | "portion";
export type IngredientRole = "ingredient" | "cooking_oil";

export interface RecipeIngredient {
  id: string;
  foodId: string;
  quantity: number;
  unit: IngredientUnit;
  /** Index into the food's portions when unit is "portion". */
  portionIndex?: number | null;
  role: IngredientRole;
  /**
   * Cooking oil only: measured grams of oil discarded after cooking (left in the pan,
   * drained). Null/undefined means not measured, so all added oil is counted as eaten
   * and a disclosure says so. No absorption fraction is ever assumed.
   */
  oilDiscardedGrams?: number | null;
}

export interface RecipeForCalculation {
  servings: number;
  ingredients: RecipeIngredient[];
}

/**
 * known: every counted ingredient reports this nutrient.
 * partial: some do; the amount is a lower bound.
 * unknown: none do; amount is null (never shown as zero).
 */
export type NutrientStatus = "known" | "partial" | "unknown";

export interface NutrientTotal {
  key: string;
  amount: number | null;
  unit: string;
  status: NutrientStatus;
  /** Ingredient ids whose food does not report this nutrient. */
  missingFrom: string[];
}

export type DisclosureCode =
  | "oil_discard_not_measured"
  | "food_not_in_catalog"
  | "portion_not_found"
  | "oil_discard_exceeds_added";

export interface Disclosure {
  code: DisclosureCode;
  ingredientId: string;
}

export interface IngredientBreakdown {
  ingredientId: string;
  foodId: string;
  /** Mass entered for the ingredient (grams), or null when it cannot be resolved. */
  grams: number | null;
  /** Mass counted toward nutrition (oil minus measured discard), or null. */
  countedGrams: number | null;
  /** Nutrient key -> contribution; null when the food does not report it. */
  contributions: Record<string, number | null>;
}

export interface RecipeNutrition {
  engineVersion: string;
  servings: number;
  totals: NutrientTotal[];
  perServing: NutrientTotal[];
  ingredients: IngredientBreakdown[];
  disclosures: Disclosure[];
}
