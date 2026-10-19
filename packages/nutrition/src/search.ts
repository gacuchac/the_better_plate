/**
 * Deterministic food search shared by the browser (offline) and the API, so both rank the same way.
 *
 * Every query word must match part of a description word, in any order: whole word > start of a
 * word > inside a word ("loin" finds "sirloin"). Simple English plurals match ("steaks" finds
 * "steak"). Ties go to the main food name, raw entries, then shorter names; restaurant and brand
 * entries (USDA writes their names in capitals, like "OLIVE GARDEN, …") come after generic foods.
 * Everyday entries (everyday-foods.ts) rank first among matches, so "milk" finds cow's milk.
 */

import { EVERYDAY_FOODS, SEARCH_SYNONYMS } from "./everyday-foods.ts";

const EVERYDAY = new Set(EVERYDAY_FOODS);

export interface SearchIndex<T> {
  entries: SearchEntry<T>[];
}

interface SearchEntry<T> {
  item: T;
  /** Each word with its singular form. */
  words: string[][];
  /** Word positions of the main food name: the part before the first comma ("Beef" in "Beef, loin, …"),
   *  or the second part after a USDA group word ("salmon" in "Fish, salmon, …"). */
  head: [number, number];
  raw: boolean;
  brand: boolean;
  everyday: boolean;
  length: number;
  sortKey: string;
}

const MAX_QUERY_WORDS = 8;
/** USDA group words that come before the food's own name in SR Legacy descriptions. */
const GROUP_PREFIXES = new Set(["fish", "crustaceans", "mollusks", "spices", "game meat", "beverages", "snacks", "nuts", "seeds", "oil", "cheese", "cereals", "candies"]);

export function normalizeSearchText(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Strips common English plural endings; applied to both sides, so it only has to be consistent. */
export function singular(word: string): string {
  if (word.length > 4 && word.endsWith("ies")) return `${word.slice(0, -3)}y`;
  if (word.length > 4 && /(ch|sh|x|ss|o)es$/.test(word)) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith("s") && !word.endsWith("ss") && !word.endsWith("us")) return word.slice(0, -1);
  return word;
}

const forms = (word: string) => {
  const s = singular(word);
  return s === word ? [word] : [word, s];
};

export function buildSearchIndex<T extends { description: string }>(items: Iterable<T>): SearchIndex<T> {
  const entries: SearchEntry<T>[] = [];
  for (const item of items) {
    const tokens = normalizeSearchText(item.description).split(" ").filter(Boolean);
    const parts = item.description.split(",").map((s) => normalizeSearchText(s).split(" ").filter(Boolean).length);
    const first = normalizeSearchText(item.description.split(",")[0] ?? "");
    const head: [number, number] = GROUP_PREFIXES.has(first) && parts.length > 1 ? [parts[0]!, parts[0]! + parts[1]!] : [0, parts[0] ?? 0];
    const firstWord = item.description.split(/[\s,]/)[0] ?? "";
    entries.push({
      item,
      words: tokens.map(forms),
      head,
      raw: tokens.includes("raw"),
      brand: /[A-Z]{2}/.test(firstWord) && firstWord === firstWord.toUpperCase(),
      everyday: EVERYDAY.has(item.description),
      length: item.description.length,
      sortKey: item.description.toLowerCase(),
    });
  }
  return { entries };
}

/** 3 whole word, 2 start of a word, 1 inside a word (3+ letters), 0 no match; plus where it matched. */
function bestMatch(entry: SearchEntry<unknown>, query: string[]): { score: number; at: number } {
  let best = { score: 0, at: -1 };
  entry.words.forEach((wordForms, at) => {
    for (const w of wordForms) {
      for (const q of query) {
        const score = w === q ? 3 : w.startsWith(q) ? 2 : q.length >= 3 && w.includes(q) ? 1 : 0;
        if (score > best.score) best = { score, at };
      }
    }
  });
  return best;
}

/** `words` adds a word map for another language (see SPANISH_SEARCH_WORDS); English synonyms always apply. */
export function searchIndex<T>(index: SearchIndex<T>, query: string, limit = 30, words?: Readonly<Record<string, string>>): T[] {
  const translate = (w: string) => words?.[w] ?? words?.[singular(w)] ?? w;
  const terms = normalizeSearchText(query)
    .split(" ")
    .filter(Boolean)
    .flatMap((w) => translate(w).split(" "))
    .filter(Boolean)
    .flatMap((w) => (SEARCH_SYNONYMS[w] ?? SEARCH_SYNONYMS[singular(w)] ?? w).split(" "))
    .slice(0, MAX_QUERY_WORDS);
  if (terms.length === 0) return index.entries.slice(0, limit).map((e) => e.item);
  const queries = terms.map(forms);
  const scored: { entry: SearchEntry<T>; score: number }[] = [];
  for (const entry of index.entries) {
    let score = 0;
    let ok = true;
    let whole = true;
    for (const [i, q] of queries.entries()) {
      const m = bestMatch(entry, q);
      if (m.score === 0) {
        ok = false;
        break;
      }
      score += m.score * 10;
      if (m.score < 3) whole = false;
      // The first word usually names the food itself ("beef", "rice"); favor it in the main name.
      if (i === 0 && m.score >= 2 && m.at >= entry.head[0] && m.at < entry.head[1]) score += m.at === entry.head[0] ? 8 : 5;
    }
    if (!ok) continue;
    if (entry.raw) score += 2;
    // Only when every word is a whole word, so "egg" does not lift "Eggplant".
    if (entry.everyday && whole) score += 12;
    if (entry.brand) score -= 10;
    scored.push({ entry, score });
  }
  scored.sort(
    (a, b) => b.score - a.score || a.entry.length - b.entry.length || (a.entry.sortKey < b.entry.sortKey ? -1 : a.entry.sortKey > b.entry.sortKey ? 1 : 0),
  );
  return scored.slice(0, limit).map((s) => s.entry.item);
}
