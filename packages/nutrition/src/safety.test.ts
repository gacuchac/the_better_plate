import { describe, expect, it } from "vitest";
import { fahrenheitToCelsius, safetyRuleFor, splitSteps, stepTimerSeconds } from "./safety.ts";

// Descriptions shaped like USDA SR Legacy names; categories are SR Legacy food groups.
describe("safe temperature rules", () => {
  const rule = (category: string, description: string) => safetyRuleFor({ category, description })?.id ?? null;
  it("maps meat, poultry, fish and eggs to the chart groups", () => {
    expect(rule("Poultry Products", "Chicken, broilers or fryers, breast, meat only, raw")).toBe("poultry");
    expect(rule("Beef Products", "Beef, top sirloin, steak, separable lean only, raw")).toBe("whole_cuts");
    expect(rule("Beef Products", "Beef, ground, 85% lean meat / 15% fat, raw")).toBe("ground_meat");
    expect(rule("Pork Products", "Pork, fresh, loin, center rib (chops), raw")).toBe("whole_cuts");
    expect(rule("Lamb, Veal, and Game Products", "Game meat, deer, loin, raw")).toBe("game");
    expect(rule("Finfish and Shellfish Products", "Fish, salmon, Atlantic, farmed, raw")).toBe("fish");
    expect(rule("Finfish and Shellfish Products", "Crustaceans, shrimp, raw")).toBe("crustaceans");
    expect(rule("Finfish and Shellfish Products", "Mollusks, mussel, blue, raw")).toBe("bivalves");
    expect(rule("Dairy and Egg Products", "Egg, whole, raw, fresh")).toBe("eggs");
  });
  it("gives no temperature for foods the chart does not cover", () => {
    expect(rule("Vegetables and Vegetable Products", "Broccoli, raw")).toBeNull();
    expect(rule("Finfish and Shellfish Products", "Mollusks, squid, mixed species, raw")).toBeNull();
    expect(rule("Dairy and Egg Products", "Cheese, cheddar")).toBeNull();
  });
  it("converts the published °F", () => {
    expect([145, 160, 165].map(fahrenheitToCelsius)).toEqual([63, 71, 74]);
  });
});

describe("steps from the person's own method", () => {
  it("splits numbered lines and joins wrapped text", () => {
    expect(splitSteps("1. Rinse rice\n2. Simmer 15 minutes\n   covered\n3. Rest")).toEqual(["Rinse rice", "Simmer 15 minutes covered", "Rest"]);
  });
  it("splits plain lines", () => {
    expect(splitSteps("Heat oil.\n\nAdd garlic.\nServe.")).toEqual(["Heat oil.", "Add garlic.", "Serve."]);
  });
  it("finds the duration the person wrote", () => {
    expect(stepTimerSeconds("Simmer 15 minutes")).toBe(900);
    expect(stepTimerSeconds("Steam 4-5 min")).toBe(240);
    expect(stepTimerSeconds("Roast for 1.5 hours")).toBe(5400);
    expect(stepTimerSeconds("Season to taste")).toBeNull();
  });
});
