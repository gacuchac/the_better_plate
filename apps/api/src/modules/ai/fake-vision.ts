import type { ReadArgs } from "./vision.ts";

/**
 * Scripted answers for photo reads, for local runs and automated tests only (fake keys never
 * reach dev or production, see readStructured). The photos can't really be read here, so every
 * recipe photo reads as the same labelled test fixture, with one line that matches nothing and
 * one with no amount, so the review screen's checks get exercised.
 */
export const FAKE_RECIPE = {
  readable: true,
  title: "Test fixture: lemon chicken with rice",
  description: "A synthetic recipe read by the fake model.",
  servings: 4,
  language: "en",
  lines: [
    { original: "500 g chicken breast, skinless", food_name: "chicken breast meat only raw", quantity: 500, unit: "g", notes: "skinless" },
    { original: "1 cup long-grain white rice", food_name: "rice white long grain raw", quantity: 1, unit: "cup", notes: "" },
    { original: "2 tbsp olive oil", food_name: "olive oil", quantity: 2, unit: "tbsp", notes: "" },
    { original: "3 cloves garlic, minced", food_name: "garlic raw", quantity: 3, unit: "cloves", notes: "minced" },
    { original: "Salt to taste", food_name: "salt table", quantity: null, unit: "to taste", notes: "" },
    { original: "1 pinch of moon dust", food_name: "moon dust", quantity: 1, unit: "pinch", notes: "" },
  ],
  method:
    "1. Rinse the rice and simmer it in 2 cups of water for 18 minutes.\n" +
    "2. Heat the olive oil in a pan and pan-fry the chicken with the garlic until it reaches 74 °C (165 °F) inside.\n" +
    "3. Season with salt and serve over the rice.",
};

/**
 * Every receipt photo reads as this labelled fixture: four grocery lines (two weighed), one
 * household line the cook will mark personal, tax, and a total that adds up.
 */
export const FAKE_RECEIPT = {
  readable: true,
  store: "Test fixture: Corner Market",
  purchased_on: "2026-11-20",
  lines: [
    { text: "CHICKEN BREAST 1.10 LB", food_name: "chicken breast meat only raw", price: 6.49, grams: 499 },
    { text: "LONG GRAIN RICE 2 LB", food_name: "rice white long grain raw", price: 3.29, grams: 907 },
    { text: "OLIVE OIL 500ML", food_name: "olive oil", price: 8.99, grams: null },
    { text: "GARLIC", food_name: "garlic raw", price: 0.8, grams: null },
    { text: "PAPER TOWELS 6PK", food_name: "", price: 4.5, grams: null },
  ],
  subtotal: 24.07,
  tax: 1.2,
  total: 25.27,
};

export function fakeRead(args: ReadArgs): unknown {
  if (args.name === "recipe_from_photo") return FAKE_RECIPE;
  if (args.name === "receipt_from_photo") return FAKE_RECEIPT;
  if (args.name === "pick_foods") {
    // Picks the first candidate for every line that has any.
    const asked = JSON.parse(args.text.slice(args.text.indexOf("{"))) as { lines: { i: number; candidates: unknown[] }[] };
    return { picks: asked.lines.map((l) => ({ i: l.i, choice: l.candidates.length ? 0 : null })) };
  }
  throw new Error(`no fake answer for ${args.name}`);
}
