import { useMemo } from "react";
import { calculateRecipe, scaleTotals } from "@betterplate/nutrition";
import { imageUrl } from "../api.ts";
import { eatenAtFor, formatDay, localDate, logEaten, slotLabel } from "../meals.ts";
import { formatQty, useT } from "../i18n.ts";
import { amountOver, energyMark, todayTrail, type TrailItem } from "../today.ts";
import { useApp } from "../store.tsx";
import { useGentle } from "../gentle.ts";
import type { LocalRecipe } from "../localdb.ts";
import { Meter } from "./Meter.tsx";
import { Icon } from "./icons.tsx";

function Thumb({ recipe, title }: { recipe: LocalRecipe | undefined; title: string }) {
  return recipe?.body.image ? (
    <img className="trail-photo" src={imageUrl(recipe.body.image.id)} alt="" loading="lazy" crossOrigin="use-credentials" />
  ) : (
    <span className="trail-photo monogram" aria-hidden="true">
      {title.trim().charAt(0).toUpperCase() || "?"}
    </span>
  );
}

function RecipeTile({ recipe }: { recipe: LocalRecipe }) {
  return (
    <li>
      <a className="tile" href={`#/recipe/${recipe.id}`}>
        <Thumb recipe={recipe} title={recipe.body.title} />
        <span className="tile-title">{recipe.body.title}</span>
      </a>
    </li>
  );
}

/** Today on Your Kitchen: a small "Let's cook something" row, then the day's trail. */
export function Today() {
  const { recipes, plans, logs, goals, engine, catalog } = useApp();
  const t = useT();
  const today = localDate();
  const trail = useMemo(() => todayTrail(today, plans, logs), [today, plans, logs]);
  const foods = catalog.status === "ready" ? catalog.foods : null;
  const defs = catalog.status === "ready" ? catalog.bundle.nutrients : null;
  const count = (n: number) => t("kitchen.meals", { n });
  const plannedCount = plans.filter((p) => !p.deleted && p.body.date === today).length;
  const eatenCount = logs.filter((l) => !l.deleted && l.body.localDate === today).length;

  // kcal: eaten counts only logged meals that report it; plans are shown apart and never added in.
  const eatenKcal = useMemo(() => {
    if (!foods || !defs) return null;
    let sum: number | null = null;
    for (const item of trail.items) {
      if (item.kind !== "eaten") continue;
      const e = logEaten(item.log, foods, defs).find((x) => x.key === "energy_kcal");
      if (e && e.amount !== null) sum = (sum ?? 0) + e.amount;
    }
    return sum;
  }, [trail, foods, defs]);
  const plannedKcal = (plan: Extract<TrailItem, { kind: "planned" }>["plan"]): number | null => {
    const recipe = recipes.find((r) => r.id === plan.body.recipeId);
    if (!recipe || !foods || !defs) return null;
    const per = calculateRecipe(recipe.body, foods, defs).perServing;
    return scaleTotals(per, plan.body.servings).find((x) => x.key === "energy_kcal")?.amount ?? null;
  };
  const gentle = useGentle();
  const mark = gentle ? null : energyMark(goals, today);
  const over = amountOver(eatenKcal, mark?.ceiling ?? null);
  const recipeFor = (id: string | null | undefined) => recipes.find((r) => r.id === id);
  const chips = recipes.slice(0, 3);
  const hasTrail = trail.items.length > 0;

  async function eat(plan: Extract<TrailItem, { kind: "planned" }>["plan"]) {
    const recipe = recipeFor(plan.body.recipeId);
    if (!engine || !recipe) return;
    await engine.logMeal({
      plannedMealId: plan.id,
      recipeId: recipe.id,
      recipe: { title: recipe.body.title, servings: recipe.body.servings, ingredients: recipe.body.ingredients },
      servings: plan.body.servings,
      slot: plan.body.slot,
      localDate: today,
      eatenAt: eatenAtFor(today),
      profileId: plan.body.profileId ?? null,
    });
  }

  return (
    <section className="today" aria-label={t("day.today")}>
      {hasTrail ? (
        <>
          <a className="cook-row" href="#/create" data-testid="cook-row">
            <span>{t("today.cookTitle")}</span>
            <Icon name="forward" size={18} />
            <span className="chip-row">
              {chips.map((r) => (
                <span key={r.id} className="mini-chip">
                  {r.body.title}
                </span>
              ))}
            </span>
          </a>
          <a className="card today-card" href="#/meals" data-testid="today-card">
            <div className="card-head" style={{ marginBottom: 0 }}>
              <h2>{t("today.trail")}</h2>
              <span className="hint" style={{ margin: 0 }}>
                {formatDay(today, { weekday: "short", day: "numeric", month: "short" })}
              </span>
            </div>
            <div className="today-stats">
              <div>
                <div className="stat-label">{t("meals.planned")}</div>
                <div className="stat-value">{count(plannedCount)}</div>
              </div>
              <div>
                <div className="stat-label">{t("meals.eaten")}</div>
                <div className="stat-value">{count(eatenCount)}</div>
              </div>
            </div>
            {eatenKcal !== null && (
              <div className="today-kcal">
                <div className="stat-label">
                  {t("today.kcalEaten", { amount: formatQty(eatenKcal, "kcal") })} · <span className="estimated">{t("common.estimated")}</span>
                </div>
                {mark && <Meter amount={eatenKcal} goal={mark.mark} />}
                {over !== null && <p className="calm">{t("today.over", { amount: over })}</p>}
              </div>
            )}
          </a>
          <ol className="trail" aria-label={t("today.trail")}>
            {trail.items.map((item) => {
              const isEaten = item.kind === "eaten";
              const body = isEaten ? item.log.body : item.plan.body;
              const title = isEaten ? item.log.body.recipe.title : item.plan.body.title;
              const recipe = recipeFor(isEaten ? item.log.body.recipeId : item.plan.body.recipeId);
              const kcal = isEaten ? (foods && defs ? (logEaten(item.log, foods, defs).find((x) => x.key === "energy_kcal")?.amount ?? null) : null) : plannedKcal(item.plan);
              return (
                <li key={isEaten ? item.log.id : item.plan.id} className={`trail-item ${isEaten ? "is-eaten" : "is-planned"}`} data-testid="trail-item">
                  <span className="pin" aria-hidden="true">
                    {isEaten && <Icon name="check" size={14} />}
                  </span>
                  <Thumb recipe={recipe} title={title} />
                  <span className="trail-body">
                    <span className="trail-title">{title}</span>
                    <span className="trail-meta">
                      {slotLabel(body.slot)} · {isEaten ? t("meals.eaten") : t("meals.planned")}
                      {kcal !== null ? ` · ${formatQty(kcal, "kcal")}` : ""}
                    </span>
                  </span>
                  {isEaten ? (
                    <button type="button" className="btn-soft trail-btn" aria-label={t("today.undoLabel", { title })} onClick={() => void engine?.deleteLog(item.log.id)}>
                      {t("today.undo")}
                    </button>
                  ) : (
                    <button type="button" className="btn-soft trail-btn" aria-label={t("today.eatLabel", { title })} disabled={!recipe} onClick={() => void eat(item.plan)}>
                      {t("today.eat")}
                    </button>
                  )}
                </li>
              );
            })}
          </ol>
        </>
      ) : (
        <>
          <h2 className="cook-head">{t("today.cookTitle")}</h2>
          {recipes.length > 0 && (
            <ul className="tile-grid">
              {recipes.slice(0, 4).map((r) => (
                <RecipeTile key={r.id} recipe={r} />
              ))}
            </ul>
          )}
          <a className="card today-card empty-trail" href="#/meals" data-testid="today-card">
            <h3>{t("today.nothingPlanned")}</h3>
            <span className="btn-soft">
              <Icon name="plus" size={18} /> {t("meals.planMeal")}
            </span>
          </a>
        </>
      )}
      {trail.waiting > 0 && (
        <p className="hint" data-testid="waiting-note">
          {t("today.waiting", { n: trail.waiting })}
        </p>
      )}
    </section>
  );
}
