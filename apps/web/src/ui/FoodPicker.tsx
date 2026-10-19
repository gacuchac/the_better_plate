import { useMemo, useState } from "react";
import type { FoodRecord } from "@betterplate/nutrition";

/** Local search over the catalog stored on this device; works offline, no per-keystroke requests. */
export function searchFoods(foods: Iterable<FoodRecord>, query: string, limit = 30): FoodRecord[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const all = [...foods];
  if (!words.length) return all.slice(0, limit);
  return all
    .filter((f) => words.every((w) => f.description.toLowerCase().includes(w)))
    .sort((a, b) => Number(b.description.toLowerCase().startsWith(words[0]!)) - Number(a.description.toLowerCase().startsWith(words[0]!)) || a.description.length - b.description.length)
    .slice(0, limit);
}

export function FoodPicker({ foods, onPick, online }: { foods: Map<string, FoodRecord>; onPick: (food: FoodRecord) => void; online: boolean }) {
  const [query, setQuery] = useState("");
  const results = useMemo(() => searchFoods(foods.values(), query), [foods, query]);
  return (
    <div className="picker">
      <label htmlFor="food-search" className="sr-only">
        Search foods
      </label>
      <input id="food-search" type="search" placeholder="Search foods, e.g. broccoli" autoFocus value={query} onChange={(e) => setQuery(e.target.value)} />
      <p className="hint">
        Searching {foods.size} USDA foods saved on this device.{!online && " You're offline, so only these foods are available."}
      </p>
      <ul className="food-results" role="listbox" aria-label="Foods">
        {results.map((f) => (
          <li key={f.id}>
            <button type="button" role="option" aria-selected="false" onClick={() => onPick(f)}>
              <span>{f.description}</span>
              <small>{f.category}</small>
            </button>
          </li>
        ))}
        {results.length === 0 && (
          <li>
            <NotInCatalog />
          </li>
        )}
      </ul>
    </div>
  );
}

/** Shown when a search has no match: we never estimate nutrients for a food without a sourced record. */
export function NotInCatalog() {
  return (
    <p className="hint" data-testid="not-in-catalog">
      No match in the USDA starter foods. Try a simpler word, like "rice" instead of "jasmine rice". If it's still missing, it isn't in our list yet, and we don't estimate nutrients for foods without a USDA source.
    </p>
  );
}
