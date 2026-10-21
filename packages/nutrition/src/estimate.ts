/**
 * Goal estimates for adults (19 and older) from published Dietary Reference Intakes (DRIs).
 * Pure functions: nothing here stores, sends or logs what it is given. The app runs them in the
 * browser while a calculator sheet is open and keeps only the goals the person accepts.
 *
 * Reference amounts, not diagnoses or prescriptions. Energy is the National Academies' estimate for
 * keeping weight steady; people with other aims, health conditions, pregnancy or breastfeeding
 * should not treat it as theirs. Values below are copied from the sources in {@link DRI_SOURCES}.
 */

export const DRI_SOURCES = {
  energy: {
    publisher: "National Academies of Sciences, Engineering, and Medicine",
    title: "Dietary Reference Intakes for Energy (2023)",
    detail: "Table S-3: EER equations based on TEE prediction, adults 19+ years; Table 5-4: PAL categories; Table 7-1: example daily activities",
    url: "https://nap.nationalacademies.org/read/26818/chapter/2",
    doi: "10.17226/26818",
    retrievedAt: "2026-10-21",
  },
  macronutrientsAndWater: {
    publisher: "Institute of Medicine (now the National Academies)",
    title: "DRI Summary Tables: Total Water and Macronutrients; Acceptable Macronutrient Distribution Ranges (as printed in Dietary Reference Intakes for Water, Potassium, Sodium, Chloride, and Sulfate, 2005)",
    detail: "From Dietary Reference Intakes for Energy, Carbohydrate, Fiber, Fat, Fatty Acids, Cholesterol, Protein, and Amino Acids (2002/2005) and the 2005 water report",
    url: "https://nap.nationalacademies.org/read/10925/chapter/25",
    doi: "10.17226/10925",
    retrievedAt: "2026-10-21",
  },
} as const;

export type EstimateSex = "female" | "male";
export type ActivityLevel = "inactive" | "low_active" | "active" | "very_active";

export const ACTIVITY_LEVELS: ActivityLevel[] = ["inactive", "low_active", "active", "very_active"];

/** Adult limits the equations were built for; anything else is refused, not extrapolated. */
export const ESTIMATE_LIMITS = {
  age: { min: 19, max: 110 },
  heightCm: { min: 120, max: 230 },
  weightKg: { min: 30, max: 300 },
} as const;

export interface EstimateInput {
  sex: EstimateSex;
  /** Whole years. */
  age: number;
  heightCm: number;
  weightKg: number;
  activity: ActivityLevel;
}

/**
 * TEE (= EER for a weight-stable adult), kcal/day: intercept − age×a + height×b + weight×c.
 * Table S-3, adults 19+. `rmse` is the equation's reported root mean squared error (kcal/day).
 */
const ENERGY = {
  male: {
    ageCoefficient: 10.83,
    rmse: 339,
    levels: {
      inactive: { intercept: 753.07, height: 6.5, weight: 14.1 },
      low_active: { intercept: 581.47, height: 8.3, weight: 14.94 },
      active: { intercept: 1004.82, height: 6.52, weight: 15.91 },
      very_active: { intercept: -517.88, height: 15.61, weight: 19.11 },
    },
  },
  female: {
    ageCoefficient: 7.01,
    rmse: 246,
    levels: {
      inactive: { intercept: 584.9, height: 5.72, weight: 11.71 },
      low_active: { intercept: 575.77, height: 6.6, weight: 12.14 },
      active: { intercept: 710.25, height: 6.54, weight: 12.34 },
      very_active: { intercept: 511.83, height: 9.07, weight: 12.56 },
    },
  },
} as const;

/** Adult PAL ranges (Table 5-4), for showing what each activity level means. */
export const PAL_RANGES: Record<ActivityLevel, { from: number; to: number }> = {
  inactive: { from: 1.0, to: 1.53 },
  low_active: { from: 1.53, to: 1.68 },
  active: { from: 1.68, to: 1.85 },
  very_active: { from: 1.85, to: 2.5 },
};

/** Acceptable Macronutrient Distribution Ranges for adults, percent of energy. */
export const AMDR = {
  protein: { from: 10, to: 35 },
  fat: { from: 20, to: 35 },
  carbohydrate: { from: 45, to: 65 },
} as const;

/** Energy per gram (Atwater general factors) used to turn percent of energy into grams. */
const KCAL_PER_G = { protein: 4, carbohydrate: 4, fat: 9 } as const;

/** Protein RDA (0.8 g/kg of reference body weight) as printed for adults, g/day. */
const PROTEIN_RDA_G = { male: 56, female: 46 } as const;
/** Carbohydrate RDA, g/day, adults. */
const CARBOHYDRATE_RDA_G = 130;
/** Total fibre AI, g/day: [19–50 years, 51 years and older]. */
const FIBER_AI_G = { male: [38, 30], female: [25, 21] } as const;
/** Total water AI (food, drinks and drinking water), litres/day, adults. */
const WATER_AI_L = { male: 3.7, female: 2.7 } as const;

export type EstimateProblem = "age" | "height" | "weight";

/** The first input outside what the equations cover, or null when all fit. */
export function estimateProblem(input: Partial<Record<"age" | "heightCm" | "weightKg", number>>): EstimateProblem | null {
  const ok = (v: number | undefined, r: { min: number; max: number }) => typeof v === "number" && Number.isFinite(v) && v >= r.min && v <= r.max;
  if (!ok(input.age, ESTIMATE_LIMITS.age) || !Number.isInteger(input.age)) return "age";
  if (!ok(input.heightCm, ESTIMATE_LIMITS.heightCm)) return "height";
  if (!ok(input.weightKg, ESTIMATE_LIMITS.weightKg)) return "weight";
  return null;
}

/** Estimated daily energy for keeping weight steady, kcal, unrounded. */
export function estimateEnergyKcal(input: EstimateInput): number {
  const sex = ENERGY[input.sex];
  const lvl = sex.levels[input.activity];
  return lvl.intercept - sex.ageCoefficient * input.age + lvl.height * input.heightCm + lvl.weight * input.weightKg;
}

export interface GoalSuggestion {
  /** Catalog nutrient key. */
  nutrientKey: string;
  unit: string;
  kind: "at_least" | "between";
  min: number | null;
  max: number | null;
  /** Which published value each number comes from, so the screen can say how it was worked out. */
  basis: "energy" | "protein" | "fat" | "carbohydrate" | "fiber" | "water";
  source: keyof typeof DRI_SOURCES;
}

export interface Estimate {
  /** Estimated energy for steady weight, kcal/day, rounded to 10. */
  energyKcal: number;
  /** The equation's typical error (RMSE), kcal/day. */
  energyRmse: number;
  suggestions: GoalSuggestion[];
}

const roundTo = (v: number, step: number) => Math.round(v / step) * step;

/** Suggested daily goals for an adult; throws on input the equations don't cover. */
export function estimateGoals(input: EstimateInput): Estimate {
  const problem = estimateProblem(input);
  if (problem) throw new RangeError(`Input outside what the estimates cover: ${problem}`);
  const energy = roundTo(estimateEnergyKcal(input), 10);
  const rmse = ENERGY[input.sex].rmse;
  const grams = (macro: keyof typeof AMDR, percent: number) => roundTo((energy * percent) / 100 / KCAL_PER_G[macro], 5);
  const range = (lo: number, hi: number) => ({ min: Math.min(lo, hi), max: hi });
  const fiber = FIBER_AI_G[input.sex][input.age >= 51 ? 1 : 0];
  return {
    energyKcal: energy,
    energyRmse: rmse,
    suggestions: [
      { nutrientKey: "energy_kcal", unit: "kcal", kind: "between", ...range(roundTo(energy - rmse, 10), roundTo(energy + rmse, 10)), basis: "energy", source: "energy" },
      { nutrientKey: "protein", unit: "g", kind: "between", ...range(Math.max(grams("protein", AMDR.protein.from), PROTEIN_RDA_G[input.sex]), grams("protein", AMDR.protein.to)), basis: "protein", source: "macronutrientsAndWater" },
      { nutrientKey: "fat_total", unit: "g", kind: "between", ...range(grams("fat", AMDR.fat.from), grams("fat", AMDR.fat.to)), basis: "fat", source: "macronutrientsAndWater" },
      { nutrientKey: "carbohydrate", unit: "g", kind: "between", ...range(Math.max(grams("carbohydrate", AMDR.carbohydrate.from), CARBOHYDRATE_RDA_G), grams("carbohydrate", AMDR.carbohydrate.to)), basis: "carbohydrate", source: "macronutrientsAndWater" },
      { nutrientKey: "fiber", unit: "g", kind: "at_least", min: fiber, max: null, basis: "fiber", source: "macronutrientsAndWater" },
      // Stored in grams like the USDA data (1 ml of water weighs 1 g).
      { nutrientKey: "water", unit: "g", kind: "at_least", min: WATER_AI_L[input.sex] * 1000, max: null, basis: "water", source: "macronutrientsAndWater" },
    ],
  };
}
