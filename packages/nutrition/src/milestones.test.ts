import { describe, expect, it } from "vitest";
import { addDays, foodBaseName, isoWeek, isPlantFood, weekStart } from "./milestones.ts";

describe("foodBaseName", () => {
  it("drops the preparation so forms of one food match", () => {
    expect(foodBaseName("Kale, raw")).toBe("Kale");
    expect(foodBaseName("Kale, cooked, boiled, drained, without salt")).toBe("Kale");
    expect(foodBaseName("Tempeh")).toBe("Tempeh");
  });

  it("keeps a second part that says which food it is, at most two parts", () => {
    expect(foodBaseName("Beans, kidney, red, mature seeds, canned")).toBe("Beans, kidney");
    expect(foodBaseName("Beans, kidney, mature seeds, sprouted, cooked")).toBe("Beans, kidney");
    expect(foodBaseName("Nuts, beechnuts, dried")).toBe("Nuts, beechnuts");
    expect(foodBaseName("Peas, green, canned, no salt added")).toBe("Peas, green");
  });

  it("ignores commas inside parentheses", () => {
    expect(foodBaseName("Chickpeas (garbanzo beans, bengal gram), mature seeds, raw")).toBe("Chickpeas");
  });
});

describe("isPlantFood", () => {
  it("counts vegetables, fruits, legumes, nuts and seeds but not juices or other groups", () => {
    expect(isPlantFood({ description: "Kale, raw", category: "Vegetables and Vegetable Products" })).toBe(true);
    expect(isPlantFood({ description: "Lentils, raw", category: "Legumes and Legume Products" })).toBe(true);
    expect(isPlantFood({ description: "Grape juice, canned", category: "Fruits and Fruit Juices" })).toBe(false);
    expect(isPlantFood({ description: "Chicken, breast", category: "Poultry Products" })).toBe(false);
    expect(isPlantFood({ description: "Mystery", category: null })).toBe(false);
  });
});

describe("weeks", () => {
  it("names ISO weeks, including around the new year", () => {
    expect(isoWeek("2026-11-12")).toBe("2026-W46");
    expect(isoWeek("2026-11-09")).toBe("2026-W46");
    expect(isoWeek("2026-11-08")).toBe("2026-W45");
    expect(isoWeek("2027-01-01")).toBe("2026-W53");
    expect(isoWeek("2025-12-29")).toBe("2026-W01");
  });

  it("finds the Monday and adds days across months", () => {
    expect(weekStart("2026-11-12")).toBe("2026-11-09");
    expect(weekStart("2026-11-15")).toBe("2026-11-09");
    expect(weekStart("2026-11-09")).toBe("2026-11-09");
    expect(addDays("2026-11-30", 1)).toBe("2026-12-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });
});
