import { useMemo } from "react";
import type { GoalBody } from "@betterplate/contracts";
import type { DailyValue, DayIntake, FoodRecord, NutrientDefinition } from "@betterplate/nutrition";
import { sumMeals } from "@betterplate/nutrition";
import type { LocalGoal, LocalLog } from "./localdb.ts";
import { localDate, logEaten } from "./meals.ts";
import { useApp } from "./store.tsx";
import { formatQty, t } from "./i18n.ts";

/** Daily goals in effect today, as the amount percentages compare with (the lower bound, else the upper). */
export function dailyTargets(goals: LocalGoal[], today = localDate()): DailyValue[] {
  return goals
    .filter((g) => g.body.period === "day" && g.body.startDate <= today && (g.body.endDate === null || g.body.endDate >= today))
    .map((g) => ({ key: g.body.nutrientKey, unit: g.body.unit, amount: (g.body.min ?? g.body.max)! }));
}

export function useDailyTargets(): DailyValue[] {
  const { goals } = useApp();
  return useMemo(() => dailyTargets(goals), [goals]);
}

/** What was eaten each day with logged meals: logs only, plans never count. */
export function intakeByDay(logs: LocalLog[], foods: Map<string, FoodRecord>, defs: NutrientDefinition[]): DayIntake[] {
  const byDate = new Map<string, LocalLog[]>();
  for (const log of logs) byDate.set(log.body.localDate, [...(byDate.get(log.body.localDate) ?? []), log]);
  return [...byDate].map(([date, dayLogs]) => ({ date, totals: sumMeals(dayLogs.map((l) => logEaten(l, foods, defs))) }));
}

export function isActive(goal: GoalBody, today = localDate()): boolean {
  return goal.startDate <= today && (goal.endDate === null || goal.endDate >= today);
}

const PER = { day: "goals.per.day", week: "goals.per.week", month: "goals.per.month" } as const;

/** "At least 120 g a day", in the nutrient's unit. */
export function goalSentence(goal: GoalBody): string {
  const per = t(PER[goal.period]);
  if (goal.kind === "at_least") return t("goals.sentence.atLeast", { amount: formatQty(goal.min, goal.unit), per });
  if (goal.kind === "at_most") return t("goals.sentence.atMost", { amount: formatQty(goal.max, goal.unit), per });
  return t("goals.sentence.between", { min: formatQty(goal.min, goal.unit), max: formatQty(goal.max, goal.unit), per });
}
