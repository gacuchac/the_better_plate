import { useEffect, useMemo, useState } from "react";
import { RecipeBodySchema, type RecipeBody, type RecipeIngredientInput } from "@betterplate/contracts";
import { calculateRecipe, formatAmount, type FoodRecord } from "@betterplate/nutrition";
import type { LocalRecipe } from "../localdb.ts";
import { useApp } from "../store.tsx";
import { EmptyState, navigate, Sheet } from "./common.tsx";
import { FoodPicker } from "./FoodPicker.tsx";
import { Icon } from "./icons.tsx";
import { LogSheet, PlanSheet } from "./MealSheets.tsx";
import { NutritionPanel } from "./Nutrition.tsx";

const MACROS = [
  { key: "energy_kcal", label: "kcal" },
  { key: "protein", label: "Protein" },
  { key: "carbohydrate", label: "Carbs" },
  { key: "fat_total", label: "Fat" },
];

const blank = (): RecipeBody => ({ title: "", servings: 2, ingredients: [], method: "" });

function unitValue(i: RecipeIngredientInput) {
  return i.unit === "portion" ? `p:${i.portionIndex ?? 0}` : i.unit;
}

export function RecipeEditor({ id }: { id: string }) {
  const { engine, catalog, online } = useApp();
  const [loaded, setLoaded] = useState<LocalRecipe | null | undefined>(undefined);
  const [draft, setDraft] = useState<RecipeBody>(blank);
  const [dirty, setDirty] = useState(false);
  const [picking, setPicking] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [sheet, setSheet] = useState<"plan" | "log" | null>(null);

  useEffect(() => {
    if (!engine) return;
    const load = () =>
      void engine.getRecipe(id).then((r) => {
        setLoaded(r ?? null);
        if (r && !dirty) setDraft(r.body);
        if (r && r.state !== "pending") setMessage(null);
      });
    load();
    return engine.subscribe(load);
  }, [engine, id, dirty]);

  const foods = catalog.status === "ready" ? catalog.foods : new Map<string, FoodRecord>();
  const nutrients = catalog.status === "ready" ? catalog.bundle.nutrients : [];
  // Live, local and deterministic: no network call per keystroke.
  const nutrition = useMemo(() => calculateRecipe(draft, foods, nutrients), [draft, foods, nutrients]);

  if (!engine || catalog.status === "loading" || loaded === undefined) return <p className="hint pad">Loading…</p>;
  if (catalog.status === "unavailable") return <EmptyState title="Food list not on this device yet">{catalog.message}</EmptyState>;

  const update = (patch: Partial<RecipeBody>) => {
    setDraft((d) => ({ ...d, ...patch }));
    setDirty(true);
    setMessage(null);
  };
  const updateIngredient = (ingId: string, patch: Partial<RecipeIngredientInput>) =>
    update({ ingredients: draft.ingredients.map((i) => (i.id === ingId ? { ...i, ...patch } : i)) });

  const addFood = (food: FoodRecord) => {
    const isOil = /^oil,/i.test(food.description) || food.category === "Fats and Oils";
    // Grams by default: neutral and transparent. Oils start at one tablespoon when USDA lists it.
    const tbsp = isOil ? food.portions.findIndex((p) => /tablespoon|tbsp/i.test(p.label)) : -1;
    const portion = tbsp >= 0 ? tbsp : null;
    update({
      ingredients: [
        ...draft.ingredients,
        {
          id: crypto.randomUUID(),
          foodId: food.id,
          quantity: portion === null ? 100 : 1,
          unit: portion === null ? "g" : "portion",
          portionIndex: portion,
          role: isOil ? "cooking_oil" : "ingredient",
          oilDiscardedGrams: null,
        },
      ],
    });
    setPicking(false);
  };

  async function save() {
    const parsed = RecipeBodySchema.safeParse({ ...draft, title: draft.title.trim() });
    if (!parsed.success) {
      setErrors(parsed.error.issues.map((i) => i.message));
      return;
    }
    setErrors([]);
    await engine!.saveRecipe(id, parsed.data);
    setDirty(false);
    setMessage(online ? "Saved on this device. Syncing…" : "Saved on this device. It will sync when you're online.");
  }

  async function remove() {
    if (!confirm("Delete this recipe? This removes it from all your devices after it syncs.")) return;
    await engine!.deleteRecipe(id);
    navigate("/kitchen");
  }

  return (
    <div className="editor">
      {loaded?.state === "conflict" && <ConflictBanner id={id} local={loaded} onResolved={() => setDirty(false)} />}
      {loaded?.state === "rejected" && (
        <p className="banner banner-warn" role="alert">
          The server couldn't accept this version: {loaded.rejection}. Edit and save again.
        </p>
      )}
      <div className="editor-grid">
        <section className="editor-main" aria-label="Recipe">
          <label htmlFor="title" className="sr-only">
            Recipe name
          </label>
          <input id="title" className="title-input" value={draft.title} placeholder="Name your recipe" onChange={(e) => update({ title: e.target.value })} />

          <div className="stepper-row">
            <label htmlFor="servings">Servings</label>
            <div className="stepper">
              <button type="button" aria-label="One serving fewer" onClick={() => update({ servings: Math.max(1, Math.ceil(draft.servings) - 1) })}>
                −
              </button>
              <input id="servings" type="number" min={0.25} step={0.25} inputMode="decimal" value={draft.servings} onChange={(e) => update({ servings: Number(e.target.value) })} />
              <button type="button" aria-label="One serving more" onClick={() => update({ servings: Math.floor(draft.servings) + 1 })}>
                +
              </button>
            </div>
          </div>

          {draft.ingredients.length > 0 && (
            <a className="card summary-card" href="#nutrition" onClick={(e) => { e.preventDefault(); document.getElementById("nutrition")?.scrollIntoView({ behavior: "smooth" }); }} data-testid="nutrition-summary">
              <span className="card-head" style={{ marginBottom: 0 }}>
                <span className="hint" style={{ margin: 0 }}>
                  Per serving · <span className="estimated">Estimated</span>
                </span>
                <span style={{ fontSize: "0.8125rem", fontWeight: 650, color: "var(--sage-ink)" }}>Details and sources</span>
              </span>
              <span className="macro-grid">
                {MACROS.map((m) => {
                  const t = nutrition.perServing.find((x) => x.key === m.key);
                  const v = !t || t.amount === null ? "–" : t.unit === "kcal" ? Math.round(t.amount).toString() : formatAmount(t.amount, t.unit);
                  return (
                    <span key={m.key}>
                      <span className="macro-value" style={{ display: "block" }}>{t?.status === "partial" ? `≥ ${v}` : v}</span>
                      <span className="macro-label">{m.label}</span>
                    </span>
                  );
                })}
              </span>
            </a>
          )}

          <div className="section-head">
            <h2>Ingredients</h2>
            <button type="button" className="btn-soft" onClick={() => setPicking(true)}>
              <Icon name="plus" size={18} /> Add ingredient
            </button>
          </div>
          {draft.ingredients.length === 0 && <p className="hint">Add foods from the USDA list saved on this device.</p>}
          <ul className="ingredients">
            {draft.ingredients.map((ing) => {
              const food = foods.get(ing.foodId);
              return (
                <li key={ing.id} className="ingredient" data-testid="ingredient-row">
                  <div className="ingredient-name">{food?.description ?? `${ing.foodId} (not on this device)`}</div>
                  <div className="ingredient-controls">
                    <label className="sr-only" htmlFor={`q-${ing.id}`}>
                      Amount
                    </label>
                    <input
                      id={`q-${ing.id}`}
                      type="number"
                      min={0}
                      step="any"
                      inputMode="decimal"
                      value={ing.quantity}
                      onChange={(e) => updateIngredient(ing.id, { quantity: Number(e.target.value) })}
                    />
                    <label className="sr-only" htmlFor={`u-${ing.id}`}>
                      Unit
                    </label>
                    <select
                      id={`u-${ing.id}`}
                      value={unitValue(ing)}
                      onChange={(e) => {
                        const v = e.target.value;
                        if (v.startsWith("p:")) updateIngredient(ing.id, { unit: "portion", portionIndex: Number(v.slice(2)) });
                        else updateIngredient(ing.id, { unit: v as RecipeIngredientInput["unit"], portionIndex: null });
                      }}
                    >
                      <option value="g">g</option>
                      <option value="oz">oz</option>
                      <option value="kg">kg</option>
                      <option value="lb">lb</option>
                      {food?.portions.map((p, idx) => (
                        <option key={idx} value={`p:${idx}`}>
                          × {p.label} ({p.gramWeight} g)
                        </option>
                      ))}
                    </select>
                    <button type="button" className="icon-btn" aria-label={`Remove ${food?.description ?? "ingredient"}`} onClick={() => update({ ingredients: draft.ingredients.filter((i) => i.id !== ing.id) })}>
                      <Icon name="close" />
                    </button>
                  </div>
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={ing.role === "cooking_oil"}
                      onChange={(e) => updateIngredient(ing.id, { role: e.target.checked ? "cooking_oil" : "ingredient", oilDiscardedGrams: null })}
                    />
                    Cooking oil (some may be left in the pan)
                  </label>
                  {ing.role === "cooking_oil" && (
                    <div className="oil">
                      <label htmlFor={`d-${ing.id}`}>Oil discarded after cooking, if measured (g)</label>
                      <input
                        id={`d-${ing.id}`}
                        type="number"
                        min={0}
                        step="any"
                        inputMode="decimal"
                        placeholder="Not measured"
                        value={ing.oilDiscardedGrams ?? ""}
                        onChange={(e) => updateIngredient(ing.id, { oilDiscardedGrams: e.target.value === "" ? null : Number(e.target.value) })}
                      />
                      <p className="hint">Weigh what's left in the pan or drained. If you skip this, all the oil counts as eaten.</p>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>

          <label htmlFor="method">Method</label>
          <textarea id="method" rows={5} value={draft.method} placeholder="Steps, in your own words" onChange={(e) => update({ method: e.target.value })} />

          {errors.length > 0 && (
            <ul className="error" role="alert">
              {errors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          )}
          {loaded && (
            <div className="actions">
              <button type="button" className="btn-link danger" onClick={() => void remove()}>
                Delete recipe
              </button>
            </div>
          )}
          {message && (
            <p className="hint" role="status" data-testid="save-message">
              {message}
            </p>
          )}
        </section>
        <aside className="editor-side" id="nutrition">
          <NutritionPanel nutrition={nutrition} nutrients={nutrients} foods={foods} ingredients={draft.ingredients} catalogVersion={catalog.bundle.version} />
        </aside>
      </div>
      <div className={`action-bar${dirty || !loaded ? " single" : ""}`} data-testid="recipe-actions">
        {dirty || !loaded ? (
          <>
            <span className="hint" style={{ margin: 0 }}>{dirty ? "Unsaved changes" : "New recipe"}</span>
            <button type="button" className="btn-primary" onClick={() => void save()} disabled={!dirty && loaded !== null}>
              Save recipe
            </button>
          </>
        ) : (
          <>
            <button type="button" className="btn-secondary" onClick={() => setSheet("plan")}>
              Plan
            </button>
            <button type="button" className="btn-secondary" onClick={() => setSheet("log")}>
              I ate this
            </button>
            <a className="btn-primary" href={`#/cook/${id}`}>
              Cook
            </a>
          </>
        )}
      </div>
      {sheet === "plan" && loaded && <PlanSheet recipeId={id} title={loaded.body.title} onClose={() => setSheet(null)} />}
      {sheet === "log" && loaded && <LogSheet recipeId={id} recipe={loaded.body} onClose={() => setSheet(null)} />}
      {picking && (
        <Sheet title="Add ingredient" onClose={() => setPicking(false)}>
          <FoodPicker foods={foods} online={online} onPick={addFood} />
        </Sheet>
      )}
    </div>
  );
}

function ConflictBanner({ id, local, onResolved }: { id: string; local: LocalRecipe; onResolved: () => void }) {
  const { engine } = useApp();
  const server = local.conflictServer;
  const choose = async (choice: "mine" | "cloud" | "both") => {
    const copyId = await engine!.resolveConflict(id, choice);
    onResolved();
    if (choice === "mine" && copyId) navigate(`/recipe/${copyId}`);
  };
  return (
    <div className="banner banner-warn" role="alert" data-testid="conflict-banner">
      <p>
        <strong>This recipe changed on another device.</strong>{" "}
        {server ? `The cloud copy is "${server.title}" (version ${server.version}).` : "It was deleted on another device."} Choose what to keep. Nothing is overwritten until you choose.
      </p>
      <div className="banner-actions">
        <button type="button" className="btn-secondary" onClick={() => void choose("mine")}>
          Keep this device's
        </button>
        <button type="button" className="btn-secondary" onClick={() => void choose("cloud")}>
          Keep cloud copy
        </button>
        <button type="button" className="btn-secondary" onClick={() => void choose("both")}>
          Keep both
        </button>
      </div>
    </div>
  );
}
