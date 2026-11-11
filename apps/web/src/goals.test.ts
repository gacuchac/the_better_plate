import { describe, expect, it } from "vitest";
import type { GoalBody } from "@betterplate/contracts";
import type { LocalGoal } from "./localdb.ts";

// Labeled test fixtures: made-up amounts, not nutrient facts.
const body = (over: Partial<GoalBody> = {}): GoalBody => ({
  nutrientKey: "energy_kcal", unit: "kcal", kind: "at_most", min: null, max: 2000, period: "day", startDate: "2026-11-01", endDate: null, ...over,
});
const local = (b: GoalBody): LocalGoal => ({ id: "old", body: b, serverVersion: 1, state: "synced", updatedAt: "" }) as LocalGoal;

async function saved(goal: LocalGoal | null, next: GoalBody) {
  const { saveGoalKeepingHistory } = await import("./goals.ts");
  const writes: [string, GoalBody][] = [];
  await saveGoalKeepingHistory({ saveGoal: async (id, b) => void writes.push([id, b]) }, goal, next, "2026-11-11", () => "new");
  return writes;
}

describe("saving a goal keeps the days it already applied", () => {
  it("ends the old goal yesterday and starts a new one today when the amount changes", async () => {
    expect(await saved(local(body()), body({ max: 1800 }))).toEqual([
      ["old", body({ endDate: "2026-11-10" })],
      ["new", body({ max: 1800, startDate: "2026-11-11" })],
    ]);
  });

  it("edits in place when only dates change, and adds new goals as new", async () => {
    expect(await saved(local(body()), body({ endDate: "2026-12-01" }))).toEqual([["old", body({ endDate: "2026-12-01" })]]);
    expect(await saved(null, body())).toEqual([["new", body()]]);
  });
});
