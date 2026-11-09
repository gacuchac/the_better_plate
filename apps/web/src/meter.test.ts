import { describe, expect, it } from "vitest";
import { meterShape } from "./meter.ts";

describe("meterShape", () => {
  it("never shows an unknown amount as zero", () => {
    expect(meterShape(null, 100)).toEqual({ unknown: true, fillPct: 0, overPct: 0, markPct: null });
  });
  it("has no mark and no overflow without a personal goal", () => {
    for (const goal of [null, 0, -5]) {
      const s = meterShape(500, goal);
      expect(s.markPct).toBeNull();
      expect(s.overPct).toBe(0);
    }
  });
  it("fills toward the mark below the goal", () => {
    const s = meterShape(50, 100);
    expect(s.markPct).toBe(80);
    expect(s.fillPct).toBeLessThan(80);
    expect(s.overPct).toBe(0);
  });
  it("continues past the mark when over the goal, within the track", () => {
    const s = meterShape(150, 100);
    expect(s.fillPct).toBe(s.markPct);
    expect(s.overPct).toBeGreaterThan(0);
    expect(s.fillPct + s.overPct).toBeLessThanOrEqual(100);
  });
  it("shows zero as a real amount of zero", () => {
    expect(meterShape(0, 100)).toMatchObject({ unknown: false, fillPct: 0, overPct: 0 });
  });
});
