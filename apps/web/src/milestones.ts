import type { MilestoneKind } from "@betterplate/contracts";
import { addDays, foodBaseName, isoWeek, isPlantFood, weekStart, type FoodRecord } from "@betterplate/nutrition";
import type { LocalLog } from "./localdb.ts";

/**
 * Small steps worth sharing, worked out on this device from the person's own eaten meals (never a
 * profile's). Only what was done counts: no streaks, nothing to miss, no amounts. One milestone of
 * each kind per week, matching what the server accepts.
 */
export type MilestoneSuggestion = { kind: MilestoneKind; week: string; foodId: string | null; foodName: string | null };

/** How far back a food must not have been eaten to count as new. */
export const NEW_FOOD_LOOKBACK_DAYS = 90;
/** Dinners from the person's recipes, on different days this week. */
export const HOME_DINNERS = 3;

/** Most personal first: one suggestion shows at a time. */
const ORDER: MilestoneKind[] = ["new_plant", "community_cooked", "new_recipe", "home_dinners", "planned_and_ate"];

export type SuggestInput = {
  logs: LocalLog[];
  foods: Map<string, FoodRecord>;
  today: string;
  /** From the server: the person's recipes that are copies of community recipes. */
  communityCopyIds: string[];
  /** From the server: the person's own recipes created in the last 8 days. */
  newRecipeIds: string[];
};

export function suggestMilestones({ logs, foods, today, communityCopyIds, newRecipeIds }: SuggestInput): MilestoneSuggestion[] {
  const week = isoWeek(today);
  const monday = weekStart(today);
  const own = logs.filter((l) => !l.deleted && !l.body.profileId && l.body.localDate <= today);
  const thisWeek = own.filter((l) => l.body.localDate >= monday).sort((a, b) => (a.body.eatenAt < b.body.eatenAt ? 1 : -1));
  const before = own.filter((l) => l.body.localDate < monday && l.body.localDate >= addDays(monday, -NEW_FOOD_LOOKBACK_DAYS));
  const found = new Map<MilestoneKind, MilestoneSuggestion>();
  const add = (kind: MilestoneKind, food: { id: string; name: string } | null = null) =>
    found.has(kind) || found.set(kind, { kind, week, foodId: food?.id ?? null, foodName: food?.name ?? null });

  // Something new: a plant food this week not eaten in the 90 days before. Only for people who logged
  // meals before this week, so a first week of logging doesn't call everything new.
  if (before.length > 0) {
    const eatenBefore = new Set(before.flatMap((l) => l.body.recipe.ingredients.map((i) => foods.get(i.foodId)).filter(Boolean).map((f) => foodBaseName(f!.description))));
    for (const log of thisWeek) {
      const fresh = log.body.recipe.ingredients.map((i) => foods.get(i.foodId)).find((f) => f && isPlantFood(f) && !eatenBefore.has(foodBaseName(f.description)));
      if (fresh) {
        add("new_plant", { id: fresh.id, name: foodBaseName(fresh.description) });
        break;
      }
    }
  }
  const copies = new Set(communityCopyIds);
  const fresh = new Set(newRecipeIds);
  if (thisWeek.some((l) => l.body.recipeId && copies.has(l.body.recipeId))) add("community_cooked");
  if (thisWeek.some((l) => l.body.recipeId && fresh.has(l.body.recipeId))) add("new_recipe");
  const dinnerDays = new Set(thisWeek.filter((l) => l.body.slot === "dinner" && l.body.recipeId).map((l) => l.body.localDate));
  if (dinnerDays.size >= HOME_DINNERS) add("home_dinners");
  if (thisWeek.some((l) => l.body.plannedMealId)) add("planned_and_ate");
  return ORDER.map((k) => found.get(k)).filter((s): s is MilestoneSuggestion => !!s);
}

// ---------- "Not now" and the one-time explanation: per device, never sent anywhere ----------

const DISMISSED = "bp.milestones.notNow";
const EXPLAINED = "bp.milestones.explained";
const key = (s: { kind: MilestoneKind; week: string }) => `${s.kind}:${s.week}`;

function read(): string[] {
  try {
    return JSON.parse(localStorage.getItem(DISMISSED) ?? "[]") as string[];
  } catch {
    return [];
  }
}

export function isDismissed(s: { kind: MilestoneKind; week: string }): boolean {
  return read().includes(key(s));
}

export function dismiss(s: { kind: MilestoneKind; week: string }): void {
  try {
    // Keep the list short: older weeks can never be suggested again anyway.
    localStorage.setItem(DISMISSED, JSON.stringify([...read(), key(s)].slice(-30)));
  } catch {
    // Storage blocked: the card comes back after a reload.
  }
}

export function wasExplained(): boolean {
  try {
    return localStorage.getItem(EXPLAINED) === "1";
  } catch {
    return false;
  }
}

export function markExplained(): void {
  try {
    localStorage.setItem(EXPLAINED, "1");
  } catch {
    // Storage blocked: the explanation shows again next time.
  }
}
