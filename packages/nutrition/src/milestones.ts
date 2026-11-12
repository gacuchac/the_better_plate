// Small steps people can share with the community (owner decision 2026-11-12): pure helpers shared
// by the app, which suggests milestones, and the API, which checks what is shared.

/** USDA SR Legacy food groups counted as plants for "Tried something new". */
export const PLANT_CATEGORIES = [
  "Vegetables and Vegetable Products",
  "Fruits and Fruit Juices",
  "Legumes and Legume Products",
  "Nut and Seed Products",
] as const;

export function isPlantFood(food: { description: string; category?: string | null }): boolean {
  return (PLANT_CATEGORIES as readonly string[]).includes(food.category ?? "") && !/\bjuice\b/i.test(food.description);
}

// Name parts that describe a form or preparation rather than which food it is.
const FORM_WORDS = [
  "raw", "cooked", "boiled", "frozen", "canned", "dried", "dehydrated", "drained", "unprepared", "prepared", "steamed",
  "baked", "roasted", "microwaved", "sprouted", "mature seeds", "immature seeds", "with ", "without ", "no salt",
  "solids", "includes", "all varieties", "fresh", "stewed", "pickled", "sweetened", "unsweetened", "as purchased",
];

/** Splits on commas outside parentheses: "Chickpeas (garbanzo beans, bengal gram), raw" has two parts. */
function parts(description: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of description) {
    if (ch === "(") depth++;
    if (ch === ")") depth = Math.max(0, depth - 1);
    if (ch === "," && depth === 0) {
      out.push(current.trim());
      current = "";
    } else current += ch;
  }
  out.push(current.trim());
  return out.filter(Boolean);
}

/**
 * Which food this is, without how it was prepared, so "Kale, raw" and "Kale, cooked, boiled" are one
 * food: the leading name parts up to the first form word, at most two ("Beans, kidney").
 */
export function foodBaseName(description: string): string {
  const kept: string[] = [];
  for (const part of parts(description)) {
    const lower = part.toLowerCase();
    if (kept.length > 0 && FORM_WORDS.some((w) => lower.startsWith(w))) break;
    kept.push(part.replace(/\s*\([^)]*\)\s*/g, " ").trim());
    if (kept.length === 2) break;
  }
  return kept.join(", ") || description.trim();
}

/** ISO 8601 week of a calendar day ("2026-11-12" is in "2026-W46"); weeks start on Monday. */
export function isoWeek(date: string): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const day = new Date(Date.UTC(y, m - 1, d));
  const weekday = day.getUTCDay() || 7;
  day.setUTCDate(day.getUTCDate() + 4 - weekday); // the Thursday of this week decides its year
  const yearStart = Date.UTC(day.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((day.getTime() - yearStart) / 86_400_000 + 1) / 7);
  return `${day.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

/** The Monday that starts the week of a calendar day. */
export function weekStart(date: string): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const day = new Date(Date.UTC(y, m - 1, d));
  day.setUTCDate(day.getUTCDate() - ((day.getUTCDay() || 7) - 1));
  return day.toISOString().slice(0, 10);
}

/** Adds days to a calendar day. */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}
