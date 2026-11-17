import { describe, expect, it } from "vitest";
import { cookSteps, findTechniques, SAFETY_RULE_IDS_WITH_WORDS, stepSafetyRules, stepsFingerprint, TECHNIQUES } from "./cooking.ts";
import { SAFETY_RULES } from "./safety.ts";

const ids = (step: string) => findTechniques(step).map((t) => t.id);

describe("Cook it steps from the person's own method", () => {
  it("keeps a description above a numbered list out of the checklist", () => {
    const { intro, steps } = cookSteps("Description: A pan-seared ribeye.\n\n1. Boil the potatoes.\n2. Sear the steak 3-4 minutes per side.\n   Rest, then slice.");
    expect(intro).toEqual(["A pan-seared ribeye."]);
    expect(steps.map((s) => s.text)).toEqual(["Boil the potatoes.", "Sear the steak 3-4 minutes per side. Rest, then slice."]);
  });

  it("splits a method written as one paragraph into its sentences", () => {
    const { steps } = cookSteps("Preheat oven to 350°F. Grease 12 muffin cups. Whisk 3 eggs (or use 4 small ones). Bake 20 minutes.");
    expect(steps.map((s) => s.text)).toEqual(["Preheat oven to 350°F.", "Grease 12 muffin cups.", "Whisk 3 eggs (or use 4 small ones).", "Bake 20 minutes."]);
  });

  it("keeps one step per line or paragraph when there are several", () => {
    expect(cookSteps("Heat oil. Add garlic.\n\nServe.").steps.map((s) => s.text)).toEqual(["Heat oil. Add garlic.", "Serve."]);
  });

  it("reads a short heading the person wrote as the step's label", () => {
    const [step] = cookSteps("1. Rice: rinse the rice, then simmer 15 minutes.\n2. Serve.").steps;
    expect(step).toMatchObject({ label: "Rice", text: "rinse the rice, then simmer 15 minutes." });
    expect(step!.techniques.map((t) => t.id)).toEqual(["rinse", "simmer"]);
  });

  it("returns nothing for an empty method", () => {
    expect(cookSteps("  \n ")).toEqual({ intro: [], steps: [] });
  });
});

describe("techniques named in a step", () => {
  it("finds them in the order they're written", () => {
    expect(ids("Boil the potatoes until tender, then mash with warm milk")).toEqual(["boil", "mash"]);
    expect(ids("Sear the steak, rest 5 minutes, slice and serve")).toEqual(["sear", "rest", "slice"]);
    expect(ids("Stir-fry the peppers in a wok")).toEqual(["stir_fry"]);
  });

  it("reads Spanish, with or without accents", () => {
    expect(ids("Dóralo 6 minutos por lado")).toEqual(["sear"]);
    expect(ids("Pica la cebolla y sofríela en aceite")).toEqual(["chop", "saute"]);
    expect(ids("Cocina a fuego lento 20 minutos")).toEqual(["simmer"]);
  });

  it("ignores ingredient names and already-prepared ingredients", () => {
    expect(ids("Stir in 1 tsp baking powder")).toEqual(["mix"]);
    expect(ids("Add 1 diced onion and the peas (rinsed)")).toEqual([]);
    expect(ids("Reduce the heat and cover")).toEqual([]);
    expect(ids("Add the rest of the broth")).toEqual([]);
    expect(ids("Add brown rice and Swiss chard")).toEqual([]);
    expect(ids("Add picante sauce")).toEqual([]);
  });

  it("says nothing when no technique is named", () => {
    expect(ids("Cook the onions low until deep golden")).toEqual([]);
  });

  it("explains every technique without times, temperatures or safety claims", () => {
    for (const t of TECHNIQUES) {
      expect(t.what, t.id).not.toMatch(/\d|°|safe|bacteria|kill/i);
      expect(t.words.length, t.id).toBeGreaterThan(0);
    }
  });
});

describe("safe-temperature reminder on a step", () => {
  const rules = [SAFETY_RULES.poultry!, SAFETY_RULES.eggs!];
  const step = (method: string) => cookSteps(method).steps[0]!;

  it("shows the chart group a heated step is cooking", () => {
    expect(stepSafetyRules(step("Grill the thighs 5-7 minutes per side"), rules).map((r) => r.id)).toEqual(["poultry"]);
    expect(stepSafetyRules(step("Dora el pollo"), rules).map((r) => r.id)).toEqual(["poultry"]);
  });

  it("stays quiet for steps that don't heat that food", () => {
    expect(stepSafetyRules(step("Marinate the chicken"), rules)).toEqual([]);
    expect(stepSafetyRules(step("Roast the eggplant"), rules)).toEqual([]);
    expect(stepSafetyRules(step("Grill the thighs"), [SAFETY_RULES.fish!])).toEqual([]);
  });

  it("has reminder words for every chart group", () => {
    expect(SAFETY_RULE_IDS_WITH_WORDS.sort()).toEqual(Object.keys(SAFETY_RULES).sort());
  });
});

describe("progress fingerprint", () => {
  it("changes when the steps change", () => {
    const a = cookSteps("1. Boil.\n2. Serve.").steps;
    expect(stepsFingerprint(a)).toBe(stepsFingerprint(cookSteps("1. Boil.\n2. Serve.").steps));
    expect(stepsFingerprint(a)).not.toBe(stepsFingerprint(cookSteps("1. Boil.\n2. Plate.").steps));
  });
});
