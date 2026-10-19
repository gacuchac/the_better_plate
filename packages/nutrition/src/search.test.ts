import { describe, expect, it } from "vitest";
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
    expect(search("olive")[0]).toBe("Olives, ripe, canned (small-extra large)");
    expect(search("olive oil")[0]).toBe("Oil, olive, salad or cooking");
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
