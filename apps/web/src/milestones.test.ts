import { afterEach, describe, expect, it } from "vitest";
import type { FoodRecord } from "@betterplate/nutrition";
import type { LocalLog } from "./localdb.ts";
import { dismiss, isDismissed, suggestMilestones } from "./milestones.ts";

// Labeled test fixtures: made-up foods, not catalog records.
const foods = new Map<string, FoodRecord>(
  ([
    ["fdc:kale-raw", "Kale, raw", "Vegetables and Vegetable Products"],
    ["fdc:kale-cooked", "Kale, cooked, boiled, drained, without salt", "Vegetables and Vegetable Products"],
    ["fdc:beet", "Beets, raw", "Vegetables and Vegetable Products"],
    ["fdc:rice", "Rice, white, cooked", "Cereal Grains and Pasta"],
    ["fdc:juice", "Orange juice, raw", "Fruits and Fruit Juices"],
  ] as const).map(([id, description, category]) => [id, { id, description, category } as unknown as FoodRecord]),
);

let n = 0;
const ate = (localDate: string, foodIds: string[], extra: Partial<LocalLog["body"]> = {}): LocalLog =>
  ({
    id: `log-${n++}`,
    body: {
      plannedMealId: null,
      recipeId: "r-own",
      recipe: { title: "Bowl", servings: 1, ingredients: foodIds.map((foodId) => ({ id: foodId, foodId, quantity: 100, unit: "g", role: "ingredient" })) },
      servings: 1,
      slot: "lunch",
      localDate,
      eatenAt: `${localDate}T12:00:00Z`,
      ...extra,
    },
    state: "synced",
    createdAt: `${localDate}T12:00:00Z`,
  }) as LocalLog;

const TODAY = "2026-11-12"; // Thursday of 2026-W46; the week starts Monday 2026-11-09
const suggest = (logs: LocalLog[], hints: { communityCopyIds?: string[]; newRecipeIds?: string[] } = {}) =>
  suggestMilestones({ logs, foods, today: TODAY, communityCopyIds: hints.communityCopyIds ?? [], newRecipeIds: hints.newRecipeIds ?? [] });
const kinds = (logs: LocalLog[], hints?: Parameters<typeof suggest>[1]) => suggest(logs, hints).map((s) => s.kind);

describe("suggested milestones", () => {
  it("suggests a plant food not eaten in the 90 days before this week, by its name without preparation", () => {
    const logs = [ate("2026-10-20", ["fdc:rice", "fdc:beet"]), ate("2026-11-10", ["fdc:rice", "fdc:beet", "fdc:kale-cooked"])];
    expect(suggest(logs)).toEqual([{ kind: "new_plant", week: "2026-W46", foodId: "fdc:kale-cooked", foodName: "Kale" }]);
  });

  it("treats another form of a food eaten before as not new, and ignores juices and other groups", () => {
    expect(kinds([ate("2026-10-20", ["fdc:kale-raw"]), ate("2026-11-10", ["fdc:kale-cooked", "fdc:rice", "fdc:juice"])])).toEqual([]);
  });

  it("counts a food eaten more than 90 days ago as new again", () => {
    expect(kinds([ate("2026-07-01", ["fdc:kale-raw"]), ate("2026-10-20", ["fdc:rice"]), ate("2026-11-10", ["fdc:kale-raw"])])).toEqual(["new_plant"]);
  });

  it("doesn't call everything new in someone's first week of logging", () => {
    expect(kinds([ate("2026-11-10", ["fdc:kale-raw"])])).toEqual([]);
  });

  it("never counts meals logged for a profile, deleted meals or meals after today", () => {
    const history = ate("2026-10-20", ["fdc:rice"]);
    expect(kinds([history, ate("2026-11-10", ["fdc:kale-raw"], { profileId: crypto.randomUUID() })])).toEqual([]);
    expect(kinds([history, { ...ate("2026-11-10", ["fdc:kale-raw"]), deleted: true }])).toEqual([]);
    expect(kinds([history, ate("2026-11-13", ["fdc:kale-raw"])])).toEqual([]);
  });

  it("only looks at this week, which starts on Monday", () => {
    expect(kinds([ate("2026-10-20", ["fdc:rice"]), ate("2026-11-08", ["fdc:kale-raw"], { plannedMealId: crypto.randomUUID() })])).toEqual([]);
  });

  it("suggests 3 dinners from the person's recipes on different days", () => {
    const dinner = (d: string, recipeId: string | null = "r-own") => ate(d, ["fdc:rice"], { slot: "dinner", recipeId });
    expect(kinds([dinner("2026-11-09"), dinner("2026-11-10"), dinner("2026-11-10")])).toEqual([]);
    expect(kinds([dinner("2026-11-09"), dinner("2026-11-10"), dinner("2026-11-11", null)])).toEqual([]);
    expect(kinds([dinner("2026-11-09"), dinner("2026-11-10"), dinner("2026-11-11")])).toEqual(["home_dinners"]);
  });

  it("uses the server's hints for community copies and new recipes, and links meals to plans", () => {
    const logs = [ate("2026-11-10", ["fdc:rice"], { recipeId: "r-copy" }), ate("2026-11-11", ["fdc:rice"], { recipeId: "r-new", plannedMealId: crypto.randomUUID() })];
    expect(kinds(logs)).toEqual(["planned_and_ate"]);
    expect(kinds(logs, { communityCopyIds: ["r-copy"], newRecipeIds: ["r-new"] })).toEqual(["community_cooked", "new_recipe", "planned_and_ate"]);
  });
});

describe("not now", () => {
  // Unit tests run without a browser: a minimal stand-in for this device's storage.
  const store = new Map<string, string>();
  globalThis.localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) } as Storage;
  afterEach(() => store.clear());

  it("hides one milestone for its week only", () => {
    dismiss({ kind: "home_dinners", week: "2026-W46" });
    expect(isDismissed({ kind: "home_dinners", week: "2026-W46" })).toBe(true);
    expect(isDismissed({ kind: "home_dinners", week: "2026-W47" })).toBe(false);
    expect(isDismissed({ kind: "new_plant", week: "2026-W46" })).toBe(false);
  });
});
