import type { NutrientTotal } from "./types.ts";

/** Scales per-serving totals by servings eaten. Unknown stays unknown; partial stays partial. */
export function scaleTotals(totals: NutrientTotal[], factor: number): NutrientTotal[] {
  return totals.map((t) => ({ ...t, amount: t.amount === null ? null : t.amount * factor }));
}

export interface DayTotal extends NutrientTotal {
  /** Number of logged meals that do not report this nutrient at all. */
  mealsMissing: number;
}

/**
 * Sums logged meals for one day. A nutrient is "known" only if every meal knows it fully;
 * any gap makes it "partial" (a lower bound), and if no meal reports it, it is "unknown".
 * Planned meals must never be passed here: plans are not food eaten.
 */
export function sumMeals(meals: NutrientTotal[][]): DayTotal[] {
  const byKey = new Map<string, DayTotal>();
  for (const meal of meals) {
    for (const t of meal) {
      const cur = byKey.get(t.key) ?? { key: t.key, unit: t.unit, amount: null, status: "known" as const, missingFrom: [], mealsMissing: 0 };
      if (t.amount !== null) cur.amount = (cur.amount ?? 0) + t.amount;
      if (t.status === "unknown") cur.mealsMissing += 1;
      cur.missingFrom = [...cur.missingFrom, ...t.missingFrom];
      byKey.set(t.key, cur);
    }
  }
  for (const t of byKey.values()) {
    const gaps = t.mealsMissing > 0 || t.missingFrom.length > 0;
    t.status = t.amount === null ? "unknown" : gaps ? "partial" : "known";
  }
  return [...byKey.values()];
}

export interface DailyValue {
  key: string;
  amount: number;
  unit: string;
}

/**
 * Percent of a daily value: a published reference or a target the person typed in. Returns
 * null when there is none for the nutrient, the units differ, or the amount is unknown.
 * Never a diagnosis.
 */
export function percentDailyValue(total: Pick<NutrientTotal, "key" | "amount" | "unit">, dailyValues: DailyValue[]): number | null {
  const dv = dailyValues.find((d) => d.key === total.key);
  if (!dv || dv.unit !== total.unit || total.amount === null) return null;
  return (total.amount / dv.amount) * 100;
}
