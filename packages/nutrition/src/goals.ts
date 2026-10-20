import type { DayTotal } from "./meals.ts";

/**
 * Period summaries and the person's own consumption goals. Pure functions over what was eaten
 * (logged meals only, never plans). Dates are calendar days (YYYY-MM-DD) in the person's own
 * time zone. A nutrient no meal reports stays unknown, never zero; a day with nothing logged is
 * missing, never an empty day.
 */

export type GoalKind = "at_least" | "at_most" | "between";
export type GoalPeriod = "day" | "week" | "month";

export interface GoalSpec {
  nutrientKey: string;
  unit: string;
  kind: GoalKind;
  /** Lower bound for at_least and between. */
  min: number | null;
  /** Upper bound for at_most and between. */
  max: number | null;
  period: GoalPeriod;
  startDate: string;
  /** Last day the goal applies; null keeps it going. */
  endDate: string | null;
}

/** What was eaten on one day that has at least one logged meal. */
export interface DayIntake {
  date: string;
  totals: DayTotal[];
}

// ---------------------------------------------------------------- calendar days

const toUtc = (date: string) => {
  const [y, m, d] = date.split("-").map(Number);
  return Date.UTC(y!, m! - 1, d!);
};
const fromUtc = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export function shiftDate(date: string, days: number): string {
  return fromUtc(toUtc(date) + days * 86_400_000);
}

/** Number of calendar days from `from` to `to`, both included (0 if `to` is before `from`). */
export function dayCount(from: string, to: string): number {
  return Math.max(0, Math.round((toUtc(to) - toUtc(from)) / 86_400_000) + 1);
}

const minDate = (a: string, b: string) => (a < b ? a : b);
const maxDate = (a: string, b: string) => (a > b ? a : b);

/** The calendar period containing `date`: the day itself, its Monday-to-Sunday week, or its month. */
export function periodWindow(period: GoalPeriod, date: string): { from: string; to: string } {
  if (period === "day") return { from: date, to: date };
  if (period === "week") {
    const weekday = (new Date(toUtc(date)).getUTCDay() + 6) % 7; // Monday = 0
    const from = shiftDate(date, -weekday);
    return { from, to: shiftDate(from, 6) };
  }
  const [y, m] = date.split("-").map(Number);
  const from = `${date.slice(0, 7)}-01`;
  return { from, to: fromUtc(Date.UTC(y!, m!, 0)) };
}

// ---------------------------------------------------------------- period summary

export interface NutrientSummary {
  key: string;
  unit: string;
  /** Sum over logged days; null when no logged meal reports it. */
  total: number | null;
  /** Total divided by days with something logged; null when total is null. */
  averagePerLoggedDay: number | null;
  /** known: every logged meal reports it. partial: some don't, so the total is a lower bound. */
  status: "known" | "partial" | "unknown";
}

export interface PeriodSummary {
  from: string;
  to: string;
  days: number;
  daysLogged: number;
  /** Fewer logged days than days in the range: totals cover only what was logged. */
  incomplete: boolean;
  nutrients: NutrientSummary[];
}

export function summarizePeriod(intake: DayIntake[], from: string, to: string): PeriodSummary {
  const days = intake.filter((d) => d.date >= from && d.date <= to);
  const byKey = new Map<string, { unit: string; total: number | null; gaps: boolean }>();
  for (const day of days) {
    for (const t of day.totals) {
      const cur = byKey.get(t.key) ?? { unit: t.unit, total: null, gaps: false };
      if (t.amount !== null) cur.total = (cur.total ?? 0) + t.amount;
      if (t.status !== "known") cur.gaps = true;
      byKey.set(t.key, cur);
    }
  }
  const nutrients: NutrientSummary[] = [...byKey].map(([key, v]) => ({
    key,
    unit: v.unit,
    total: v.total,
    averagePerLoggedDay: v.total === null ? null : v.total / days.length,
    status: v.total === null ? "unknown" : v.gaps ? "partial" : "known",
  }));
  const span = dayCount(from, to);
  return { from, to, days: span, daysLogged: days.length, incomplete: days.length < span, nutrients };
}

// ---------------------------------------------------------------- goals

/**
 * met: within the goal. below / above: outside it so far. no_data: nothing logged that reports
 * the nutrient. These are facts about logged food against the person's own numbers, never a
 * judgement or a diagnosis.
 */
export type GoalStatus = "met" | "below" | "above" | "no_data";

export interface GoalWindowProgress {
  from: string;
  to: string;
  amount: number | null;
  status: GoalStatus;
  /** The window includes or follows the date asked about, so more meals may still count. */
  inProgress: boolean;
  days: number;
  daysLogged: number;
  /** Some logged meals don't report the nutrient, so the amount is a lower bound. */
  partialData: boolean;
}

export interface GoalProgress {
  state: "upcoming" | "active" | "ended";
  /** The current window when active, the last one when ended, the first one when upcoming. */
  current: GoalWindowProgress;
  /** Earlier windows that have ended, newest first (at most `history`). */
  past: GoalWindowProgress[];
  /** Of those ended windows, how many were met. */
  pastMet: number;
}

function statusFor(goal: GoalSpec, amount: number | null): GoalStatus {
  if (amount === null) return "no_data";
  if (goal.min !== null && (goal.kind === "at_least" || goal.kind === "between") && amount < goal.min) return "below";
  if (goal.max !== null && (goal.kind === "at_most" || goal.kind === "between") && amount > goal.max) return "above";
  return "met";
}

function windowProgress(goal: GoalSpec, intake: DayIntake[], period: { from: string; to: string }, asOf: string): GoalWindowProgress {
  // A window never reaches outside the goal's own dates.
  const from = maxDate(period.from, goal.startDate);
  const to = goal.endDate ? minDate(period.to, goal.endDate) : period.to;
  const summary = summarizePeriod(intake, from, to);
  const n = summary.nutrients.find((x) => x.key === goal.nutrientKey && x.unit === goal.unit);
  const amount = n?.total ?? null;
  return {
    from,
    to,
    amount,
    status: statusFor(goal, amount),
    inProgress: asOf <= to,
    days: summary.days,
    daysLogged: summary.daysLogged,
    partialData: n ? n.status !== "known" : summary.daysLogged > 0,
  };
}

/** Progress on one goal as of a day, plus up to `history` ended windows before it. */
export function goalProgress(goal: GoalSpec, intake: DayIntake[], asOf: string, history = 7): GoalProgress {
  const state = asOf < goal.startDate ? "upcoming" : goal.endDate && asOf > goal.endDate ? "ended" : "active";
  const anchor = state === "upcoming" ? goal.startDate : state === "ended" ? goal.endDate! : asOf;
  const current = windowProgress(goal, intake, periodWindow(goal.period, anchor), asOf);
  const past: GoalWindowProgress[] = [];
  let cursor = shiftDate(current.from, -1);
  while (past.length < history && cursor >= goal.startDate) {
    const w = windowProgress(goal, intake, periodWindow(goal.period, cursor), asOf);
    past.push(w);
    cursor = shiftDate(w.from, -1);
  }
  return { state, current, past, pastMet: past.filter((w) => w.status === "met").length };
}

/** Checks a goal's own numbers and dates; returns a message for the first problem, or null. */
export function goalProblem(goal: Pick<GoalSpec, "kind" | "min" | "max" | "startDate" | "endDate">): string | null {
  const needsMin = goal.kind === "at_least" || goal.kind === "between";
  const needsMax = goal.kind === "at_most" || goal.kind === "between";
  if (needsMin && (goal.min === null || !(goal.min > 0))) return "Set the lower amount";
  if (needsMax && (goal.max === null || !(goal.max > 0))) return "Set the upper amount";
  if (!needsMin && goal.min !== null) return "This kind of goal has no lower amount";
  if (!needsMax && goal.max !== null) return "This kind of goal has no upper amount";
  if (goal.kind === "between" && goal.min! > goal.max!) return "The lower amount must not be above the upper amount";
  if (goal.endDate !== null && goal.endDate < goal.startDate) return "The end date must be on or after the start date";
  return null;
}
