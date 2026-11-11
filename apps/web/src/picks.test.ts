import { describe, expect, it } from "vitest";
import type { FoodRecord } from "@betterplate/nutrition";
import type { LocalLog, LocalRecipe } from "./localdb.ts";
import { ownAdventure, similarity } from "./picks.ts";

const foods = new Map<string, FoodRecord>(
  ([
    ["fdc:1", "Cereal Grains and Pasta"],
    ["fdc:2", "Cereal Grains and Pasta"],
    ["fdc:3", "Legumes and Legume Products"],
  ] as const).map(([id, category]) => [id, { id, category } as unknown as FoodRecord]),
);
const recipe = (id: string, foodIds: string[]): LocalRecipe => ({
  id,
  body: { title: id, description: "", servings: 1, method: "", ingredients: foodIds.map((foodId) => ({ id: foodId, foodId, quantity: 100, unit: "g", role: "ingredient" })) },
  serverVersion: 1,
  state: "synced",
  updatedAt: "2026-11-01T00:00:00Z",
});
const ate = (recipeId: string, foodIds: string[], localDate: string): LocalLog =>
  ({
    id: `${recipeId}-${localDate}`,
    body: { plannedMealId: null, recipeId, recipe: { title: recipeId, servings: 1, ingredients: recipe(recipeId, foodIds).body.ingredients }, servings: 1, slot: "dinner", localDate, eatenAt: `${localDate}T19:00:00Z` },
    state: "synced",
    createdAt: `${localDate}T19:00:00Z`,
  }) as LocalLog;

describe("something completely different", () => {
  it("scores food and category overlap", () => {
    const recent = { foods: new Set(["fdc:1"]), categories: new Set(["Cereal Grains and Pasta"]) };
    expect(similarity({ foods: ["fdc:3"], categories: ["Legumes and Legume Products"] }, recent)).toBe(0);
    expect(similarity({ foods: ["fdc:2"], categories: ["Cereal Grains and Pasta"] }, recent)).toBe(0.5);
  });

  it("picks the recipe least like what was eaten in the last 30 days, never one eaten lately", () => {
    const rice = recipe("rice", ["fdc:1"]);
    const pasta = recipe("pasta", ["fdc:2"]);
    const lentils = recipe("lentils", ["fdc:3"]);
    const logs = [ate("rice", ["fdc:1"], "2026-11-10")];
    expect(ownAdventure([rice, pasta, lentils], logs, "2026-11-11", foods)?.id).toBe("lentils");
    expect(ownAdventure([rice], logs, "2026-11-11", foods)).toBeNull();
    // Older than the window: rice counts as different again.
    expect(ownAdventure([rice], [ate("rice", ["fdc:1"], "2026-09-01")], "2026-11-11", foods)?.id).toBe("rice");
  });
});
