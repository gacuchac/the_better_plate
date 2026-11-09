import { describe, expect, it } from "vitest";
import { weekOf } from "./meals.ts";

describe("weekOf", () => {
  it("returns Monday to Sunday around any day of the week", () => {
    const week = ["2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13", "2026-11-14", "2026-11-15"];
    for (const d of week) expect(weekOf(d)).toEqual(week);
  });
  it("crosses a month boundary", () => {
    expect(weekOf("2026-12-02")[0]).toBe("2026-11-30");
    expect(weekOf("2026-12-02")[6]).toBe("2026-12-06");
  });
});
