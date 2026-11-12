import type { FoodRecord } from "@betterplate/nutrition";
import type { LocalLog, LocalRecipe } from "./localdb.ts";
import { addDays } from "./meals.ts";

/** Same window as the server's community pick. */
export const ADVENTURE_LOOKBACK_DAYS = 30;

/** Overlap of foods and food categories with what was eaten lately; 0 is completely different. Mirrors the API. */
export function similarity(candidate: { foods: string[]; categories: string[] }, recent: { foods: Set<string>; categories: Set<string> }): number {
  if (candidate.foods.length === 0) return 1;
  const foodShare = candidate.foods.filter((f) => recent.foods.has(f)).length / candidate.foods.length;
  const cats = [...new Set(candidate.categories)];
  const categoryShare = cats.length ? cats.filter((c) => recent.categories.has(c)).length / cats.length : 1;
  return (foodShare + categoryShare) / 2;
}

/** A small stable hash so ties change from day to day but not between renders. */
function tie(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/**
 * Something different from this person's own kitchen, used when there is no community pick
 * (offline, switched off, or nothing shared yet): the recipe they haven't eaten in the last
 * 30 days whose foods and categories overlap least with what they did eat.
 */
export function ownAdventure(recipes: LocalRecipe[], logs: LocalLog[], today: string, foods: Map<string, FoodRecord>): LocalRecipe | null {
  const since = addDays(today, -ADVENTURE_LOOKBACK_DAYS);
  const recentLogs = logs.filter((l) => !l.deleted && l.body.localDate > since && l.body.localDate <= today);
  const eatenRecipes = new Set(recentLogs.map((l) => l.body.recipeId).filter(Boolean));
  const recentFoods = new Set(recentLogs.flatMap((l) => l.body.recipe.ingredients.map((i) => i.foodId)));
  const category = (id: string) => foods.get(id)?.category ?? "";
  const recent = { foods: recentFoods, categories: new Set([...recentFoods].map(category).filter(Boolean)) };
  let best: { recipe: LocalRecipe; score: number; tie: number } | null = null;
  for (const recipe of recipes) {
    if (recipe.deleted || eatenRecipes.has(recipe.id) || recipe.body.ingredients.length === 0) continue;
    const ids = [...new Set(recipe.body.ingredients.map((i) => i.foodId))];
    const score = similarity({ foods: ids, categories: ids.map(category).filter(Boolean) }, recent);
    const t = tie(`${today}:${recipe.id}`);
    if (!best || score < best.score || (score === best.score && t < best.tie)) best = { recipe, score, tie: t };
  }
  return best?.recipe ?? null;
}
