import { describe, expect, it } from "vitest";
import { amountFromText } from "./amounts.ts";

const egg = { portions: [{ label: "1.0 large", gramWeight: 50 }, { label: "1.0 cup (4.86 large eggs)", gramWeight: 243 }, { label: "1.0 medium", gramWeight: 44 }] };
const garlic = { portions: [{ label: "1.0 cup", gramWeight: 136 }, { label: "1.0 tsp", gramWeight: 2.8 }, { label: "3.0 cloves", gramWeight: 9 }, { label: "1.0 clove", gramWeight: 3 }] };
const milk = { portions: [{ label: "1.0 cup", gramWeight: 244 }, { label: "1.0 tbsp", gramWeight: 15 }] };
const salt = { portions: [{ label: "1.0 tsp", gramWeight: 6 }] };

describe("amounts from recipe text", () => {
  it("keeps mass units as they are", () => {
    expect(amountFromText(250, "g", undefined)).toEqual({ quantity: 250, unit: "g", portionIndex: null });
    expect(amountFromText(1.5, "Pounds", undefined)).toEqual({ quantity: 1.5, unit: "lb", portionIndex: null });
    expect(amountFromText(2, "gramos", undefined)).toEqual({ quantity: 2, unit: "g", portionIndex: null });
  });

  it("weighs volumes only through the food's own household portion", () => {
    expect(amountFromText(2, "cups", milk)).toEqual({ quantity: 2, unit: "portion", portionIndex: 0 });
    expect(amountFromText(3, "tablespoons", milk)).toEqual({ quantity: 3, unit: "portion", portionIndex: 1 });
    expect(amountFromText(250, "ml", milk)).toEqual({ quantity: 1.06, unit: "portion", portionIndex: 0 });
    // No cup portion for salt: a teaspoon count instead of a guessed density.
    expect(amountFromText(0.5, "cup", salt)).toEqual({ quantity: 24, unit: "portion", portionIndex: 0 });
    expect(amountFromText(1, "cup", { portions: [] })).toBeNull();
  });

  it("counts pieces by the matching portion, one at a time", () => {
    expect(amountFromText(3, "cloves", garlic)).toEqual({ quantity: 3, unit: "portion", portionIndex: 3 });
    expect(amountFromText(2, "", egg)).toEqual({ quantity: 2, unit: "portion", portionIndex: 2 });
    expect(amountFromText(2, "large", egg)).toEqual({ quantity: 2, unit: "portion", portionIndex: 0 });
    expect(amountFromText(2, "whole", egg)).toEqual({ quantity: 2, unit: "portion", portionIndex: 2 });
    expect(amountFromText(1, "can", egg)).toBeNull();
  });

  it("leaves vague or missing amounts for the person", () => {
    expect(amountFromText(null, "to taste", salt)).toBeNull();
    expect(amountFromText(1, "pinch", salt)).toBeNull();
    expect(amountFromText(0, "g", salt)).toBeNull();
  });
});
