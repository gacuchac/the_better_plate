import { useState } from "react";
import { DAILY_VALUE_SOURCE, FDA_DAILY_VALUES, formatAmount, percentDailyValue, type FoodRecord, type NutrientDefinition, type NutrientTotal, type RecipeNutrition } from "@betterplate/nutrition";
import type { RecipeIngredientInput } from "@betterplate/contracts";
import { Sheet } from "./common.tsx";

const PRIMARY = ["energy_kcal", "protein", "carbohydrate", "fat_total", "fiber"];

export function disclosureText(code: string, foodName: string): string {
  switch (code) {
    case "oil_discard_not_measured":
      return `All of the ${foodName} is counted as eaten, because no discarded amount was entered.`;
    case "oil_discard_exceeds_added":
      return `The discarded amount for ${foodName} is more than was added, so it isn't counted. Check the numbers.`;
    case "food_not_in_catalog":
      return "One ingredient isn't in the food list on this device, so it isn't counted.";
    case "portion_not_found":
      return `The portion chosen for ${foodName} isn't available, so it isn't counted.`;
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
  const [showAll, setShowAll] = useState(false);
  const [sourceKey, setSourceKey] = useState<string | null>(null);
  const rows = perServing ? nutrition.perServing : nutrition.totals;
  const defs = new Map(nutrients.map((n) => [n.key, n]));
  const visible = rows.filter((r) => showAll || PRIMARY.includes(r.key));
  const foodName = (id: string) => foods.get(ingredients.find((i) => i.id === id)?.foodId ?? "")?.description ?? "an ingredient";

  return (
    <section className="nutrition" aria-labelledby="nutrition-title" data-testid="nutrition-panel">
      <header className="nutrition-head">
        <h2 id="nutrition-title">
          Nutrition <span className="tag">Estimated</span>
        </h2>
        <div className="segmented" role="group" aria-label="Amount shown">
          <button type="button" aria-pressed={perServing} onClick={() => setPerServing(true)}>
            Per serving
          </button>
          <button type="button" aria-pressed={!perServing} onClick={() => setPerServing(false)}>
            Whole recipe
          </button>
        </div>
      </header>
      {ingredients.length === 0 ? (
        <p className="hint">Add ingredients to see an estimate.</p>
      ) : (
        <ul className="nutrient-list">
          {visible.map((row) => {
            const def = defs.get(row.key);
            return (
              <li key={row.key} data-testid={`nutrient-${row.key}`}>
                <button type="button" className="nutrient-row" onClick={() => setSourceKey(row.key)} aria-label={`${def?.name}: sources`}>
                  <NutrientLine row={row} name={def?.name ?? row.key} />
                </button>
                {row.status === "partial" && <p className="nutrient-note">Some ingredients don't report this nutrient, so the total may be higher.</p>}
              </li>
            );
          })}
        </ul>
      )}
      <button type="button" className="btn-link" onClick={() => setShowAll((v) => !v)}>
        {showAll ? "Show fewer nutrients" : "Show vitamins and minerals"}
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
        Estimates from USDA FoodData Central (SR Legacy), catalog {catalogVersion}. Not medical advice. "Not reported" means the source has no value, not zero.
      </p>
      {sourceKey && (
        <Sheet title={`Sources: ${defs.get(sourceKey)?.name ?? sourceKey}`} onClose={() => setSourceKey(null)}>
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
              {b.countedGrams === null ? "amount unknown" : `${b.countedGrams.toFixed(1)} g counted`}
              {ing?.role === "cooking_oil" && b.grams !== null && b.countedGrams !== b.grams ? ` of ${b.grams.toFixed(1)} g added` : ""}
              {" · "}
              {per100 === undefined ? "not reported by source" : `${formatAmount(b.contributions[nutrientKey] ?? null, unit)} (${per100} ${unit} per 100 g)`}
            </span>
            {food && (
              <a href={food.source.url} target="_blank" rel="noopener noreferrer">
                {food.source.dataset}, FDC {food.id.replace("fdc:", "")} · retrieved {food.source.retrievedAt.slice(0, 10)}
              </a>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** One nutrient: amount, % of the FDA reference Daily Value where one exists, and a calm bar. */
export function NutrientLine({ row, name }: { row: Pick<NutrientTotal, "key" | "amount" | "unit" | "status">; name: string }) {
  const pct = percentDailyValue(row, FDA_DAILY_VALUES);
  const hasDv = FDA_DAILY_VALUES.some((d) => d.key === row.key);
  return (
    <>
      <span className="nutrient-name">{name}</span>
      <span>
        <span className={`nutrient-value status-${row.status}`}>
          {row.status === "partial" && <span className="qualifier">at least </span>}
          {formatAmount(row.amount, row.unit)}
        </span>
        {pct !== null && <span className="dv"> · {Math.round(pct)}%</span>}
      </span>
      {hasDv &&
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

export function DailyValueNote() {
  return (
    <p className="fine">
      Percentages compare with the{" "}
      <a href={DAILY_VALUE_SOURCE.url} target="_blank" rel="noopener noreferrer">
        FDA Daily Values
      </a>{" "}
      used on U.S. food labels (current as of {DAILY_VALUE_SOURCE.contentCurrentAsOf}, retrieved {DAILY_VALUE_SOURCE.retrievedAt}). They are reference amounts, not personal targets.
    </p>
  );
}
