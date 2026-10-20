import { beforeAll, describe, expect, it } from "vitest";
import type { GoalBody } from "@betterplate/contracts";
import { percentDailyValue } from "@betterplate/nutrition";
import type { LocalGoal } from "./localdb.ts";

const store = new Map<string, string>();
beforeAll(() => {
  globalThis.localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  } as Storage;
});

describe("daily targets from before goals were synced", () => {
  it("move into daily goals once, keep only valid amounts, and leave the device", async () => {
    const { migrateTargets, getLegacyTargets } = await import("./targets.ts");
    store.set(
      "bp.targets.a",
      JSON.stringify([
        { key: "protein", unit: "g", amount: 155 },
        { key: "sodium", unit: "mg", amount: 2000 },
        { key: "fiber", unit: "g", amount: 0 },
      ]),
    );
    const saved: GoalBody[] = [];
    const engine = { saveGoal: async (_id: string, body: GoalBody) => void saved.push(body) };
    expect(await migrateTargets("a", engine, "2026-10-20")).toBe(2);
    expect(saved).toEqual([
      { nutrientKey: "protein", unit: "g", kind: "at_least", min: 155, max: null, period: "day", startDate: "2026-10-20", endDate: null },
      { nutrientKey: "sodium", unit: "mg", kind: "at_most", min: null, max: 2000, period: "day", startDate: "2026-10-20", endDate: null },
    ]);
    expect(store.has("bp.targets.a")).toBe(false);
    expect(getLegacyTargets("a")).toEqual([]);
    expect(await migrateTargets("a", engine, "2026-10-20")).toBe(0);
    expect(saved).toHaveLength(2);
  });
});

describe("percentages compare with daily goals in effect", () => {
  const goal = (body: Partial<GoalBody>): LocalGoal => ({
    id: crypto.randomUUID(),
    serverVersion: null,
    state: "synced",
    updatedAt: "",
    body: { nutrientKey: "protein", unit: "g", kind: "at_least", min: 155, max: null, period: "day", startDate: "2026-10-01", endDate: null, ...body },
  });

  it("uses only daily goals active today, and nothing shows without one", async () => {
    const { dailyTargets } = await import("./goals.ts");
    const targets = dailyTargets(
      [
        goal({}),
        goal({ nutrientKey: "fiber", min: 30, period: "week" }),
        goal({ nutrientKey: "sodium", unit: "mg", kind: "at_most", min: null, max: 2000, endDate: "2026-10-10" }),
        goal({ nutrientKey: "iron", unit: "mg", min: 18, startDate: "2026-11-01" }),
      ],
      "2026-10-20",
    );
    expect(targets).toEqual([{ key: "protein", unit: "g", amount: 155 }]);
    expect(percentDailyValue({ key: "protein", amount: 40, unit: "g" }, targets)).toBeCloseTo(25.8, 1);
    expect(percentDailyValue({ key: "fiber", amount: 5, unit: "g" }, targets)).toBeNull();
    expect(percentDailyValue({ key: "protein", amount: 40, unit: "g" }, [])).toBeNull();
  });
});
