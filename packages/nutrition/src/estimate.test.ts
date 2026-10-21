import { describe, expect, it } from "vitest";
import { estimateEnergyKcal, estimateGoals, estimateMicronutrients, estimateProblem, type EstimateInput } from "./estimate.ts";

// Hand-worked arithmetic with the published coefficients (Table S-3), not nutrient facts.
const man: EstimateInput = { sex: "male", age: 30, heightCm: 175, weightKg: 70, activity: "inactive" };
const woman: EstimateInput = { sex: "female", age: 40, heightCm: 165, weightKg: 60, activity: "low_active" };

const find = (e: ReturnType<typeof estimateGoals>, key: string) => e.suggestions.find((s) => s.nutrientKey === key)!;

describe("energy estimate", () => {
  it("applies the 2023 adult equations", () => {
    // 753.07 − 10.83×30 + 6.50×175 + 14.10×70
    expect(estimateEnergyKcal(man)).toBeCloseTo(2552.67, 2);
    // 575.77 − 7.01×40 + 6.60×165 + 12.14×60
    expect(estimateEnergyKcal(woman)).toBeCloseTo(2112.77, 2);
    // 511.83 − 7.01×60 + 9.07×160 + 12.56×50
    expect(estimateEnergyKcal({ sex: "female", age: 60, heightCm: 160, weightKg: 50, activity: "very_active" })).toBeCloseTo(2170.43, 2);
    // −517.88 − 10.83×25 + 15.61×180 + 19.11×80
    expect(estimateEnergyKcal({ sex: "male", age: 25, heightCm: 180, weightKg: 80, activity: "very_active" })).toBeCloseTo(3549.97, 2);
  });

  it("rises with each activity level for the same person", () => {
    const levels = ["inactive", "low_active", "active", "very_active"] as const;
    const kcal = levels.map((activity) => estimateEnergyKcal({ ...man, activity }));
    expect(kcal).toEqual([...kcal].sort((a, b) => a - b));
  });
});

describe("suggested goals", () => {
  it("turns energy and the published ranges into daily goals for a man", () => {
    const e = estimateGoals(man);
    expect(e).toMatchObject({ energyKcal: 2550, energyRmse: 339 });
    expect(find(e, "energy_kcal")).toMatchObject({ kind: "between", unit: "kcal", min: 2210, max: 2890 });
    // 10% of energy is 63.75 g, so the lower end follows the 56 g RDA only when it is higher.
    expect(find(e, "protein")).toMatchObject({ kind: "between", min: 65, max: 225 });
    expect(find(e, "fat_total")).toMatchObject({ min: 55, max: 100 });
    expect(find(e, "carbohydrate")).toMatchObject({ min: 285, max: 415 });
    expect(find(e, "fiber")).toMatchObject({ kind: "at_least", min: 38, max: null });
    expect(find(e, "water")).toMatchObject({ kind: "at_least", unit: "g", min: 3700 });
  });

  it("uses the women's values, the older-adult fibre value and keeps the RDA floors", () => {
    const e = estimateGoals(woman);
    expect(e).toMatchObject({ energyKcal: 2110, energyRmse: 246 });
    expect(find(e, "protein")).toMatchObject({ min: 55, max: 185 });
    expect(find(e, "fiber")).toMatchObject({ min: 25 });
    expect(find(e, "water")).toMatchObject({ min: 2700 });
    expect(estimateGoals({ ...woman, age: 51 }).suggestions.find((s) => s.nutrientKey === "fiber")).toMatchObject({ min: 21 });
    expect(estimateGoals({ ...man, age: 70 }).suggestions.find((s) => s.nutrientKey === "fiber")).toMatchObject({ min: 30 });
    // At a low energy estimate, 10% of energy is below the protein RDA and 45% below the 130 g carbohydrate RDA.
    const small = estimateGoals({ sex: "female", age: 90, heightCm: 130, weightKg: 35, activity: "inactive" });
    expect(small.energyKcal).toBeLessThan(1300);
    expect(find(small, "protein").min).toBe(46);
    expect(find(small, "carbohydrate").min).toBe(130);
  });

  it("every suggestion is a valid goal shape: bounds in order, only the bounds its kind needs", () => {
    for (const input of [man, woman, { ...man, activity: "very_active" as const }]) {
      for (const s of estimateGoals(input).suggestions) {
        expect(s.min).toBeGreaterThan(0);
        if (s.kind === "between") expect(s.min!).toBeLessThanOrEqual(s.max!);
        else expect(s.max).toBeNull();
      }
    }
  });
});

describe("inputs outside what the equations cover", () => {
  it("names the first problem and refuses to estimate", () => {
    expect(estimateProblem({ age: 18, heightCm: 170, weightKg: 60 })).toBe("age");
    expect(estimateProblem({ age: 30.5, heightCm: 170, weightKg: 60 })).toBe("age");
    expect(estimateProblem({ age: 30, heightCm: 80, weightKg: 60 })).toBe("height");
    expect(estimateProblem({ age: 30, heightCm: 170, weightKg: 500 })).toBe("weight");
    expect(estimateProblem({ age: 30, heightCm: 170 })).toBe("weight");
    expect(estimateProblem({ age: 30, heightCm: 170, weightKg: 60 })).toBeNull();
    expect(() => estimateGoals({ ...man, age: 17 })).toThrow(RangeError);
  });
});

describe("vitamin and mineral reference amounts", () => {
  const micro = (sex: "male" | "female", age: number) =>
    estimateMicronutrients({ sex, age });
  const get = (list: ReturnType<typeof micro>, key: string) =>
    list.find((s) => s.nutrientKey === key)!;

  it("returns the published adult values for a 30-year-old man and woman", () => {
    const m = micro("male", 30);
    expect(m).toHaveLength(11);
    expect(get(m, "calcium")).toMatchObject({
      kind: "at_least",
      min: 1000,
      unit: "mg",
      basis: "rda",
    });
    expect(get(m, "iron").min).toBe(8);
    expect(get(m, "magnesium").min).toBe(400);
    expect(get(m, "zinc").min).toBe(11);
    expect(get(m, "potassium")).toMatchObject({ min: 3400, basis: "ai" });
    expect(get(m, "vitamin_c").min).toBe(90);
    expect(get(m, "vitamin_a_rae").min).toBe(900);
    const f = micro("female", 30);
    expect(get(f, "iron").min).toBe(18);
    expect(get(f, "magnesium").min).toBe(310);
    expect(get(f, "zinc").min).toBe(8);
    expect(get(f, "potassium").min).toBe(2600);
    expect(get(f, "vitamin_c").min).toBe(75);
    expect(get(f, "vitamin_a_rae").min).toBe(700);
    expect(get(f, "vitamin_d").min).toBe(15);
    expect(get(f, "vitamin_b12").min).toBe(2.4);
    expect(get(f, "folate_dfe").min).toBe(400);
  });

  it("treats sodium as a limit, not a target", () => {
    expect(get(micro("male", 40), "sodium")).toMatchObject({
      kind: "at_most",
      min: null,
      max: 2300,
      basis: "cdrr",
    });
  });

  it("switches at the published age boundaries", () => {
    expect(get(micro("female", 50), "iron").min).toBe(18);
    expect(get(micro("female", 51), "iron").min).toBe(8);
    expect(get(micro("female", 50), "calcium").min).toBe(1000);
    expect(get(micro("female", 51), "calcium").min).toBe(1200);
    expect(get(micro("male", 70), "calcium").min).toBe(1000);
    expect(get(micro("male", 71), "calcium").min).toBe(1200);
    expect(get(micro("male", 30), "magnesium").min).toBe(400);
    expect(get(micro("male", 31), "magnesium").min).toBe(420);
    expect(get(micro("female", 30), "magnesium").min).toBe(310);
    expect(get(micro("female", 31), "magnesium").min).toBe(320);
    expect(get(micro("male", 70), "vitamin_d").min).toBe(15);
    expect(get(micro("male", 71), "vitamin_d").min).toBe(20);
  });

  it("refuses ages outside adulthood", () => {
    expect(() => micro("male", 18)).toThrow(RangeError);
  });
});
