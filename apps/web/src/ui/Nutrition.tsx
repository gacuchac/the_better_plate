import { useState } from "react";
import { DAILY_VALUE_SOURCE, percentDailyValue, type FoodRecord, type NutrientDefinition, type NutrientTotal, type RecipeNutrition } from "@betterplate/nutrition";
import type { RecipeIngredientInput } from "@betterplate/contracts";
import { Sheet } from "./common.tsx";
import { useApp } from "../store.tsx";
import { useTargets } from "../targets.ts";
import { formatQty, nutrientName, t as translate, useT } from "../i18n.ts";

const PRIMARY = ["energy_kcal", "protein", "carbohydrate", "fat_total", "fiber"];

export function disclosureText(code: string, foodName: string): string {
  switch (code) {
    case "oil_discard_not_measured":
      return translate("disclosure.oilNotMeasured", { food: foodName });
    case "oil_discard_exceeds_added":
      return translate("disclosure.oilExceeds", { food: foodName });
    case "food_not_in_catalog":
      return translate("disclosure.foodMissing");
    case "portion_not_found":
      return translate("disclosure.portionMissing", { food: foodName });
    default:
      return code;
  }
}

export function NutritionPanel({
  nutrition,
  nutrients,
  foods,
  ingredients,
  catalogVersion,
}: {
  nutrition: RecipeNutrition;
  nutrients: NutrientDefinition[];
  foods: Map<string, FoodRecord>;
  ingredients: RecipeIngredientInput[];
  catalogVersion: string;
}) {
  const [perServing, setPerServing] = useState(true);
  const t = useT();
  const [showAll, setShowAll] = useState(false);
  const [sourceKey, setSourceKey] = useState<string | null>(null);
  const rows = perServing ? nutrition.perServing : nutrition.totals;
  const defs = new Map(nutrients.map((n) => [n.key, n]));
  const visible = rows.filter((r) => showAll || PRIMARY.includes(r.key));
  const foodName = (id: string) => foods.get(ingredients.find((i) => i.id === id)?.foodId ?? "")?.description ?? t("editor.anIngredient");

  return (
    <section className="nutrition" aria-labelledby="nutrition-title" data-testid="nutrition-panel">
      <header className="nutrition-head">
        <h2 id="nutrition-title">
          {t("nutrition.title")} <span className="tag">{t("common.estimated")}</span>
        </h2>
        <div className="segmented" role="group" aria-label={t("nutrition.amountShown")}>
          <button type="button" aria-pressed={perServing} onClick={() => setPerServing(true)}>
            {t("nutrition.perServing")}
          </button>
          <button type="button" aria-pressed={!perServing} onClick={() => setPerServing(false)}>
            {t("nutrition.wholeRecipe")}
          </button>
        </div>
      </header>
      {ingredients.length === 0 ? (
        <p className="hint">{t("nutrition.empty")}</p>
      ) : (
        <ul className="nutrient-list">
          {visible.map((row) => {
            const def = defs.get(row.key);
            const name = nutrientName(row.key, def?.name ?? row.key);
            return (
              <li key={row.key} data-testid={`nutrient-${row.key}`}>
                <button type="button" className="nutrient-row" onClick={() => setSourceKey(row.key)} aria-label={t("nutrition.sourcesFor", { name })}>
                  <NutrientLine row={row} name={name} />
                </button>
                {row.status === "partial" && <p className="nutrient-note">{t("nutrition.partial")}</p>}
              </li>
            );
          })}
        </ul>
      )}
      <button type="button" className="btn-link" onClick={() => setShowAll((v) => !v)}>
        {showAll ? t("nutrition.showFewer") : t("nutrition.showAll")}
      </button>
      {nutrition.disclosures.length > 0 && (
        <ul className="disclosures" data-testid="disclosures">
          {nutrition.disclosures.map((d) => (
            <li key={`${d.code}-${d.ingredientId}`}>{disclosureText(d.code, foodName(d.ingredientId))}</li>
          ))}
        </ul>
      )}
      <DailyValueNote />
      <p className="fine">
        {t("nutrition.fine", { version: catalogVersion })}
      </p>
      {sourceKey && (
        <Sheet title={t("nutrition.sourcesTitle", { name: nutrientName(sourceKey, defs.get(sourceKey)?.name ?? sourceKey) })} onClose={() => setSourceKey(null)}>
          <SourceList nutrientKey={sourceKey} nutrition={nutrition} foods={foods} ingredients={ingredients} unit={defs.get(sourceKey)?.unit ?? ""} />
        </Sheet>
      )}
    </section>
  );
}

function SourceList({
  nutrientKey,
  nutrition,
  foods,
  ingredients,
  unit,
}: {
  nutrientKey: string;
  nutrition: RecipeNutrition;
  foods: Map<string, FoodRecord>;
  ingredients: RecipeIngredientInput[];
  unit: string;
}) {
  const t = useT();
  return (
    <ul className="source-list" data-testid="source-list">
      {nutrition.ingredients.map((b) => {
        const food = foods.get(b.foodId);
        const ing = ingredients.find((i) => i.id === b.ingredientId);
        const per100 = food?.nutrientsPer100g[nutrientKey];
        return (
          <li key={b.ingredientId}>
            <strong>{food?.description ?? b.foodId}</strong>
            <span>
              {b.countedGrams === null ? t("sources.amountUnknown") : t("sources.counted", { g: b.countedGrams.toFixed(1) })}
              {ing?.role === "cooking_oil" && b.grams !== null && b.countedGrams !== b.grams ? ` ${t("sources.ofAdded", { g: b.grams.toFixed(1) })}` : ""}
              {" · "}
              {per100 === undefined ? t("sources.notReported") : t("sources.contribution", { amount: formatQty(b.contributions[nutrientKey] ?? null, unit), per100: `${per100} ${unit}` })}
            </span>
            {food && (
              <a href={food.source.url} target="_blank" rel="noopener noreferrer">
                {food.source.dataset}, FDC {food.id.replace("fdc:", "")} · {t("sources.retrieved", { date: food.source.retrievedAt.slice(0, 10) })}
              </a>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * One nutrient: the amount, and a percent with a calm bar only against a daily target the
 * person set themselves. Without one, no percent: reference values aren't personal needs.
 */
export function NutrientLine({ row, name }: { row: Pick<NutrientTotal, "key" | "amount" | "unit" | "status">; name: string }) {
  const t = useT();
  const { account } = useApp();
  const targets = useTargets(account?.id);
  const pct = percentDailyValue(row, targets);
  const hasTarget = targets.some((d) => d.key === row.key && d.unit === row.unit);
  return (
    <>
      <span className="nutrient-name">{name}</span>
      <span>
        <span className={`nutrient-value status-${row.status}`}>
          {row.status === "partial" && <span className="qualifier">{t("nutrition.atLeast")} </span>}
          {formatQty(row.amount, row.unit)}
        </span>
        {pct !== null && <span className="dv"> · {t("targets.pctOfYours", { pct: Math.round(pct) })}</span>}
      </span>
      {hasTarget &&
        (row.status === "unknown" ? (
          <span className="bar unknown" aria-hidden="true" />
        ) : (
          <span className="bar" aria-hidden="true">
            <span style={{ width: `${Math.min(100, pct ?? 0)}%` }} />
          </span>
        ))}
    </>
  );
}

/** Says what percentages mean here, links to the person's own targets, and cites the label reference. */
export function DailyValueNote() {
  const t = useT();
  const { account } = useApp();
  const targets = useTargets(account?.id);
  return (
    <p className="fine" data-testid="targets-note">
      {account ? (
        <>
          {targets.length ? t("targets.noteSet") : t("targets.noteUnset")} <a href="#/targets">{targets.length ? t("targets.change") : t("targets.set")}</a>{" "}
        </>
      ) : null}
      {t("dv.before")}{" "}
      <a href={DAILY_VALUE_SOURCE.url} target="_blank" rel="noopener noreferrer">
        {t("dv.link")}
      </a>{" "}
      {t("dv.after", { current: DAILY_VALUE_SOURCE.contentCurrentAsOf, retrieved: DAILY_VALUE_SOURCE.retrievedAt })}
    </p>
  );
}
