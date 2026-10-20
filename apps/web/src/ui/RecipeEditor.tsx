import { useEffect, useMemo, useState } from "react";
import { RecipeBodySchema, type RecipeBody, type RecipeIngredientInput } from "@betterplate/contracts";
import { calculateRecipe, type FoodRecord } from "@betterplate/nutrition";
import type { LocalRecipe } from "../localdb.ts";
import { useApp } from "../store.tsx";
import { EmptyState, navigate, Sheet } from "./common.tsx";
import { FoodPicker } from "./FoodPicker.tsx";
import { Icon } from "./icons.tsx";
import { LogSheet, PlanSheet } from "./MealSheets.tsx";
import { NutritionPanel } from "./Nutrition.tsx";
import { ShareSheet } from "./Share.tsx";
import { describeRecipe, PhotoSheet, RecipePhoto } from "./Photos.tsx";
import { formatQty, useT, type MessageKey } from "../i18n.ts";

export const MACROS: { key: string; label: MessageKey }[] = [
  { key: "energy_kcal", label: "macro.kcal" },
  { key: "protein", label: "macro.protein" },
  { key: "carbohydrate", label: "macro.carbs" },
  { key: "fat_total", label: "macro.fat" },
];

const blank = (): RecipeBody => ({ title: "", description: "", servings: 2, ingredients: [], method: "" });

function unitValue(i: RecipeIngredientInput) {
  return i.unit === "portion" ? `p:${i.portionIndex ?? 0}` : i.unit;
}

export function RecipeEditor({ id }: { id: string }) {
  const { engine, catalog, online } = useApp();
  const t = useT();
  const [loaded, setLoaded] = useState<LocalRecipe | null | undefined>(undefined);
  const [draft, setDraft] = useState<RecipeBody>(blank);
  const [dirty, setDirty] = useState(false);
  const [picking, setPicking] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [sheet, setSheet] = useState<"plan" | "log" | "share" | "photo" | null>(null);

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

  if (!engine || catalog.status === "loading" || loaded === undefined) return <p className="hint pad">{t("common.loading")}</p>;
  if (catalog.status === "unavailable") return <EmptyState title={t("catalog.notOnDevice")}>{t("catalog.unavailable")}</EmptyState>;

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
      // Messages by field, so they read in the interface language.
      setErrors([...new Set(parsed.error.issues.map((i) => t(i.path[0] === "title" ? "editor.errTitle" : i.path[0] === "servings" ? "editor.errServings" : "editor.errOther")))]);
      return;
    }
    setErrors([]);
    await engine!.saveRecipe(id, parsed.data);
    setDirty(false);
    setMessage(online ? t("editor.savedSyncing") : t("editor.savedOffline"));
  }

  async function remove() {
    if (!confirm(t("editor.deleteConfirm"))) return;
    await engine!.deleteRecipe(id);
    navigate("/kitchen");
  }

  return (
    <div className="editor">
      {loaded?.state === "conflict" && <ConflictBanner id={id} local={loaded} onResolved={() => setDirty(false)} />}
      {loaded?.state === "rejected" && (
        <p className="banner banner-warn" role="alert">
          {t("editor.rejected", { reason: loaded.rejection ?? "" })}
        </p>
      )}
      <div className="editor-grid">
        <section className="editor-main" aria-label={t("editor.region")}>
          <label htmlFor="title" className="sr-only">
            {t("editor.name")}
          </label>
          <input id="title" className="title-input" value={draft.title} placeholder={t("editor.namePlaceholder")} onChange={(e) => update({ title: e.target.value })} />
          <label htmlFor="description" className="sr-only">
            {t("editor.description")}
          </label>
          <textarea
            id="description"
            className="description-input"
            rows={2}
            maxLength={500}
            value={draft.description ?? ""}
            placeholder={t("editor.descriptionPlaceholder")}
            onChange={(e) => update({ description: e.target.value })}
          />

          {draft.image ? (
            <div className="photo-block">
              <RecipePhoto image={draft.image} />
              <div className="photo-actions">
                <button type="button" className="btn-link" onClick={() => setSheet("photo")}>
                  {t("photo.change")}
                </button>
                <button type="button" className="btn-link danger" onClick={() => update({ image: null })}>
                  {t("photo.remove")}
                </button>
              </div>
            </div>
          ) : (
            <button type="button" className="btn-soft photo-add" onClick={() => setSheet("photo")}>
              <Icon name="image" size={18} /> {t("photo.add")}
            </button>
          )}

          <div className="stepper-row">
            <label htmlFor="servings">{t("editor.servings")}</label>
            <div className="stepper">
              <button type="button" aria-label={t("editor.fewer")} onClick={() => update({ servings: Math.max(1, Math.ceil(draft.servings) - 1) })}>
                −
              </button>
              <input id="servings" type="number" min={0.25} step={0.25} inputMode="decimal" value={draft.servings} onChange={(e) => update({ servings: Number(e.target.value) })} />
              <button type="button" aria-label={t("editor.more")} onClick={() => update({ servings: Math.floor(draft.servings) + 1 })}>
                +
              </button>
            </div>
          </div>

          {draft.ingredients.length > 0 && (
            <a className="card summary-card" href="#nutrition" onClick={(e) => { e.preventDefault(); document.getElementById("nutrition")?.scrollIntoView({ behavior: "smooth" }); }} data-testid="nutrition-summary">
              <span className="card-head" style={{ marginBottom: 0 }}>
                <span className="hint" style={{ margin: 0 }}>
                  {t("nutrition.perServing")} · <span className="estimated">{t("common.estimated")}</span>
                </span>
                <span style={{ fontSize: "0.8125rem", fontWeight: 650, color: "var(--sage-ink)" }}>{t("editor.detailsSources")}</span>
              </span>
              <span className="macro-grid">
                {MACROS.map((m) => {
                  const total = nutrition.perServing.find((x) => x.key === m.key);
                  const v = !total || total.amount === null ? "–" : total.unit === "kcal" ? Math.round(total.amount).toString() : formatQty(total.amount, total.unit);
                  return (
                    <span key={m.key}>
                      <span className="macro-value" style={{ display: "block" }}>{total?.status === "partial" ? `≥ ${v}` : v}</span>
                      <span className="macro-label">{t(m.label)}</span>
                    </span>
                  );
                })}
              </span>
            </a>
          )}

          <div className="section-head">
            <h2>{t("editor.ingredients")}</h2>
            <button type="button" className="btn-soft" onClick={() => setPicking(true)}>
              <Icon name="plus" size={18} /> {t("editor.addIngredient")}
            </button>
          </div>
          {draft.ingredients.length === 0 && <p className="hint">{t("editor.addHint")}</p>}
          <ul className="ingredients">
            {draft.ingredients.map((ing) => {
              const food = foods.get(ing.foodId);
              return (
                <li key={ing.id} className="ingredient" data-testid="ingredient-row">
                  <div className="ingredient-name">{food?.description ?? t("editor.foodMissing", { id: ing.foodId })}</div>
                  <div className="ingredient-controls">
                    <label className="sr-only" htmlFor={`q-${ing.id}`}>
                      {t("editor.amount")}
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
                      {t("editor.unit")}
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
                    <button type="button" className="icon-btn" aria-label={t("editor.remove", { name: food?.description ?? t("editor.anIngredient") })} onClick={() => update({ ingredients: draft.ingredients.filter((i) => i.id !== ing.id) })}>
                      <Icon name="close" />
                    </button>
                  </div>
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={ing.role === "cooking_oil"}
                      onChange={(e) => updateIngredient(ing.id, { role: e.target.checked ? "cooking_oil" : "ingredient", oilDiscardedGrams: null })}
                    />
                    {t("editor.cookingOil")}
                  </label>
                  {ing.role === "cooking_oil" && (
                    <div className="oil">
                      <label htmlFor={`d-${ing.id}`}>{t("editor.oilDiscarded")}</label>
                      <input
                        id={`d-${ing.id}`}
                        type="number"
                        min={0}
                        step="any"
                        inputMode="decimal"
                        placeholder={t("editor.notMeasured")}
                        value={ing.oilDiscardedGrams ?? ""}
                        onChange={(e) => updateIngredient(ing.id, { oilDiscardedGrams: e.target.value === "" ? null : Number(e.target.value) })}
                      />
                      <p className="hint">{t("editor.oilHint")}</p>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>

          <label htmlFor="method">{t("editor.method")}</label>
          <textarea id="method" rows={5} value={draft.method} placeholder={t("editor.methodPlaceholder")} onChange={(e) => update({ method: e.target.value })} />

          {errors.length > 0 && (
            <ul className="error" role="alert">
              {errors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          )}
          {loaded && (
            <div className="actions">
              <button type="button" className="btn-soft" onClick={() => setSheet("share")} disabled={dirty}>
                <Icon name="share" size={18} /> {t("share.title")}
              </button>
              <button type="button" className="btn-link danger" onClick={() => void remove()}>
                {t("editor.delete")}
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
            <span className="hint" style={{ margin: 0 }}>{dirty ? t("editor.unsaved") : t("kitchen.newRecipe")}</span>
            <button type="button" className="btn-primary" onClick={() => void save()} disabled={!dirty && loaded !== null}>
              {t("editor.save")}
            </button>
          </>
        ) : (
          <>
            <button type="button" className="btn-secondary" onClick={() => setSheet("plan")}>
              {t("editor.plan")}
            </button>
            <button type="button" className="btn-secondary" onClick={() => setSheet("log")}>
              {t("meals.iAteThis")}
            </button>
            <a className="btn-primary" href={`#/cook/${id}`}>
              {t("editor.cook")}
            </a>
          </>
        )}
      </div>
      {sheet === "photo" && (
        <PhotoSheet
          initial={describeRecipe(draft, foods)}
          title={draft.title.trim()}
          onClose={() => setSheet(null)}
          onPick={(image) => {
            update({ image });
            setSheet(null);
          }}
        />
      )}
      {sheet === "plan" && loaded && <PlanSheet recipeId={id} title={loaded.body.title} onClose={() => setSheet(null)} />}
      {sheet === "share" && loaded && <ShareSheet recipe={loaded} onClose={() => setSheet(null)} />}
      {sheet === "log" && loaded && <LogSheet recipeId={id} recipe={loaded.body} onClose={() => setSheet(null)} />}
      {picking && (
        <Sheet title={t("editor.addIngredient")} onClose={() => setPicking(false)}>
          <FoodPicker foods={foods} online={online} onPick={addFood} />
        </Sheet>
      )}
    </div>
  );
}

function ConflictBanner({ id, local, onResolved }: { id: string; local: LocalRecipe; onResolved: () => void }) {
  const { engine } = useApp();
  const t = useT();
  const server = local.conflictServer;
  const choose = async (choice: "mine" | "cloud" | "both") => {
    const copyId = await engine!.resolveConflict(id, choice);
    onResolved();
    if (choice === "mine" && copyId) navigate(`/recipe/${copyId}`);
  };
  return (
    <div className="banner banner-warn" role="alert" data-testid="conflict-banner">
      <p>
        <strong>{t("conflict.title")}</strong> {server ? t("conflict.cloudCopy", { title: server.title, version: server.version }) : t("conflict.deleted")}{" "}
        {t("conflict.choose")}
      </p>
      <div className="banner-actions">
        <button type="button" className="btn-secondary" onClick={() => void choose("mine")}>
          {t("conflict.keepMine")}
        </button>
        <button type="button" className="btn-secondary" onClick={() => void choose("cloud")}>
          {t("conflict.keepCloud")}
        </button>
        <button type="button" className="btn-secondary" onClick={() => void choose("both")}>
          {t("conflict.keepBoth")}
        </button>
      </div>
    </div>
  );
}
