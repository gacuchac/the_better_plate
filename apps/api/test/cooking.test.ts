import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AI_TOOLS, CookingMethodSchema } from "@betterplate/contracts";
import { COOKING_METHODS } from "@betterplate/nutrition";
import { pool } from "../src/db/pool.ts";
import { backfillCookingState, COOKING_BACKFILL } from "../src/db/backfill.ts";
import { findFood, signIn } from "./helpers.ts";

let spinach: string;
let pasta: string;

beforeAll(async () => {
  spinach = await findFood("Spinach, raw");
  pasta = await findFood("Pasta, dry, enriched");
});
afterAll(() => pool.end());

const ingredient = (foodId: string, quantity: number, cooking?: unknown) => ({ id: crypto.randomUUID(), foodId, quantity, unit: "g", role: "ingredient", ...(cooking ? { cooking } : {}) });
const per = (recipe: { nutrition: { totals: { key: string; amount: number | null }[] } }, key: string) => recipe.nutrition.totals.find((t) => t.key === key)!.amount!;

describe("cooked or raw ingredients (ADR-014)", () => {
  it("uses one list of cooking methods everywhere", () => {
    expect(CookingMethodSchema.options).toEqual([...COOKING_METHODS]);
    const toolMethods = AI_TOOLS.save_recipe.input.shape.ingredients.element.shape.cooking.shape.method.unwrap().options;
    expect(toolMethods).toEqual([...COOKING_METHODS]);
  });

  it("guesses a missing state from the method on save and keeps a stated one", async () => {
    const alice = await signIn();
    const res = await alice.request("/v1/recipes", {
      method: "POST",
      json: {
        title: "Pasta with spinach",
        servings: 2,
        method: "1. Boil the pasta and drain.\n2. Toss with fresh spinach.",
        ingredients: [ingredient(pasta, 200), ingredient(spinach, 100, { state: "cooked", method: "sauteed", source: "stated" })],
      },
    });
    expect(res.status).toBe(201);
    const recipe = await res.json();
    expect(recipe.ingredients[0].cooking).toEqual({ state: "cooked", method: "boiled", source: "inferred" });
    expect(recipe.ingredients[1].cooking).toEqual({ state: "cooked", method: "sauteed", source: "stated" });
    expect(recipe.nutrition.engineVersion).toBe("2.0.0");
  });

  it("rejects a cooked state without a method", async () => {
    const alice = await signIn();
    const res = await alice.request("/v1/recipes", {
      method: "POST",
      json: { title: "Bad", servings: 1, ingredients: [ingredient(spinach, 100, { state: "cooked", method: null, source: "stated" })] },
    });
    expect(res.status).toBe(400);
  });

  it("previews with the method and lowers vitamin C, not energy, for cooked greens", async () => {
    const alice = await signIn();
    const calc = async (cooking: unknown) =>
      (await (await alice.request("/v1/recipes/calculate", { method: "POST", json: { servings: 1, ingredients: [ingredient(spinach, 100, cooking)] } })).json()) as {
        totals: { key: string; amount: number }[];
      };
    const raw = await calc({ state: "raw", method: null, source: "stated" });
    const boiled = await calc({ state: "cooked", method: "boiled", source: "stated" });
    const v = (r: typeof raw, k: string) => r.totals.find((t) => t.key === k)!.amount;
    expect(v(boiled, "vitamin_c")).toBeCloseTo(v(raw, "vitamin_c") * 0.55, 6);
    expect(v(boiled, "energy_kcal")).toBe(v(raw, "energy_kcal"));
  });

  it("backfills older recipes once, with a new version and the old one kept", async () => {
    const alice = await signIn();
    const created = await (
      await alice.request("/v1/recipes", { method: "POST", json: { title: "Old soup", servings: 2, method: "Simmer the spinach in broth.", ingredients: [ingredient(spinach, 100, { state: "raw", method: null, source: "stated" })] } })
    ).json();
    // Make it look like a recipe saved before states existed.
    await pool.query(`update recipes set body = jsonb_set(body, '{ingredients,0}', (body->'ingredients'->0) - 'cooking') where id = $1`, [created.id]);
    await pool.query("delete from data_backfills where name = $1", [COOKING_BACKFILL]);

    const result = await backfillCookingState(pool, () => {});
    expect(result!.recipes).toBeGreaterThanOrEqual(1);
    const after = await (await alice.request(`/v1/recipes/${created.id}`)).json();
    expect(after.version).toBe(created.version + 1);
    expect(after.ingredients[0].cooking).toEqual({ state: "cooked", method: "simmered", source: "inferred" });
    expect(per(after, "vitamin_c")).toBeLessThan(per(created, "vitamin_c"));
    const { rows } = await pool.query("select version from recipe_revisions where recipe_id = $1 order by version", [created.id]);
    expect(rows.map((r) => r.version)).toEqual([1, 2]);
    // Runs once.
    expect(await backfillCookingState(pool, () => {})).toBeNull();
  });
});
