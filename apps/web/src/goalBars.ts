import type { DayIntake, GoalStatus } from "@betterplate/nutrition";
import { summarizePeriod } from "@betterplate/nutrition";
import type { LocalGoal } from "./localdb.ts";

/**
 * Eaten against the person's own daily goals over a chosen range: the average per logged day
 * while each goal was in effect. Only daily goals compare this way; weekly and monthly goals keep
 * their own windows on the Goals screen. Logs only, plans never; unreported stays unknown.
 */
export interface GoalBar {
  goal: LocalGoal;
  /** Average per logged day in the goal's days of the range; null when nothing logged reports it. */
  amount: number | null;
  /** Some logged meals don't report the nutrient, so the amount is a lower bound. */
  partial: boolean;
  daysLogged: number;
  status: GoalStatus;
}

export function goalBars(goals: LocalGoal[], intake: DayIntake[], from: string, to: string): GoalBar[] {
  return goals
    .filter((g) => !g.deleted && g.body.period === "day" && g.body.startDate <= to && (g.body.endDate === null || g.body.endDate >= from))
    .map((goal) => {
      const { body } = goal;
      const start = body.startDate > from ? body.startDate : from;
      const end = body.endDate !== null && body.endDate < to ? body.endDate : to;
      const summary = summarizePeriod(intake, start, end);
      const n = summary.nutrients.find((x) => x.key === body.nutrientKey && x.unit === body.unit);
      const amount = n?.averagePerLoggedDay ?? null;
      const status: GoalStatus =
        amount === null ? "no_data" : body.min !== null && amount < body.min ? "below" : body.max !== null && amount > body.max ? "above" : "met";
      return { goal, amount, partial: n?.status === "partial", daysLogged: summary.daysLogged, status };
    });
}

/** Each bar's own scale (units differ): a little past the larger of eaten and the goal's top. */
export function barScale(bar: Pick<GoalBar, "amount" | "goal">): number {
  const top = Math.max(bar.amount ?? 0, bar.goal.body.max ?? bar.goal.body.min ?? 0);
  return top > 0 ? top * 1.1 : 1;
}
