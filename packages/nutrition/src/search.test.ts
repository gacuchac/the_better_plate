import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { EVERYDAY_FOODS } from "./everyday-foods.ts";
import { buildSearchIndex, searchIndex, singular } from "./search.ts";

// Descriptions written in USDA SR Legacy style for ranking checks. No nutrient data involved.
const names = [
  "Beef, loin, top sirloin, steak, separable lean only, trimmed to 1/8\" fat, choice, cooked, broiled",
  "Beef, loin, top sirloin, steak, separable lean only, trimmed to 1/8\" fat, choice, raw",
  "Beef, ground, 85% lean meat / 15% fat, raw",
  "Pork, fresh, loin, tenderloin, separable lean only, raw",
  "Broccoli, raw",
  "Broccoli, cooked, boiled, drained, without salt",
  "Soup, cream of broccoli, canned",
  "Tomatoes, red, ripe, raw, year round average",
  "Strawberries, raw",
  "Jalapeño peppers, raw",
  "Oil, olive, salad or cooking",
  "Olives, ripe, canned (small-extra large)",
  "Salmon nuggets, breaded, frozen, heated",
  "Fish, salmon, Atlantic, farmed, raw",
  "OLIVE GARDEN, spaghetti with meat sauce",
  "Milk, sheep, fluid",
  "Milk, whole, 3.25% milkfat, with added vitamin D",
  "Egg, whole, raw, fresh",
  "Eggplant, raw",
  "Squash, summer, zucchini, includes skin, raw",
  "Peppers, sweet, red, raw",
].map((description, i) => ({ id: `fx:${i}`, description }));
const index = buildSearchIndex(names);
const search = (q: string, limit?: number) => searchIndex(index, q, limit).map((f) => f.description);

describe("food search", () => {
  it("matches words in any order and parts of words", () => {
    expect(search("steak sirloin")[0]).toMatch(/^Beef, loin, top sirloin, steak.*raw$/);
    expect(search("sirl stea")).toHaveLength(2);
    expect(search("loin")).toEqual(expect.arrayContaining([expect.stringContaining("tenderloin"), expect.stringContaining("sirloin")]));
  });

  it("matches simple plurals both ways", () => {
    expect(search("steaks")).toHaveLength(2);
    expect(search("tomato")).toEqual(["Tomatoes, red, ripe, raw, year round average"]);
    expect(search("strawberry")).toEqual(["Strawberries, raw"]);
    expect(singular("asparagus")).toBe("asparagus");
    expect(singular("glass")).toBe("glass");
  });

  it("puts the food itself before dishes that mention it, and raw first", () => {
    expect(search("broccoli")).toEqual(["Broccoli, raw", "Broccoli, cooked, boiled, drained, without salt", "Soup, cream of broccoli, canned"]);
    expect(search("olive oil")[0]).toBe("Oil, olive, salad or cooking");
    // "Fish, salmon, …": the food's own name follows USDA's group word.
    expect(search("salmon")[0]).toBe("Fish, salmon, Atlantic, farmed, raw");
  });

  it("puts restaurant and brand entries after generic foods", () => {
    expect(search("olive").at(-1)).toBe("OLIVE GARDEN, spaghetti with meat sauce");
  });

  it("ignores case, accents and punctuation", () => {
    expect(search("JALAPENO")).toEqual(["Jalapeño peppers, raw"]);
    expect(search("85%")).toHaveLength(1);
  });

  it("requires every word to match and respects the limit", () => {
    expect(search("broccoli dragonfruit")).toEqual([]);
    expect(search("raw", 3)).toHaveLength(3);
    expect(search("", 5)).toHaveLength(5);
  });
});

describe("everyday words", () => {
  it("finds what most home cooks mean first", () => {
    expect(search("milk")[0]).toBe("Milk, whole, 3.25% milkfat, with added vitamin D");
    expect(search("egg")[0]).toBe("Egg, whole, raw, fresh");
  });

  it("lifts an everyday food only on whole-word matches", () => {
    expect(search("egg")).toEqual(["Egg, whole, raw, fresh", "Eggplant, raw"]);
  });

  it("understands a few words USDA spells differently", () => {
    expect(search("courgette")).toEqual(["Squash, summer, zucchini, includes skin, raw"]);
    expect(search("bell pepper")[0]).toBe("Peppers, sweet, red, raw");
    expect(search("beef mince")).toEqual(["Beef, ground, 85% lean meat / 15% fat, raw"]);
  });

  it("every everyday entry exists in the imported USDA catalog", () => {
    const catalog = JSON.parse(readFileSync(new URL("../../../data/catalog/starter-catalog.json", import.meta.url), "utf8")) as { foods: { description: string }[] };
    const present = new Set(catalog.foods.map((f) => f.description));
    expect(EVERYDAY_FOODS.filter((d) => !present.has(d))).toEqual([]);
  });
});
