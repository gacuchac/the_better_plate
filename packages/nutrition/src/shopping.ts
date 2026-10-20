import type { FoodRecord, RecipeForCalculation } from "./types.ts";
import { ingredientGrams } from "./units.ts";

/** One planned meal to shop for: the recipe as it is now, scaled from its servings to the servings planned. */
export interface ShoppingPlan {
  planId: string;
  date: string;
  title: string;
  servings: number;
  /** Null when the recipe is no longer available (deleted, or not on this device). */
  recipe: RecipeForCalculation | null;
}

export interface ShoppingItem {
  foodId: string;
  description: string;
  category: string | null;
  /** Grams to buy across all plans; null when no amount could be worked out. */
  grams: number | null;
  /** Amounts that could not be turned into grams (a portion the food no longer lists). */
  unresolved: number;
  /** Cooking oil: what goes in the pan, including what is later discarded. */
  oil: boolean;
  /** The recipe lists the food already cooked ("Rice, ..., cooked"); people buy it raw, so the weight differs. */
  preparedForm: boolean;
  /** Titles of the planned recipes that use it, in order of first use. */
  recipes: string[];
}

export interface ShoppingList {
  items: ShoppingItem[];
  /** Plans counted. */
  plans: number;
  /** Plans whose recipe is unavailable, so their ingredients are not listed. */
  missing: { planId: string; date: string; title: string }[];
  /** Ingredients whose food is not in the catalog. */
  unknownFoods: string[];
}

const PREPARED = /\b(cooked|boiled|steamed|roasted|baked|fried|grilled|broiled|braised|stewed|microwaved|poached|simmered|toasted|scrambled|sauteed|stir-fried)\b/i;

/** True when a catalog description names a cooked form of the food. */
export const isPreparedForm = (description: string) => PREPARED.test(description);

/**
 * Adds up what to buy for a set of planned meals. Pure and deterministic, so the device and the
 * server give the same list. Amounts are recipe grams × servings planned ÷ recipe servings;
 * oil counts what is added, since that is what is bought. Nothing is rounded here.
 */
export function buildShoppingList(plans: readonly ShoppingPlan[], foods: ReadonlyMap<string, FoodRecord>): ShoppingList {
  const items = new Map<string, ShoppingItem>();
  const missing: ShoppingList["missing"] = [];
  const unknown = new Set<string>();
  let counted = 0;

  for (const plan of plans) {
    if (!plan.recipe) {
      missing.push({ planId: plan.planId, date: plan.date, title: plan.title });
      continue;
    }
    counted += 1;
    const scale = plan.recipe.servings > 0 ? plan.servings / plan.recipe.servings : plan.servings;
    for (const ingredient of plan.recipe.ingredients) {
      const food = foods.get(ingredient.foodId);
      if (!food) {
        unknown.add(ingredient.foodId);
        continue;
      }
      let item = items.get(food.id);
      if (!item) {
        item = {
          foodId: food.id,
          description: food.description,
          category: food.category ?? null,
          grams: null,
          unresolved: 0,
          oil: false,
          preparedForm: isPreparedForm(food.description),
          recipes: [],
        };
        items.set(food.id, item);
      }
      const grams = ingredientGrams(ingredient, food);
      if (grams === null) item.unresolved += 1;
      else item.grams = (item.grams ?? 0) + grams * scale;
      if (ingredient.role === "cooking_oil") item.oil = true;
      if (!item.recipes.includes(plan.title)) item.recipes.push(plan.title);
    }
  }

  const sorted = [...items.values()].sort(
    (a, b) => (a.category ?? "~").localeCompare(b.category ?? "~") || a.description.localeCompare(b.description),
  );
  return { items: sorted, plans: counted, missing, unknownFoods: [...unknown].sort() };
}
