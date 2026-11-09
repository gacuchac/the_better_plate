/**
 * Geometry for a nutrient bar. A mark appears only when the person set a goal for the nutrient;
 * past the mark the bar keeps its green and continues in a deeper shade (no warning colours).
 * An unknown amount (null) has no fill, never zero.
 */
export interface MeterShape {
  unknown: boolean;
  /** Percent of the track filled up to the mark (or all of it when there is no mark). */
  fillPct: number;
  /** Percent of the track filled past the mark; 0 unless the amount is beyond the goal. */
  overPct: number;
  /** Where the goal mark sits, percent of the track; null when there is no personal goal. */
  markPct: number | null;
}

const pct = (n: number) => Math.round(n * 10) / 10;

export function meterShape(amount: number | null, goal: number | null): MeterShape {
  if (amount === null || !Number.isFinite(amount)) return { unknown: true, fillPct: 0, overPct: 0, markPct: null };
  const a = Math.max(0, amount);
  if (goal === null || !(goal > 0)) {
    // Amount only: the bar is just the amount against the largest value shown, no mark.
    return { unknown: false, fillPct: a > 0 ? 100 : 0, overPct: 0, markPct: null };
  }
  // Scale: the goal sits at 80% of the track, so room remains to show going past it.
  const scale = Math.max(goal * 1.25, a * 1.05);
  const mark = (goal / scale) * 100;
  const end = (a / scale) * 100;
  return { unknown: false, fillPct: pct(Math.min(end, mark)), overPct: pct(Math.max(0, end - mark)), markPct: pct(mark) };
}
