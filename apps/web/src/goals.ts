import { useMemo } from "react";
import type { GoalBody } from "@betterplate/contracts";
import type { DailyValue, DayIntake, FoodRecord, NutrientDefinition } from "@betterplate/nutrition";
import { sumMeals, waterIntake } from "@betterplate/nutrition";
import type { LocalGoal, LocalLog, LocalWater } from "./localdb.ts";
import { localDate, logEaten } from "./meals.ts";
import { useApp } from "./store.tsx";
import { formatNutrient, t } from "./i18n.ts";

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

/** Water each day: drinks logged plus water in logged meals, for water goals. */
export function waterIntakeByDay(intake: DayIntake[], water: LocalWater[]): DayIntake[] {
  return waterIntake(intake, water.map((w) => w.body));
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
  const qty = (v: number | null) => formatNutrient(goal.nutrientKey, v, goal.unit);
  if (goal.kind === "at_least") return t("goals.sentence.atLeast", { amount: qty(goal.min), per });
  if (goal.kind === "at_most") return t("goals.sentence.atMost", { amount: qty(goal.max), per });
  return t("goals.sentence.between", { min: qty(goal.min), max: qty(goal.max), per });
}
