import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { calculateRecipe } from "./calculate.ts";
import { inferCooking, foodWords, withInferredCooking } from "./cooking-state.ts";
import { COOKING_METHODS, RETENTION_GROUPS, retentionFor, retentionGroup, isCookedFood } from "./retention.ts";
import { RETENTION_FACTORS, RETENTION_NUTRIENT_NUMBERS } from "./retention-data.ts";
import type { FoodRecord, NutrientDefinition, RecipeIngredient } from "./types.ts";

const usda = JSON.parse(readFileSync(new URL("../../../data/catalog/retention-factors.json", import.meta.url), "utf8")) as {
  contentSha256: string;
  factors: { code: number; description: string; retention: Record<string, number> }[];
};

// TEST FIXTURES ONLY: food names and categories shaped like USDA's; nutrient numbers are synthetic.
const src = { publisher: "TEST FIXTURE", dataset: "synthetic", url: "about:blank", retrievedAt: "2026-01-01T00:00:00Z" };
const food = (id: string, description: string, category: string, n: Record<string, number> = {}): FoodRecord => ({
  id, description, category, nutrientsPer100g: { energy_kcal: 100, protein: 10, vitamin_c: 50, iron: 2, vitamin_d: 1, ...n }, portions: [], source: src,
});
const spinach = food("fx:spinach", "Spinach, raw", "Vegetables and Vegetable Products");
const pasta = food("fx:pasta", "Pasta, dry, enriched", "Cereal Grains and Pasta");
const chicken = food("fx:chicken", "Chicken, broilers or fryers, breast, meat only, raw", "Poultry Products");
const salmon = food("fx:salmon", "Fish, salmon, Atlantic, farmed, raw", "Finfish and Shellfish Products", { fat_total: 13 });
const cod = food("fx:cod", "Fish, cod, Atlantic, raw", "Finfish and Shellfish Products", { fat_total: 0.7 });
const beans = food("fx:beans", "Beans, black, mature seeds, canned, low sodium", "Legumes and Legume Products");
const oil = food("fx:oil", "Oil, olive, salad or cooking", "Fats and Oils");
const onion = food("fx:onion", "Onions, raw", "Vegetables and Vegetable Products");
const foods = new Map([spinach, pasta, chicken, salmon, cod, beans, oil, onion].map((f) => [f.id, f]));
const nutrients: NutrientDefinition[] = [
  { key: "energy_kcal", name: "Energy", unit: "kcal" },
  { key: "vitamin_c", name: "Vitamin C", unit: "mg" },
  { key: "iron", name: "Iron", unit: "mg" },
  { key: "vitamin_d", name: "Vitamin D", unit: "µg" },
];
const ing = (over: Partial<RecipeIngredient>): RecipeIngredient => ({ id: "i1", foodId: "fx:spinach", quantity: 100, unit: "g", role: "ingredient", ...over });

describe("USDA retention data", () => {
  it("matches the imported USDA file for every code and nutrient", () => {
    expect(Object.keys(RETENTION_FACTORS)).toHaveLength(usda.factors.length);
    for (const f of usda.factors) {
      const row = RETENTION_FACTORS[f.code]!;
      expect(row.d).toBe(f.description);
      for (const [key, no] of Object.entries(RETENTION_NUTRIENT_NUMBERS)) expect(row.r[key]).toBe(f.retention[String(no)]);
    }
  });
  it("every code in the mapping exists in the USDA table", () => {
    for (const [id, g] of Object.entries(RETENTION_GROUPS)) {
      for (const code of [...Object.values(g.methods), g.reheated, ...(g.frozen ? [g.frozen] : [])]) {
        expect(RETENTION_FACTORS[code!], `${id} -> ${code}`).toBeDefined();
      }
    }
  });
  it("every group covers every cooking method", () => {
    for (const [id, g] of Object.entries(RETENTION_GROUPS)) for (const m of COOKING_METHODS) expect(g.methods[m], `${id}.${m}`).toBeDefined();
  });
});

describe("retentionFor", () => {
  it("picks USDA's code for the food group and method", () => {
    expect(retentionFor(spinach, "boiled")?.code).toBe(3005);
    expect(retentionFor(spinach, "sauteed")?.code).toBe(3015);
    expect(retentionFor(pasta, "boiled")?.code).toBe(381);
    expect(retentionFor(chicken, "roasted")?.code).toBe(805);
    expect(retentionFor(onion, "sauteed")?.code).toBe(3460);
  });
  it("splits fish by the food's own fat", () => {
    expect(retentionGroup(salmon)).toBe("fish_fatty");
    expect(retentionGroup(cod)).toBe("fish_lean");
    expect(retentionFor(salmon, "baked")?.code).toBe(2451);
    expect(retentionFor(cod, "baked")?.code).toBe(2301);
  });
  it("uses the reheated code for foods USDA lists already cooked or canned", () => {
    expect(isCookedFood(beans.description)).toBe(true);
    expect(retentionFor(beans, "simmered")?.code).toBe(550);
  });
  it("has nothing for groups USDA doesn't cover", () => {
    expect(retentionFor(oil, "pan_fried")).toBeNull();
  });
});

describe("calculateRecipe with cooking", () => {
  const vitC = (r: ReturnType<typeof calculateRecipe>, key = "vitamin_c") => r.totals.find((t) => t.key === key)!.amount;
  it("leaves raw and stateless ingredients unchanged", () => {
    expect(vitC(calculateRecipe({ servings: 1, ingredients: [ing({})] }, foods, nutrients))).toBe(50);
    expect(vitC(calculateRecipe({ servings: 1, ingredients: [ing({ cooking: { state: "raw", method: null, source: "stated" } })] }, foods, nutrients))).toBe(50);
  });
  it("applies USDA percentages to vitamins and minerals only", () => {
    const pct = RETENTION_FACTORS[3005]!.r;
    const r = calculateRecipe({ servings: 2, ingredients: [ing({ cooking: { state: "cooked", method: "boiled", source: "stated" } })] }, foods, nutrients);
    expect(vitC(r)).toBeCloseTo((50 * pct.vitamin_c!) / 100, 10);
    expect(vitC(r, "iron")).toBeCloseTo((2 * pct.iron!) / 100, 10);
    expect(vitC(r, "energy_kcal")).toBe(100);
    // Vitamin D has no USDA factor: unchanged.
    expect(vitC(r, "vitamin_d")).toBe(1);
    // Per serving is still the total divided by servings.
    expect(r.perServing.find((t) => t.key === "vitamin_c")!.amount).toBeCloseTo(vitC(r)! / 2, 10);
    expect(r.ingredients[0]!.retentionCode).toBe(3005);
  });
  it("discloses cooked ingredients without a USDA factor", () => {
    const r = calculateRecipe(
      { servings: 1, ingredients: [ing({ id: "o", foodId: "fx:oil", cooking: { state: "cooked", method: "pan_fried", source: "inferred" } })] },
      foods,
      nutrients,
    );
    expect(r.disclosures.map((d) => d.code)).toEqual(["no_retention_factor"]);
  });
  it("never applies retention to cooking oil", () => {
    const r = calculateRecipe({ servings: 1, ingredients: [ing({ role: "cooking_oil", oilDiscardedGrams: 0, cooking: { state: "cooked", method: "boiled", source: "stated" } })] }, foods, nutrients);
    expect(vitC(r)).toBe(50);
  });
});

describe("inferCooking", () => {
  const ings = (...ids: string[]) => ids.map((foodId, i) => ({ id: `i${i}`, foodId, role: "ingredient" as const }));
  it("cooks what a heating step names and leaves late, unheated additions raw", () => {
    const method = "1. Boil the pasta until tender and drain.\n2. Sauté the onion in olive oil.\n3. Toss everything with fresh spinach and serve.";
    const out = inferCooking(method, ings("fx:pasta", "fx:onion", "fx:spinach"), foods);
    expect(out.get("i0")).toEqual({ state: "cooked", method: "boiled", source: "inferred" });
    expect(out.get("i1")).toEqual({ state: "cooked", method: "sauteed", source: "inferred" });
    expect(out.get("i2")).toEqual({ state: "raw", method: null, source: "inferred" });
  });
  it("reads Spanish methods", () => {
    const out = inferCooking("Dora el pollo en una sartén. Sirve con espinaca fresca.", ings("fx:chicken", "fx:spinach"), foods);
    expect(out.get("i0")?.method).toBe("pan_fried");
    expect(out.get("i1")?.state).toBe("raw");
  });
  it("cooks an ingredient mixed before a later heating step", () => {
    const out = inferCooking("Mix the chicken with the spinach.\nBake for 30 minutes.", ings("fx:chicken", "fx:spinach"), foods);
    expect(out.get("i0")?.method).toBe("baked");
    expect(out.get("i1")?.method).toBe("baked");
  });
  it("falls back to the recipe's main heating method, or raw with no heat", () => {
    expect(inferCooking("Simmer for an hour.", ings("fx:beans"), foods).get("i0")?.method).toBe("simmered");
    expect(inferCooking("Chop and toss with lemon.", ings("fx:beans"), foods).get("i0")?.state).toBe("raw");
  });
  it("keeps stated states and fills only the missing ones", () => {
    const stated: RecipeIngredient = { id: "s", foodId: "fx:spinach", quantity: 1, unit: "g", role: "ingredient", cooking: { state: "raw", method: null, source: "stated" } };
    const missing: RecipeIngredient = { id: "m", foodId: "fx:pasta", quantity: 1, unit: "g", role: "ingredient" };
    const out = withInferredCooking("Boil the pasta.", [stated, missing], foods);
    expect(out[0]).toBe(stated);
    expect(out[1]!.cooking).toEqual({ state: "cooked", method: "boiled", source: "inferred" });
  });
  it("names foods by their USDA words and Spanish names", () => {
    expect(foodWords("Chicken, broilers or fryers, breast, meat only, raw")).toEqual(expect.arrayContaining(["chicken", "pollo", "breast"]));
  });
});
