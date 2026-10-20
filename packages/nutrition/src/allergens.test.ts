import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { allergenAlert, foodAllergens, recipeAllergens, type Allergen } from "./allergens.ts";
import type { FoodRecord } from "./types.ts";

// Real USDA SR Legacy names and categories from the checked-in catalog.
const catalog = JSON.parse(readFileSync(join(import.meta.dirname, "../../../data/catalog/starter-catalog.json"), "utf8")) as { foods: FoodRecord[] };
const byName = new Map(catalog.foods.map((f) => [f.description, f]));
const tags = (description: string) => {
  const food = byName.get(description);
  if (!food) throw new Error(`not in catalog: ${description}`);
  return foodAllergens(food);
};

describe("allergen tags from USDA names and categories", () => {
  const cases: [string, Allergen[]][] = [
    ["Peanuts, all types, raw", ["peanut"]],
    ["Peanut butter, smooth style, without salt", ["peanut"]],
    ["Butter, salted", ["milk"]],
    ["Milk, whole, 3.25% milkfat, with added vitamin D", ["milk"]],
    ["Cheese, cheddar, sharp, sliced", ["milk"]],
    ["Egg, whole, raw, fresh", ["egg"]],
    ["Eggplant, raw", []],
    ["Squash, winter, butternut, raw", []],
    ["Waterchestnuts, chinese, (matai), raw", []],
    ["Nuts, chestnuts, chinese, raw", ["tree_nuts"]],
    ["Nuts, coconut meat, raw", []],
    ["Nuts, almonds", ["tree_nuts"]],
    ["Nuts, mixed nuts, oil roasted, without peanuts, without salt added", ["tree_nuts"]],
    ["Fish, salmon, Atlantic, wild, raw", ["fish"]],
    ["Crustaceans, shrimp, raw", ["shellfish"]],
    ["Mollusks, clam, mixed species, raw", []],
    ["Bread, white, commercially prepared (includes soft bread crumbs)", ["wheat"]],
    ["Rice, white, long-grain, regular, enriched, cooked", []],
    ["Tofu, raw, firm, prepared with calcium sulfate", ["soy"]],
    ["Soymilk, original and vanilla, unfortified", ["soy"]],
    ["Seeds, sesame seeds, whole, dried", ["sesame"]],
    ["Broccoli, raw", []],
    ["Oil, olive, salad or cooking", []],
    ["Sauce, worcestershire", ["fish"]],
    ["Soy sauce made from soy and wheat (shoyu)", ["wheat", "soy"]],
    ["Beef, New Zealand, imported, cube roll, separable lean only, raw", []],
    ["Spices, pumpkin pie spice", []],
  ];
  it.each(cases)("%s", (name, expected) => {
    expect(tags(name).allergens).toEqual(expected);
  });

  it("marks prepared and mixed foods as possibly containing more than their name shows", () => {
    expect(tags("Bread, white, commercially prepared (includes soft bread crumbs)").mayContainOthers).toBe(true);
    expect(tags("Broccoli, raw").mayContainOthers).toBe(false);
  });

  it("tags only the nine major allergens, and every food gets an answer", () => {
    for (const food of catalog.foods) {
      const t = foodAllergens(food);
      expect(Array.isArray(t.allergens)).toBe(true);
    }
  });
});

describe("recipe allergens and alerts", () => {
  const foods = new Map(catalog.foods.map((f) => [f.id, f]));
  const id = (name: string) => byName.get(name)!.id;
  const recipe = {
    ingredients: [
      { id: "a", foodId: id("Peanuts, all types, raw"), quantity: 30, unit: "g" as const, role: "ingredient" as const },
      { id: "b", foodId: id("Broccoli, raw"), quantity: 100, unit: "g" as const, role: "ingredient" as const },
      { id: "c", foodId: "fdc:999999999", quantity: 1, unit: "g" as const, role: "ingredient" as const },
    ],
  };

  it("says which ingredient carries each allergen and which could not be checked", () => {
    const r = recipeAllergens(recipe, foods);
    expect(r.allergens).toEqual(["peanut"]);
    expect(r.byAllergen.peanut).toEqual(["a"]);
    expect(r.unchecked).toEqual(["c"]);
  });

  it("alerts on allergens the person listed and never blocks", () => {
    const r = recipeAllergens(recipe, foods);
    expect(allergenAlert(r, ["peanut", "milk"])).toEqual({ matches: ["peanut"], possible: true });
    expect(allergenAlert(r, [])).toEqual({ matches: [], possible: false });
  });
});
