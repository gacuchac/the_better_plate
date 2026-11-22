import { singular } from "./search.ts";
import type { FoodRecord, IngredientUnit } from "./types.ts";

/**
 * Turns an amount as a recipe or a receipt writes it ("2 cups", "1 medium", "250 ml", "3 cloves")
 * into an ingredient amount the app can weigh: a mass unit, or a count of one of the food's USDA
 * household portions. Returns null when the text can't be weighed honestly ("a pinch", "to
 * taste", a volume the food has no portion for); the person then fills it in.
 */
export interface IngredientAmount {
  quantity: number;
  unit: IngredientUnit;
  portionIndex: number | null;
}

const MASS: Record<string, "g" | "kg" | "oz" | "lb"> = {
  g: "g", gr: "g", gram: "g", grams: "g", gramm: "g", gramos: "g", grs: "g",
  kg: "kg", kilo: "kg", kilos: "kg", kilogram: "kg", kilograms: "kg", kilogramos: "kg",
  oz: "oz", ounce: "oz", ounces: "oz",
  lb: "lb", lbs: "lb", pound: "lb", pounds: "lb",
};

/** Volume units with their size in millilitres (US customary). */
const VOLUME: Record<string, { ml: number; label: RegExp }> = {
  cup: { ml: 236.588, label: /\bcups?\b/ },
  tbsp: { ml: 14.787, label: /\b(tbsp|tablespoons?)\b/ },
  tsp: { ml: 4.929, label: /\b(tsp|teaspoons?)\b/ },
  "fl oz": { ml: 29.574, label: /\bfl oz\b/ },
  quart: { ml: 946.353, label: /\bquarts?\b/ },
  pint: { ml: 473.176, label: /\bpints?\b/ },
};
const VOLUME_ALIASES: Record<string, keyof typeof VOLUME> = {
  cup: "cup", cups: "cup", c: "cup", taza: "cup", tazas: "cup",
  tbsp: "tbsp", tbs: "tbsp", tbl: "tbsp", tablespoon: "tbsp", tablespoons: "tbsp", cucharada: "tbsp", cucharadas: "tbsp",
  tsp: "tsp", teaspoon: "tsp", teaspoons: "tsp", cucharadita: "tsp", cucharaditas: "tsp",
  "fl oz": "fl oz", floz: "fl oz", "fluid ounce": "fl oz", "fluid ounces": "fl oz",
  quart: "quart", quarts: "quart", qt: "quart", pint: "pint", pints: "pint", pt: "pint",
};
const MILLILITRES: Record<string, number> = { ml: 1, millilitre: 1, milliliter: 1, millilitres: 1, milliliters: 1, cc: 1, l: 1000, litre: 1000, liter: 1000, litres: 1000, liters: 1000, dl: 100, cl: 10 };

/** Words that never give an amount. */
const VAGUE = /\b(pinch|dash|to taste|some|splash|handful|al gusto|una pizca|as needed|optional)\b/;
/** Portion words preferred, in order, when a count comes with no unit ("2 eggs", "1 onion"). */
const PLAIN_COUNT = ["medium", "large", "whole", "each", "item", "fruit", "piece", "clove", "slice", "small"];

/** Units that only say "one of them". */
const GENERIC_COUNT = new Set(["whole", "each", "piece", "unit", "unidad", "item", "pc", "pcs", "ea"]);

const fold = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[.()]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** "1.0 cup, chopped" is one cup; "3.0 cloves" is three. */
function labelCount(label: string): number {
  const m = /^(\d+(?:\.\d+)?)\s/.exec(label);
  return m ? Number(m[1]) : 1;
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

function portionFor(food: Pick<FoodRecord, "portions">, match: (label: string) => boolean): number {
  const labels = food.portions.map((p) => fold(p.label));
  const ones = labels.map((l, i) => (labelCount(l) === 1 && match(l) ? i : -1)).filter((i) => i >= 0);
  if (ones.length) return ones[0]!;
  return labels.findIndex((l) => match(l));
}

export function amountFromText(quantity: number | null, unitText: string, food: Pick<FoodRecord, "portions"> | undefined): IngredientAmount | null {
  const unit = fold(unitText);
  if (VAGUE.test(unit)) return null;
  if (quantity === null || !Number.isFinite(quantity) || quantity <= 0) return null;

  const mass = MASS[unit];
  if (mass) return { quantity: round(quantity), unit: mass, portionIndex: null };
  if (!food) return null;

  // Volumes: through the food's own cup, tablespoon or teaspoon portion, never a guessed density.
  const volumeKey = VOLUME_ALIASES[unit];
  const ml = volumeKey ? quantity * VOLUME[volumeKey]!.ml : MILLILITRES[unit] !== undefined ? quantity * MILLILITRES[unit]! : null;
  if (ml !== null) {
    const order: (keyof typeof VOLUME)[] = volumeKey ? [volumeKey, "cup", "tbsp", "tsp", "fl oz"] : ["cup", "tbsp", "tsp", "fl oz"];
    for (const key of order) {
      const index = portionFor(food, (l) => VOLUME[key]!.label.test(l));
      if (index < 0) continue;
      const portionMl = VOLUME[key]!.ml * labelCount(fold(food.portions[index]!.label));
      return { quantity: round(ml / portionMl), unit: "portion", portionIndex: index };
    }
    return null;
  }

  // Counts: "3 cloves", "1 medium", "2 slices", or a bare number ("2 eggs").
  const words = unit.split(" ").filter(Boolean).map(singular);
  const countMatch = (l: string) => {
    const lw = l.split(/[^a-z]+/).filter(Boolean).map(singular);
    return words.some((w) => lw.includes(w));
  };
  let index = words.length ? portionFor(food, countMatch) : -1;
  if (index < 0 && words.every((w) => GENERIC_COUNT.has(w))) {
    for (const w of PLAIN_COUNT) {
      index = portionFor(food, (l) => l.split(/[^a-z]+/).map(singular).includes(w));
      if (index >= 0) break;
    }
  }
  if (index < 0) return null;
  return { quantity: round(quantity / labelCount(fold(food.portions[index]!.label))), unit: "portion", portionIndex: index };
}
