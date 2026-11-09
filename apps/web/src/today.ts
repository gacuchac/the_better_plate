import type { LocalGoal, LocalLog, LocalPlan } from "./localdb.ts";
import { SLOTS } from "./meals.ts";

export type TrailItem = { kind: "planned"; plan: LocalPlan } | { kind: "eaten"; log: LocalLog };

export interface Trail {
  /** Today's meals in the order of the day: planned ones still to eat, and eaten ones. */
  items: TrailItem[];
  /** Plans a group admin has not approved yet: kept out of the trail, mentioned quietly. */
  waiting: number;
}

const slotIndex = (slot: string) => SLOTS.findIndex((s) => s.value === slot);

/** Today's trail: plans without a log that fulfils them, plus what was eaten. Unapproved plans never appear. */
export function todayTrail(date: string, plans: LocalPlan[], logs: LocalLog[]): Trail {
  const dayPlans = plans.filter((p) => !p.deleted && p.body.date === date);
  const fulfilled = new Set(logs.map((l) => l.body.plannedMealId).filter(Boolean));
  const waiting = dayPlans.filter((p) => p.meta?.status === "proposed").length;
  const open = dayPlans.filter((p) => (p.meta?.status ?? "planned") === "planned" && !fulfilled.has(p.id));
  const eaten = logs.filter((l) => !l.deleted && l.body.localDate === date);
  const items: TrailItem[] = [
    ...open.map((plan): TrailItem => ({ kind: "planned", plan })),
    ...eaten.map((log): TrailItem => ({ kind: "eaten", log })),
  ];
  const slotOf = (i: TrailItem) => slotIndex(i.kind === "planned" ? i.plan.body.slot : i.log.body.slot);
  const timeOf = (i: TrailItem) => (i.kind === "eaten" ? i.log.body.eatenAt : "");
  items.sort((a, b) => slotOf(a) - slotOf(b) || timeOf(a).localeCompare(timeOf(b)));
  return { items, waiting };
}

/** The number a day's calories are compared with: only a goal the person set, never a default. */
export function energyMark(goals: LocalGoal[], today: string): { mark: number; ceiling: number | null } | null {
  const g = goals.find(
    (x) => !x.deleted && x.body.nutrientKey === "energy_kcal" && x.body.period === "day" && x.body.startDate <= today && (x.body.endDate === null || x.body.endDate >= today),
  );
  if (!g) return null;
  const mark = g.body.max ?? g.body.min;
  if (mark === null) return null;
  // Only goals with a top (at most, between) can be gone past; "at least" has no over.
  return { mark, ceiling: g.body.kind === "at_least" ? null : g.body.max };
}

/** How far above the goal, in the unit shown; null when there is no goal, no top, or nothing above it. */
export function amountOver(eaten: number | null, ceiling: number | null): number | null {
  if (eaten === null || ceiling === null || eaten <= ceiling) return null;
  return Math.round(eaten - ceiling);
}
