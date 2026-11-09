import { describe, expect, it } from "vitest";
import type { LocalGoal, LocalLog, LocalPlan } from "./localdb.ts";
import { amountOver, energyMark, todayTrail } from "./today.ts";

const plan = (id: string, slot: string, extra: Partial<LocalPlan> = {}): LocalPlan =>
  ({ id, body: { date: "2026-11-09", slot, recipeId: "r", title: id, servings: 1 }, serverVersion: 1, state: "synced", updatedAt: "", ...extra }) as LocalPlan;
const log = (id: string, slot: string, plannedMealId: string | null, eatenAt: string): LocalLog =>
  ({ id, body: { localDate: "2026-11-09", slot, plannedMealId, eatenAt, servings: 1 }, state: "synced", createdAt: "" }) as LocalLog;
const goal = (body: object): LocalGoal =>
  ({ id: "g", body: { nutrientKey: "energy_kcal", unit: "kcal", kind: "at_most", min: null, max: 2000, period: "day", startDate: "2026-11-01", endDate: null, ...body }, serverVersion: 1, state: "synced", updatedAt: "" }) as LocalGoal;

describe("todayTrail", () => {
  it("orders by slot, with a fulfilled plan shown once, as eaten", () => {
    const t = todayTrail("2026-11-09", [plan("a", "dinner"), plan("b", "breakfast")], [log("l", "breakfast", "b", "2026-11-09T08:00:00+00:00")]);
    expect(t.items.map((i) => (i.kind === "planned" ? `p:${i.plan.id}` : `e:${i.log.id}`))).toEqual(["e:l", "p:a"]);
  });
  it("keeps plans waiting for approval out of the trail and counts them", () => {
    const t = todayTrail("2026-11-09", [plan("a", "lunch", { meta: { status: "proposed", groupId: null, plannedBy: null } }), plan("d", "lunch", { meta: { status: "declined", groupId: null, plannedBy: null } })], []);
    expect(t.items).toEqual([]);
    expect(t.waiting).toBe(1);
  });
  it("is empty on a day with nothing", () => {
    expect(todayTrail("2026-11-09", [], []).items).toEqual([]);
  });
});

describe("goal mark for calories", () => {
  it("has no mark without a personal goal", () => {
    expect(energyMark([], "2026-11-09")).toBeNull();
  });
  it("uses the top of an at-most goal and can be gone past", () => {
    const m = energyMark([goal({})], "2026-11-09")!;
    expect(m).toEqual({ mark: 2000, ceiling: 2000 });
    expect(amountOver(2110, m.ceiling)).toBe(110);
    expect(amountOver(1900, m.ceiling)).toBeNull();
  });
  it("never says over for an at-least goal", () => {
    const m = energyMark([goal({ kind: "at_least", min: 1800, max: null })], "2026-11-09")!;
    expect(m.ceiling).toBeNull();
    expect(amountOver(5000, m.ceiling)).toBeNull();
  });
  it("is silent when nothing is known", () => {
    expect(amountOver(null, 2000)).toBeNull();
  });
});
