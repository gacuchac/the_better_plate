import { meterShape } from "../meter.ts";

/** Decorative bar; put the amount and goal in text next to it. */
export function Meter({ amount, goal }: { amount: number | null; goal: number | null }) {
  const s = meterShape(amount, goal);
  if (s.unknown) return <span className="meter unknown" aria-hidden="true" />;
  return (
    <span className="meter" aria-hidden="true">
      <span className="meter-fill" style={{ width: `${s.fillPct}%` }} />
      {s.overPct > 0 && s.markPct !== null && <span className="meter-over" style={{ left: `${s.markPct}%`, width: `${s.overPct}%` }} />}
      {s.markPct !== null && <span className="meter-mark" style={{ left: `${s.markPct}%` }} />}
    </span>
  );
}
