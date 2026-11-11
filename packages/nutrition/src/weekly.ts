import { dayCount, shiftDate, type DayIntake, type GoalKind, type GoalSpec, type GoalStatus } from "./goals.ts";

/**
 * Goal history and the rolling seven days. A daily goal can change during a week, so the week's
 * target adds up the goal that applied on each day, never seven times today's goal. Logged meals
 * only, plans never; a nutrient no meal reports stays unknown, not zero.
 */

// ---------------------------------------------------------------- goal history

/** What an edit does: overwrite the goal, or end it the day before and start a new one. */
export type GoalRevision =
  | { kind: "overwrite"; goal: GoalSpec }
  | { kind: "split"; ended: GoalSpec; next: GoalSpec };

const sameTarget = (a: GoalSpec, b: GoalSpec) =>
  a.nutrientKey === b.nutrientKey && a.unit === b.unit && a.kind === b.kind && a.min === b.min && a.max === b.max && a.period === b.period;

/**
 * How to save an edit to a goal so the days it already applied keep the amounts they had.
 * When the amounts change on a goal that was already in effect, the old goal ends the day before
 * the change and a new goal starts on it. The change starts today, or on the new start date when
 * the person moved it later than the old one ("since Monday it's 2,000", or "from next Monday").
 * Date-only edits, edits to goals that started today or later or have already ended, and edits
 * that move the start earlier overwrite, since the person is then correcting the goal itself.
 */
export function reviseGoal(old: GoalSpec, next: GoalSpec, today: string): GoalRevision {
  if (sameTarget(old, next)) return { kind: "overwrite", goal: next };
  const from = next.startDate === old.startDate ? today : next.startDate;
  const applied = old.startDate < today && old.startDate < from; // the old goal has days of its own to keep
  const stillOn = old.endDate === null || old.endDate >= from;
  const nextFits = next.endDate === null || next.endDate >= from;
  if (!applied || !stillOn || !nextFits) return { kind: "overwrite", goal: next };
  return { kind: "split", ended: { ...old, endDate: shiftDate(from, -1) }, next: { ...next, startDate: from } };
}

// ---------------------------------------------------------------- rolling seven days

export const WEEK_DAYS = 7;

export interface WeekLine {
  nutrientKey: string;
  unit: string;
  /** The kind of the goal on the latest counted day (they can differ if the goal changed). */
  kind: GoalKind;
  /** Sum of each counted day's lower bound; null when no counted day had one. */
  min: number | null;
  /** Sum of each counted day's upper bound; null when no counted day had one. */
  max: number | null;
  /** Eaten on the counted days; null when meals were logged but none reports the nutrient. */
  eaten: number | null;
  /** Some logged meals don't report it, so `eaten` is a lower bound. */
  partial: boolean;
  /** Days that count: a daily goal for the nutrient applied and a meal was logged, plus today. */
  days: number;
  status: GoalStatus;
  /**
   * What today can still do for the week (today is the one day of the window still open):
   * `toGo` is what's left to reach the lower bound, `roomLeft` what's left under the upper bound,
   * `over` how far past the upper bound the week is. Each is null when it doesn't apply.
   */
  toGo: number | null;
  roomLeft: number | null;
  over: number | null;
}

export interface RollingWeek {
  from: string;
  to: string;
  /** Days of the window with at least one logged meal. */
  daysLogged: number;
  lines: WeekLine[];
}

/** The daily goal for one nutrient on a day: the one that started latest when two overlap. */
function goalOn(goals: GoalSpec[], date: string): GoalSpec | null {
  let found: GoalSpec | null = null;
  for (const g of goals) {
    if (g.startDate <= date && (g.endDate === null || g.endDate >= date) && (!found || g.startDate >= found.startDate)) found = g;
  }
  return found;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * The last seven days (today and the six before) against the person's daily goals, as each goal
 * stood on each day. Days with nothing logged are left out of both sides (not logged is not
 * "ate nothing"); today always counts because it is still open. Weekly and monthly goals keep
 * their own calendar windows on the Goals screen and are not part of this.
 * `waterIntake`, if given, is drinks plus water in food, for water goals.
 */
export function rollingWeek(goals: GoalSpec[], intake: DayIntake[], today: string, waterIntake?: { key: string; intake: DayIntake[] }): RollingWeek {
  const from = shiftDate(today, -(WEEK_DAYS - 1));
  const inWindow = (d: DayIntake) => d.date >= from && d.date <= today;
  const days = intake.filter(inWindow);
  const daily = goals.filter((g) => g.period === "day" && g.startDate <= today && (g.endDate === null || g.endDate >= from));
  const groups = new Map<string, GoalSpec[]>();
  for (const g of daily) {
    const key = `${g.nutrientKey}|${g.unit}`;
    groups.set(key, [...(groups.get(key) ?? []), g]);
  }

  const lines: WeekLine[] = [];
  for (const group of groups.values()) {
    const { nutrientKey, unit } = group[0]!;
    const source = waterIntake && waterIntake.key === nutrientKey ? waterIntake.intake.filter(inWindow) : days;
    const byDate = new Map(source.map((d) => [d.date, d]));
    let min: number | null = null;
    let max: number | null = null;
    let eaten: number | null = null;
    let partial = false;
    let reported = false;
    let counted = 0;
    let kind: GoalKind = group[0]!.kind;
    for (let i = 0; i < dayCount(from, today); i++) {
      const date = shiftDate(from, i);
      const day = byDate.get(date);
      if (!day && date !== today) continue;
      const goal = goalOn(group, date);
      if (!goal) continue;
      counted += 1;
      kind = goal.kind;
      if (goal.min !== null && goal.kind !== "at_most") min = (min ?? 0) + goal.min;
      if (goal.max !== null && goal.kind !== "at_least") max = (max ?? 0) + goal.max;
      if (!day) {
        eaten = eaten ?? 0; // today, nothing logged yet: nothing eaten so far
        reported = true;
        continue;
      }
      const t = day.totals.find((x) => x.key === nutrientKey && x.unit === unit);
      if (!t || t.amount === null) {
        partial = true; // a logged day that doesn't report it
        continue;
      }
      reported = true;
      eaten = (eaten ?? 0) + t.amount;
      if (t.status !== "known") partial = true;
    }
    if (!counted) continue;
    if (!reported) eaten = null;
    const status: GoalStatus =
      eaten === null ? "no_data" : min !== null && eaten < min ? "below" : max !== null && eaten > max ? "above" : "met";
    lines.push({
      nutrientKey,
      unit,
      kind,
      min: min === null ? null : round1(min),
      max: max === null ? null : round1(max),
      eaten: eaten === null ? null : round1(eaten),
      partial,
      days: counted,
      status,
      toGo: eaten !== null && min !== null && eaten < min ? round1(min - eaten) : null,
      roomLeft: eaten !== null && max !== null && eaten <= max && (min === null || eaten >= min) ? round1(max - eaten) : null,
      over: eaten !== null && max !== null && eaten > max ? round1(eaten - max) : null,
    });
  }
  return { from, to: today, daysLogged: days.length, lines };
}
