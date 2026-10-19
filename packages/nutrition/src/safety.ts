/**
 * Safe minimum internal temperatures, transcribed from the U.S. government chart below.
 * Only the chart's own categories are used; foods it does not cover get no temperature.
 * °C values are arithmetic conversions of the published °F, rounded to whole degrees.
 */
export const SAFE_TEMPERATURE_SOURCE = {
  publisher: "FoodSafety.gov (U.S. Department of Health and Human Services, with USDA FSIS)",
  title: "Cook to a Safe Minimum Internal Temperature",
  url: "https://www.foodsafety.gov/food-safety-charts/safe-minimum-internal-temperatures",
  lastReviewed: "2024-11-21",
  retrievedAt: "2026-10-19",
} as const;

export interface SafetyRule {
  id: string;
  /** What the chart calls this group. */
  label: string;
  /** Safe minimum internal temperature in °F, or null when the chart gives a visual test instead. */
  fahrenheit: number | null;
  restMinutes: number | null;
  /** The chart's visual cue or extra instruction, paraphrased. */
  note: string | null;
}

export const SAFETY_RULES: Record<string, SafetyRule> = {
  whole_cuts: { id: "whole_cuts", label: "Beef, pork, lamb, veal or goat steaks, roasts and chops", fahrenheit: 145, restMinutes: 3, note: null },
  ground_meat: { id: "ground_meat", label: "Ground meat and sausage", fahrenheit: 160, restMinutes: null, note: null },
  poultry: { id: "poultry", label: "Chicken, turkey and other poultry (whole, pieces or ground)", fahrenheit: 165, restMinutes: null, note: null },
  game: { id: "game", label: "Rabbit and venison", fahrenheit: 160, restMinutes: null, note: null },
  fish: { id: "fish", label: "Fish (whole or fillet)", fahrenheit: 145, restMinutes: null, note: "Or until the flesh is opaque and separates easily with a fork." },
  crustaceans: { id: "crustaceans", label: "Shrimp, lobster, crab and scallops", fahrenheit: null, restMinutes: null, note: "Cook until the flesh is pearly or white and opaque." },
  bivalves: { id: "bivalves", label: "Clams, oysters and mussels", fahrenheit: null, restMinutes: null, note: "Cook until the shells open." },
  eggs: { id: "eggs", label: "Eggs", fahrenheit: null, restMinutes: null, note: "Cook until the yolk and white are firm. Egg dishes such as frittatas and quiches: 160°F." },
};

export const fahrenheitToCelsius = (f: number) => Math.round(((f - 32) * 5) / 9);

const has = (text: string, ...words: string[]) => words.some((w) => new RegExp(`\\b${w}`, "i").test(text));

/**
 * Maps a USDA SR Legacy food (category + description) to the chart group that applies when
 * cooking it, or null when the chart does not cover it (vegetables, grains, oils, ...).
 */
export function safetyRuleFor(food: { category?: string | null; description: string }): SafetyRule | null {
  const cat = food.category ?? "";
  const d = food.description;
  if (cat === "Poultry Products") return SAFETY_RULES.poultry!;
  if (cat === "Finfish and Shellfish Products") {
    if (has(d, "clam", "oyster", "mussel")) return SAFETY_RULES.bivalves!;
    if (has(d, "shrimp", "lobster", "crab", "scallop", "crayfish", "crustaceans")) return SAFETY_RULES.crustaceans!;
    if (has(d, "mollusks")) return null; // squid, octopus, snails: not in the chart
    return SAFETY_RULES.fish!;
  }
  if (cat === "Lamb, Veal, and Game Products" && has(d, "rabbit", "deer", "venison", "elk", "moose", "caribou")) return SAFETY_RULES.game!;
  if (cat === "Beef Products" || cat === "Pork Products" || cat === "Lamb, Veal, and Game Products") {
    return has(d, "ground", "sausage") ? SAFETY_RULES.ground_meat! : SAFETY_RULES.whole_cuts!;
  }
  if (cat === "Sausages and Luncheon Meats" && has(d, "raw", "fresh") && has(d, "sausage")) return SAFETY_RULES.ground_meat!;
  if (cat === "Dairy and Egg Products" && /^egg,/i.test(d) && has(d, "raw", "fresh", "whole")) return SAFETY_RULES.eggs!;
  return null;
}

/**
 * Splits a person's own method text into steps: numbered lines, bullets or blank-line
 * paragraphs. The words are theirs; nothing is generated.
 */
export function splitSteps(method: string): string[] {
  const lines = method.split(/\r?\n/).map((l) => l.trim());
  const numbered = lines.filter((l) => /^(\d+[.)]|[-*•])\s+/.test(l));
  if (numbered.length >= 2) {
    const steps: string[] = [];
    for (const l of lines) {
      if (!l) continue;
      if (/^(\d+[.)]|[-*•])\s+/.test(l)) steps.push(l.replace(/^(\d+[.)]|[-*•])\s+/, ""));
      else if (steps.length) steps[steps.length - 1] += ` ${l}`;
      else steps.push(l);
    }
    return steps;
  }
  return method
    .split(/\n\s*\n|\r?\n/)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

/** Finds a duration the person wrote in a step ("simmer 10 minutes", "5-7 min"), in seconds. */
export function stepTimerSeconds(step: string): number | null {
  const m = /(\d+(?:\.\d+)?)(?:\s*(?:-|–|to)\s*(\d+(?:\.\d+)?))?\s*(hours?|hrs?|h\b|minutes?|mins?|m\b|seconds?|secs?|s\b)/i.exec(step);
  if (!m) return null;
  const value = Number(m[1]);
  const unit = m[3]!.toLowerCase();
  const mult = unit.startsWith("h") ? 3600 : unit.startsWith("s") ? 1 : 60;
  const seconds = Math.round(value * mult);
  return seconds > 0 && seconds <= 24 * 3600 ? seconds : null;
}
