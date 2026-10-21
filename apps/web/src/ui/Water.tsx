import { useMemo, useState } from "react";
import { WATER_KEY, WATER_UNIT, waterDays } from "@betterplate/nutrition";
import { useApp } from "../store.tsx";
import { goalSentence, intakeByDay, isActive } from "../goals.ts";
import { localDate } from "../meals.ts";
import { dateLocale, formatWater, useT } from "../i18n.ts";

/** One glass, the default for the quick button. */
export const GLASS_ML = 250;
const MAX_DRINK_ML = 5000;

/**
 * Water today: drinks the person logs plus water inside the foods of meals marked as eaten (an
 * estimate from USDA data). Each tap is its own record, saved on the device first and synced later.
 */
export function WaterToday() {
  const { water, logs, catalog, goals, engine } = useApp();
  const t = useT();
  const today = localDate();
  const [other, setOther] = useState("");
  const [tried, setTried] = useState(false);

  const todayLogs = useMemo(() => logs.filter((l) => l.body.localDate === today), [logs, today]);
  const food = useMemo(() => {
    if (catalog.status !== "ready" || !todayLogs.length) return null;
    return waterDays(intakeByDay(todayLogs, catalog.foods, catalog.bundle.nutrients), [])[0] ?? null;
  }, [todayLogs, catalog]);
  const drinks = water.filter((w) => w.body.localDate === today).sort((a, b) => a.body.drankAt.localeCompare(b.body.drankAt));
  const drinksMl = drinks.reduce((sum, w) => sum + w.body.amountMl, 0);
  const foodMl = food?.foodMl ?? null;
  const total = drinksMl + (foodMl ?? 0);
  const goal = goals.find((g) => !g.deleted && g.body.nutrientKey === WATER_KEY && g.body.unit === WATER_UNIT && g.body.period === "day" && isActive(g.body, today));
  const target = goal ? (goal.body.min ?? goal.body.max) : null;
  const otherMl = Number(other);
  const otherValid = Number.isInteger(otherMl) && otherMl >= 1 && otherMl <= MAX_DRINK_ML;

  async function add(amountMl: number) {
    if (!engine) return;
    await engine.logWater({ amountMl, localDate: today, drankAt: new Date().toISOString() });
  }

  async function addOther() {
    setTried(true);
    if (!otherValid) return;
    await add(otherMl);
    setOther("");
    setTried(false);
  }

  const time = (iso: string) => new Date(iso).toLocaleTimeString(dateLocale(), { hour: "numeric", minute: "2-digit" });

  return (
    <section className="card" aria-labelledby="water-title" data-testid="water-today" style={{ marginTop: 16 }}>
      <div className="card-head">
        <h2 id="water-title">{t("water.title")}</h2>
      </div>
      <p className="water-total" data-testid="water-total">
        <strong>{formatWater(total)}</strong>
        {goal && ` · ${goalSentence(goal.body)}`}
      </p>
      <p className="hint" data-testid="water-split">
        {foodMl === null ? t("water.splitNoFood", { drinks: formatWater(drinksMl) }) : t("water.split", { drinks: formatWater(drinksMl), food: formatWater(foodMl) })}
        {food?.foodPartial && foodMl !== null && ` ${t("water.foodPartial")}`}
      </p>
      {target !== null && (
        <div className="goal-bar-track water-track" aria-hidden="true">
          <span className="goal-bar-fill" style={{ width: `${Math.min(100, (total / target) * 100)}%` }} />
        </div>
      )}
      <div className="stack water-actions">
        <button type="button" className="btn-primary" onClick={() => void add(GLASS_ML)} data-testid="water-glass">
          {t("water.addGlass", { amount: formatWater(GLASS_ML) })}
        </button>
        <span className="water-other">
          <label htmlFor="water-other">{t("water.other")}</label>
          <span className="target-input">
            <input id="water-other" type="number" min={1} max={MAX_DRINK_ML} step={1} inputMode="numeric" value={other} onChange={(e) => setOther(e.target.value)} />
            <span className="target-unit">ml</span>
          </span>
          <button type="button" className="btn-secondary" onClick={() => void addOther()}>
            {t("water.add")}
          </button>
        </span>
      </div>
      {tried && !otherValid && (
        <p className="error" role="alert">
          {t("water.badAmount", { max: formatWater(MAX_DRINK_ML) })}
        </p>
      )}
      {drinks.length > 0 && (
        <ul className="water-list" aria-label={t("water.listLabel")}>
          {drinks.map((w) => (
            <li key={w.id} data-testid="water-drink">
              <span>
                {time(w.body.drankAt)} · {formatWater(w.body.amountMl)}
                {w.state === "pending" && ` · ${t("sync.savedLocal")}`}
                {w.state === "rejected" && ` · ${t("water.rejected", { reason: w.rejection ?? "" })}`}
              </span>
              <button type="button" className="btn-link" onClick={() => void engine?.deleteWater(w.id)} aria-label={t("water.removeNamed", { amount: formatWater(w.body.amountMl), time: time(w.body.drankAt) })}>
                {t("water.remove")}
              </button>
            </li>
          ))}
        </ul>
      )}
      {!goal && (
        <p className="hint">
          <a href="#/goals">{t("water.setGoal")}</a>
        </p>
      )}
      <p className="fine">{t("water.fine")}</p>
    </section>
  );
}
