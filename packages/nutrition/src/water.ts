import type { DayIntake } from "./goals.ts";
import type { DayTotal } from "./meals.ts";

/**
 * Water: drinks the person logged plus the water inside the foods of logged meals (USDA nutrient
 * 1051, grams; 1 ml of water weighs 1 g). Plans never count. Water in food is an estimate from
 * foods as weighed, so water a food soaks up while cooking (pasta, rice) is not counted.
 */
export const WATER_KEY = "water";
export const WATER_UNIT = "g";

export interface Drink {
  localDate: string;
  amountMl: number;
}

export interface WaterDay {
  date: string;
  drinksMl: number;
  /** Water in logged meals; null when nothing logged that day reports it. */
  foodMl: number | null;
  /** Some logged meals don't report water, so foodMl is a lower bound. */
  foodPartial: boolean;
}

export function waterDays(intake: DayIntake[], drinks: Drink[]): WaterDay[] {
  const days = new Map<string, WaterDay>();
  const day = (date: string) => days.get(date) ?? { date, drinksMl: 0, foodMl: null, foodPartial: false };
  for (const d of intake) {
    const w = d.totals.find((t) => t.key === WATER_KEY && t.unit === WATER_UNIT);
    days.set(d.date, { ...day(d.date), foodMl: w?.amount ?? null, foodPartial: w ? w.status !== "known" : true });
  }
  for (const d of drinks) {
    const cur = day(d.localDate);
    days.set(d.localDate, { ...cur, drinksMl: cur.drinksMl + d.amountMl });
  }
  return [...days.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Water-only daily intake (drinks plus water in food) for comparing with water goals, so goal
 * math stays the same as for nutrients. A day counts once anything was drunk or eaten; food water
 * a meal doesn't report makes the day partial, never zero.
 */
export function waterIntake(intake: DayIntake[], drinks: Drink[]): DayIntake[] {
  return waterDays(intake, drinks).map((d) => {
    const ateSomething = intake.some((x) => x.date === d.date);
    const amount = d.drinksMl + (d.foodMl ?? 0);
    const gaps = ateSomething && d.foodPartial;
    const total: DayTotal = {
      key: WATER_KEY,
      unit: WATER_UNIT,
      amount: d.drinksMl === 0 && d.foodMl === null ? null : amount,
      status: d.drinksMl === 0 && d.foodMl === null ? "unknown" : gaps ? "partial" : "known",
      missingFrom: [],
      mealsMissing: 0,
    };
    return { date: d.date, totals: [total] };
  });
}
