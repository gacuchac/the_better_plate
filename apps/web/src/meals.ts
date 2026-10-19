import type { MealSlot } from "@betterplate/contracts";
import { calculateRecipe, scaleTotals, sumMeals, type FoodRecord, type NutrientDefinition, type NutrientTotal } from "@betterplate/nutrition";
import type { LocalLog, LocalPlan } from "./localdb.ts";
import { dateLocale, t } from "./i18n.ts";

/** The person's own calendar day, YYYY-MM-DD, in their current time zone. */
export function localDate(d = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return localDate(new Date(y!, m! - 1, d! + days));
}

export function formatDay(date: string, opts: Intl.DateTimeFormatOptions = { weekday: "long", day: "numeric", month: "long" }): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y!, m! - 1, d!).toLocaleDateString(dateLocale(), opts);
}

export function dayName(date: string, today = localDate()): string {
  if (date === today) return t("day.today");
  if (date === addDays(today, -1)) return t("day.yesterday");
  if (date === addDays(today, 1)) return t("day.tomorrow");
  return formatDay(date, { weekday: "long" });
}

export const SLOTS: { value: MealSlot }[] = [{ value: "breakfast" }, { value: "lunch" }, { value: "dinner" }, { value: "snack" }];
const SLOT_KEYS = { breakfast: "slot.breakfast", lunch: "slot.lunch", dinner: "slot.dinner", snack: "slot.snack" } as const;
export const slotLabel = (s: MealSlot) => t(SLOT_KEYS[s]);

/** When something was eaten on a day, as an ISO time with the person's offset: now for today, midday otherwise. */
export function eatenAtFor(date: string, now = new Date()): string {
  const eatenAt = date === localDate(now) ? now : new Date(`${date}T12:00:00`);
  const off = -eatenAt.getTimezoneOffset();
  const sign = off >= 0 ? "+" : "-";
  const pad = (n: number) => String(Math.floor(Math.abs(n))).padStart(2, "0");
  return `${localDate(eatenAt)}T${pad(eatenAt.getHours())}:${pad(eatenAt.getMinutes())}:${pad(eatenAt.getSeconds())}${sign}${pad(off / 60)}:${pad(off % 60)}`;
}

/** A sensible default slot for "I ate this" right now; the person can change it. */
export function slotForNow(d = new Date()): MealSlot {
  const h = d.getHours();
  if (h < 11) return "breakfast";
  if (h < 16) return "lunch";
  if (h < 22) return "dinner";
  return "snack";
}

/**
 * What one log contributes. Synced logs use the server's frozen snapshot; logs still on this
 * device use the same deterministic engine on the recipe snapshot as eaten.
 */
export function logEaten(log: LocalLog, foods: Map<string, FoodRecord>, defs: NutrientDefinition[]): NutrientTotal[] {
  const perServing = log.nutrition?.perServing ?? calculateRecipe(log.body.recipe, foods, defs).perServing;
  return scaleTotals(perServing, log.body.servings);
}

export interface DaySummary {
  date: string;
  logs: LocalLog[];
  plans: LocalPlan[];
  /** Plans with no log that fulfils them. */
  openPlans: LocalPlan[];
  /** Sum of logged meals only, or null when nothing is logged (never zeros). */
  totals: ReturnType<typeof sumMeals> | null;
}

export function summarizeDay(date: string, logs: LocalLog[], plans: LocalPlan[], foods: Map<string, FoodRecord>, defs: NutrientDefinition[]): DaySummary {
  const dayLogs = logs.filter((l) => l.body.localDate === date).sort((a, b) => a.body.eatenAt.localeCompare(b.body.eatenAt));
  const dayPlans = plans.filter((p) => p.body.date === date).sort((a, b) => SLOTS.findIndex((s) => s.value === a.body.slot) - SLOTS.findIndex((s) => s.value === b.body.slot));
  const fulfilled = new Set(logs.map((l) => l.body.plannedMealId).filter(Boolean));
  return {
    date,
    logs: dayLogs,
    plans: dayPlans,
    openPlans: dayPlans.filter((p) => !fulfilled.has(p.id)),
    totals: dayLogs.length ? sumMeals(dayLogs.map((l) => logEaten(l, foods, defs))) : null,
  };
}
