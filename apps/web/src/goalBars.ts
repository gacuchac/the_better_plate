import type { DailyValue, DayIntake, GoalStatus } from "@betterplate/nutrition";
import { summarizePeriod, WATER_KEY } from "@betterplate/nutrition";
import type { LocalGoal } from "./localdb.ts";

/**
 * Eaten against the person's own daily goals over a chosen range: the average per logged day
 * while each goal was in effect. Only daily goals compare this way; weekly and monthly goals keep
 * their own windows on the Goals screen. Logs only, plans never; unreported stays unknown.
 * Each bar can also show the FDA label Daily Value for the nutrient, a reference, not a target.
 */
export interface GoalBar {
  goal: LocalGoal;
  /** Average per logged day in the goal's days of the range; null when nothing logged reports it. */
  amount: number | null;
  /** Some logged meals don't report the nutrient, so the amount is a lower bound. */
  partial: boolean;
  daysLogged: number;
  status: GoalStatus;
  /** FDA Daily Value for the nutrient in the goal's unit, if there is one. */
  dailyValue: number | null;
}

/** A nutrient with an FDA Daily Value but no daily goal: eaten next to the reference only. */
export interface ReferenceBar {
  key: string;
  unit: string;
  amount: number | null;
  partial: boolean;
  dailyValue: number;
}

const dvFor = (dvs: DailyValue[], key: string, unit: string) => dvs.find((d) => d.key === key && d.unit === unit)?.amount ?? null;

/** Daily goals that apply on some day of the range. */
export function dailyGoalsIn(goals: LocalGoal[], from: string, to: string): LocalGoal[] {
  return goals.filter((g) => !g.deleted && g.body.period === "day" && g.body.startDate <= to && (g.body.endDate === null || g.body.endDate >= from));
}

/** `water` is the water-only intake (drinks plus water in food) that water goals compare with. */
export function goalBars(goals: LocalGoal[], intake: DayIntake[], from: string, to: string, dailyValues: DailyValue[] = [], water: DayIntake[] = intake): GoalBar[] {
  return dailyGoalsIn(goals, from, to).map((goal) => {
    const { body } = goal;
    const start = body.startDate > from ? body.startDate : from;
    const end = body.endDate !== null && body.endDate < to ? body.endDate : to;
    const summary = summarizePeriod(body.nutrientKey === WATER_KEY ? water : intake, start, end);
    const n = summary.nutrients.find((x) => x.key === body.nutrientKey && x.unit === body.unit);
    const amount = n?.averagePerLoggedDay ?? null;
    const status: GoalStatus =
      amount === null ? "no_data" : body.min !== null && amount < body.min ? "below" : body.max !== null && amount > body.max ? "above" : "met";
    return { goal, amount, partial: n?.status === "partial", daysLogged: summary.daysLogged, status, dailyValue: dvFor(dailyValues, body.nutrientKey, body.unit) };
  });
}

/** Nutrients with a Daily Value and no daily goal in the range, in the Daily Value list's order. */
export function referenceBars(goals: LocalGoal[], intake: DayIntake[], from: string, to: string, dailyValues: DailyValue[]): ReferenceBar[] {
  const withGoal = new Set(dailyGoalsIn(goals, from, to).map((g) => `${g.body.nutrientKey}|${g.body.unit}`));
  const summary = summarizePeriod(intake, from, to);
  return dailyValues
    .filter((dv) => !withGoal.has(`${dv.key}|${dv.unit}`))
    .map((dv) => {
      const n = summary.nutrients.find((x) => x.key === dv.key && x.unit === dv.unit);
      return { key: dv.key, unit: dv.unit, amount: n?.averagePerLoggedDay ?? null, partial: n?.status === "partial", dailyValue: dv.amount };
    });
}

/** Each bar's own scale (units differ): a little past the largest of eaten, the goal's top and the Daily Value. */
export function barScale(bar: Pick<GoalBar, "amount" | "goal"> & { dailyValue?: number | null }): number {
  const top = Math.max(bar.amount ?? 0, bar.goal.body.max ?? bar.goal.body.min ?? 0, bar.dailyValue ?? 0);
  return top > 0 ? top * 1.1 : 1;
}

export function referenceScale(bar: Pick<ReferenceBar, "amount" | "dailyValue">): number {
  return Math.max(bar.amount ?? 0, bar.dailyValue) * 1.1;
}
