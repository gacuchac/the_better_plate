import { describe, expect, it } from "vitest";
import { buildShoppingList, isPreparedForm, type ShoppingPlan } from "./shopping.ts";
import type { FoodRecord, RecipeIngredient } from "./types.ts";

// Labeled test fixtures: names and portions only, no nutrient data is used here.
const source = { publisher: "test", dataset: "fixture", url: "https://example.test", retrievedAt: "2026-01-01" };
const food = (id: string, description: string, category: string, portions: FoodRecord["portions"] = []): FoodRecord => ({
  id, description, category, nutrientsPer100g: {}, portions, source,
});
const foods = new Map(
  [
    food("fdc:1", "Rice, white, cooked", "Cereal Grains and Pasta"),
    food("fdc:2", "Broccoli, raw", "Vegetables and Vegetable Products", [{ label: "1 cup", gramWeight: 91 }]),
    food("fdc:3", "Oil, olive", "Fats and Oils"),
  ].map((f) => [f.id, f]),
);
const ing = (foodId: string, quantity: number, extra: Partial<RecipeIngredient> = {}): RecipeIngredient => ({
  id: `${foodId}-${quantity}`, foodId, quantity, unit: "g", role: "ingredient", ...extra,
});
const plan = (planId: string, servings: number, recipeServings: number, ingredients: RecipeIngredient[], title = "Rice bowl"): ShoppingPlan => ({
  planId, date: "2026-10-20", title, servings, recipe: { servings: recipeServings, ingredients },
});

describe("shopping list", () => {
  it("adds the same food across plans, scaled from recipe servings to planned servings", () => {
    const list = buildShoppingList(
      [
        plan("a", 1, 2, [ing("fdc:1", 300), ing("fdc:2", 1, { unit: "portion", portionIndex: 0 })]),
        plan("b", 3, 1, [ing("fdc:1", 100)], "Plain rice"),
      ],
      foods,
    );
    expect(list.plans).toBe(2);
    const rice = list.items.find((i) => i.foodId === "fdc:1")!;
    expect(rice.grams).toBe(150 + 300);
    expect(rice.recipes).toEqual(["Rice bowl", "Plain rice"]);
    expect(list.items.find((i) => i.foodId === "fdc:2")!.grams).toBe(45.5);
  });

  it("converts mass units and counts all added oil, even what is discarded", () => {
    const list = buildShoppingList([plan("a", 1, 1, [ing("fdc:3", 1, { unit: "oz", role: "cooking_oil", oilDiscardedGrams: 10 })])], foods);
    const oil = list.items[0]!;
    expect(oil.oil).toBe(true);
    expect(oil.grams).toBeCloseTo(28.349523125);
  });

  it("flags foods listed in a cooked form, since they are bought raw", () => {
    const list = buildShoppingList([plan("a", 1, 1, [ing("fdc:1", 100), ing("fdc:2", 50)])], foods);
    expect(list.items.find((i) => i.foodId === "fdc:1")!.preparedForm).toBe(true);
    expect(list.items.find((i) => i.foodId === "fdc:2")!.preparedForm).toBe(false);
    expect(isPreparedForm("Chicken, broilers or fryers, roasted")).toBe(true);
    expect(isPreparedForm("Carrots, raw")).toBe(false);
  });

  it("keeps portions it cannot resolve visible instead of guessing", () => {
    const list = buildShoppingList([plan("a", 1, 1, [ing("fdc:2", 2, { unit: "portion", portionIndex: 7 })])], foods);
    expect(list.items[0]).toMatchObject({ grams: null, unresolved: 1 });
  });

  it("reports plans with no recipe and foods not in the catalog", () => {
    const list = buildShoppingList(
      [{ planId: "gone", date: "2026-10-21", title: "Old soup", servings: 1, recipe: null }, plan("a", 1, 1, [ing("fdc:999", 10)])],
      foods,
    );
    expect(list.missing).toEqual([{ planId: "gone", date: "2026-10-21", title: "Old soup" }]);
    expect(list.unknownFoods).toEqual(["fdc:999"]);
    expect(list.items).toEqual([]);
  });

  it("sorts by catalog category, then name, and is empty for no plans", () => {
    const list = buildShoppingList([plan("a", 1, 1, [ing("fdc:2", 1), ing("fdc:3", 1), ing("fdc:1", 1)])], foods);
    expect(list.items.map((i) => i.category)).toEqual(["Cereal Grains and Pasta", "Fats and Oils", "Vegetables and Vegetable Products"]);
    expect(buildShoppingList([], foods)).toEqual({ items: [], plans: 0, missing: [], unknownFoods: [] });
  });
});
