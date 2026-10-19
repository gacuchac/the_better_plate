import { beforeAll, describe, expect, it } from "vitest";
import { percentDailyValue } from "@betterplate/nutrition";

const store = new Map<string, string>();
beforeAll(() => {
  globalThis.localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  } as Storage;
});

describe("personal daily targets", () => {
  it("keeps only what the person typed, per account, and drops invalid amounts", async () => {
    const { getTargets, saveTargets } = await import("./targets.ts");
    expect(getTargets("a")).toEqual([]);
    saveTargets("a", [
      { key: "protein", unit: "g", amount: 155 },
      { key: "fiber", unit: "g", amount: 0 },
      { key: "sodium", unit: "mg", amount: Number.NaN },
    ]);
    expect(getTargets("a")).toEqual([{ key: "protein", unit: "g", amount: 155 }]);
    expect(getTargets("b")).toEqual([]);
    expect(getTargets(undefined)).toEqual([]);
    expect(JSON.parse(store.get("bp.targets.a")!)).toEqual([{ key: "protein", unit: "g", amount: 155 }]);
  });

  it("percentages use the person's target, and nothing shows without one", async () => {
    const { getTargets } = await import("./targets.ts");
    const targets = getTargets("a");
    expect(percentDailyValue({ key: "protein", amount: 40, unit: "g" }, targets)).toBeCloseTo(25.8, 1);
    expect(percentDailyValue({ key: "fiber", amount: 5, unit: "g" }, targets)).toBeNull();
    expect(percentDailyValue({ key: "protein", amount: 40, unit: "g" }, [])).toBeNull();
  });

  it("clearing removes them from the device", async () => {
    const { clearTargets, getTargets } = await import("./targets.ts");
    clearTargets("a");
    expect(getTargets("a")).toEqual([]);
    expect(store.has("bp.targets.a")).toBe(false);
  });
});
