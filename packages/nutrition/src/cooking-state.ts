/**
 * Guessing whether a recipe cooks each ingredient, from the person's own method text, for recipes
 * saved before ingredients carried a cooked or raw state (and saves from older app versions).
 * A guess is always stored as source "inferred", shown as a guess, and editable.
 */
import { cookSteps, type Technique } from "./cooking.ts";
import type { CookingMethod } from "./retention.ts";
import type { FoodRecord, IngredientCooking, RecipeIngredient } from "./types.ts";

/** Cook-it techniques that heat food -> the cooking method they mean. */
const TECHNIQUE_METHOD: Record<string, CookingMethod> = {
  sear: "pan_fried", pan_fry: "pan_fried", saute: "sauteed", wilt: "sauteed", caramelize: "sauteed", stir_fry: "stir_fried",
  deep_fry: "deep_fried", air_fry: "air_fried", toast: "baked", bake: "baked", roast: "roasted", grill: "grilled",
  boil: "boiled", simmer: "simmered", reduce: "simmered", blanch: "blanched", steam: "steamed", poach: "poached",
  braise: "braised", pressure_cook: "pressure_cooked", slow_cook: "slow_cooked", microwave: "microwaved",
};

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** USDA words that say nothing about which food it is. */
const STOP = new Set(
  ("raw fresh cooked mature seeds all varieties broilers fryers meat only with without skin skinless boneless bone whole ground " +
    "sweet red green yellow white black dry dried frozen canned regular plain enriched unenriched fortified unprepared prepared " +
    "commercial includes include year round average trimmed fat lean choice select separable leaf leaves products product " +
    "solids liquids drained unsalted salted salt added kernels other type style made from cut pieces medium large small " +
    "parboiled long grain short instant extra virgin light heavy and the for not").split(" "),
);

/** Common Spanish names, for methods written in Spanish (keys are English words from USDA names). */
const SPANISH: Record<string, string[]> = {
  onion: ["cebolla", "cebollin", "cebolleta"], garlic: ["ajo"], chicken: ["pollo", "pechuga", "muslo", "trutro"], beef: ["carne", "res", "vacuno", "bistec", "lomo"],
  pork: ["cerdo", "chancho"], lamb: ["cordero"], turkey: ["pavo"], egg: ["huevo"], tomato: ["tomate"], potato: ["papa", "patata"],
  carrot: ["zanahoria"], rice: ["arroz"], pasta: ["pasta", "fideo", "espagueti", "tallarin"], spaghetti: ["espagueti", "tallarin"], noodle: ["fideo"],
  spinach: ["espinaca"], lettuce: ["lechuga"], cabbage: ["repollo", "col"], pepper: ["pimiento", "pimenton", "aji"], bean: ["frijol", "poroto", "judia", "alubia"],
  lentil: ["lenteja"], chickpea: ["garbanzo"], cheese: ["queso"], milk: ["leche"], cream: ["crema", "nata"], butter: ["mantequilla", "manteca"],
  oil: ["aceite"], cilantro: ["cilantro"], coriander: ["cilantro"], parsley: ["perejil"], lemon: ["limon"], lime: ["lima", "limon"],
  avocado: ["palta", "aguacate"], cucumber: ["pepino"], mushroom: ["champinon", "hongo", "seta"], broccoli: ["brocoli"],
  squash: ["calabacin", "zapallo", "zapallito", "calabaza"], zucchini: ["calabacin", "zapallito"], corn: ["maiz", "choclo", "elote"],
  salmon: ["salmon"], fish: ["pescado"], shrimp: ["camaron", "gamba"], tuna: ["atun"], quinoa: ["quinoa", "quinua"], oat: ["avena"],
  flour: ["harina"], sugar: ["azucar"], honey: ["miel"], apple: ["manzana"], banana: ["platano", "banana"], orange: ["naranja"],
  pea: ["arveja", "guisante", "chicharo"], celery: ["apio"], cauliflower: ["coliflor"], eggplant: ["berenjena"], beet: ["betarraga", "remolacha"],
  bread: ["pan"], yogurt: ["yogur"], almond: ["almendra"], walnut: ["nuez"], peanut: ["mani", "cacahuate"], sesame: ["sesamo"],
  ginger: ["jengibre"], cumin: ["comino"], oregano: ["oregano"], basil: ["albahaca"], vinegar: ["vinagre"], kale: ["col rizada"],
  sausage: ["salchicha", "chorizo", "longaniza"], bacon: ["tocino", "panceta"], ham: ["jamon"], cod: ["bacalao"], wine: ["vino"],
};

const singular = (w: string) => (w.endsWith("ies") ? `${w.slice(0, -3)}y` : w.endsWith("oes") ? w.slice(0, -2) : w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w);

/** Words that name this food in a method: from the first parts of its USDA name, plus Spanish names. */
export function foodWords(description: string): string[] {
  const parts = fold(description).split(",").map((p) => p.trim());
  const words = new Set<string>();
  for (const part of parts.slice(0, 3)) {
    for (const raw of part.split(/[^a-z]+/)) {
      if (raw.length < 3 || STOP.has(raw)) continue;
      const w = singular(raw);
      words.add(w);
      for (const es of SPANISH[w] ?? []) words.add(es);
    }
  }
  return [...words];
}

function mentions(text: string, words: string[]): boolean {
  return words.some((w) => new RegExp(`(?<![a-z])${w}(?:s|es)?(?![a-z])`).test(text));
}

const heatMethod = (techniques: Technique[]): CookingMethod | null => {
  const methods = techniques.map((t) => TECHNIQUE_METHOD[t.id]).filter((m): m is CookingMethod => !!m);
  return methods.at(-1) ?? null;
};

/**
 * Guesses each ingredient's state from the method:
 * - named in a heating step: cooked by the last such step's method;
 * - named only in steps without heat: cooked by the first heating step after its last mention
 *   (a batter that is then baked), or raw if none comes after (greens tossed in at the end);
 * - not named: cooked by the recipe's most common heating method, or raw if nothing is heated.
 * Cooking oil is always cooked.
 */
export function inferCooking(
  method: string,
  ingredients: readonly Pick<RecipeIngredient, "id" | "foodId" | "role">[],
  foods: ReadonlyMap<string, Pick<FoodRecord, "description">>,
): Map<string, IngredientCooking> {
  const steps = cookSteps(method).steps.map((s) => ({ text: fold(`${s.label ?? ""} ${s.text}`), heat: heatMethod(s.techniques) }));
  const heats = steps.map((s) => s.heat).filter((m): m is CookingMethod => !!m);
  const counts = new Map<CookingMethod, number>();
  for (const m of heats) counts.set(m, (counts.get(m) ?? 0) + 1);
  const main = [...counts.entries()].sort((a, b) => b[1] - a[1] || heats.indexOf(a[0]) - heats.indexOf(b[0]))[0]?.[0] ?? null;

  const out = new Map<string, IngredientCooking>();
  for (const ing of ingredients) {
    const result = (m: CookingMethod | null): IngredientCooking => (m ? { state: "cooked", method: m, source: "inferred" } : { state: "raw", method: null, source: "inferred" });
    if (ing.role === "cooking_oil") {
      out.set(ing.id, result(main ?? "pan_fried"));
      continue;
    }
    const food = foods.get(ing.foodId);
    const words = food ? foodWords(food.description) : [];
    const named = words.length ? steps.map((s, i) => (mentions(s.text, words) ? i : -1)).filter((i) => i >= 0) : [];
    if (!named.length) {
      out.set(ing.id, result(main));
      continue;
    }
    const heated = named.filter((i) => steps[i]!.heat);
    if (heated.length) {
      out.set(ing.id, result(steps[heated.at(-1)!]!.heat));
      continue;
    }
    const after = steps.slice(named.at(-1)! + 1).find((s) => s.heat);
    out.set(ing.id, result(after?.heat ?? null));
  }
  return out;
}

/** Fills in a guessed state for ingredients that have none; stated ones are kept as they are. */
export function withInferredCooking<I extends RecipeIngredient>(
  method: string,
  ingredients: readonly I[],
  foods: ReadonlyMap<string, Pick<FoodRecord, "description">>,
): I[] {
  const missing = ingredients.filter((i) => !i.cooking);
  if (!missing.length) return [...ingredients];
  const guessed = inferCooking(method, missing, foods);
  return ingredients.map((i) => (i.cooking ? i : { ...i, cooking: guessed.get(i.id)! }));
}
