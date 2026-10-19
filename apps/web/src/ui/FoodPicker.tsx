import { useMemo, useState } from "react";
import { buildSearchIndex, searchIndex, SPANISH_SEARCH_WORDS, type FoodRecord, type SearchIndex } from "@betterplate/nutrition";
import { getLang, useLang, useT } from "../i18n.ts";

const indexes = new WeakMap<Map<string, FoodRecord>, SearchIndex<FoodRecord>>();

/** Local search over the catalog stored on this device; works offline, no per-keystroke requests. */
export function searchFoods(foods: Map<string, FoodRecord>, query: string, limit = 30): FoodRecord[] {
  let index = indexes.get(foods);
  if (!index) indexes.set(foods, (index = buildSearchIndex(foods.values())));
  // Spanish words map to USDA's English ones only when the interface is in Spanish.
  return searchIndex(index, query, limit, getLang() === "es" ? SPANISH_SEARCH_WORDS : undefined);
}

export function FoodPicker({ foods, onPick, online }: { foods: Map<string, FoodRecord>; onPick: (food: FoodRecord) => void; online: boolean }) {
  const [query, setQuery] = useState("");
  const t = useT();
  const lang = useLang();
  const results = useMemo(() => searchFoods(foods, query), [foods, query, lang]);
  return (
    <div className="picker">
      <label htmlFor="food-search" className="sr-only">
        {t("food.search")}
      </label>
      <input id="food-search" type="search" placeholder={t("food.pickerPlaceholder")} autoFocus value={query} onChange={(e) => setQuery(e.target.value)} />
      <p className="hint">
        {t("food.searching", { n: foods.size })}
        {!online && ` ${t("food.offlineOnly")}`} <EnglishNamesNote />
      </p>
      <ul className="food-results" aria-label={t("food.listLabel")}>
        {results.map((f) => (
          <li key={f.id}>
            <button type="button" onClick={() => onPick(f)}>
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
  const t = useT();
  return (
    <p className="hint" data-testid="not-in-catalog">
      {t("food.noMatch")}
    </p>
  );
}

/** Food names come from USDA in English, so search in English too. Said only when the interface isn't English. */
export function EnglishNamesNote() {
  const t = useT();
  const lang = useLang();
  return lang === "en" ? null : <>{t("food.englishNames")}</>;
}
