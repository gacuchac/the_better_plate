import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { fahrenheitToCelsius, SAFE_TEMPERATURE_SOURCE, safetyRuleFor, splitSteps, stepTimerSeconds, type SafetyRule } from "@betterplate/nutrition";
import type { LocalRecipe } from "../localdb.ts";
import { useApp } from "../store.tsx";
import { Icon } from "./icons.tsx";
import { tOr, useT } from "../i18n.ts";

const ruleLabel = (rule: SafetyRule) => tOr(`safety.${rule.id}.label`, rule.label);
const ruleNote = (rule: SafetyRule) => (rule.note === null ? "" : tOr(`safety.${rule.id}.note`, rule.note));

const clock = (s: number) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

/** Keeps the screen awake while cooking, where the browser allows it. */
function useWakeLock() {
  useEffect(() => {
    let lock: { release: () => Promise<void> } | null = null;
    const nav = navigator as Navigator & { wakeLock?: { request: (t: "screen") => Promise<{ release: () => Promise<void> }> } };
    nav.wakeLock?.request("screen").then((l) => (lock = l), () => {});
    return () => void lock?.release().catch(() => {});
  }, []);
}

function Timer({ seconds }: { seconds: number }) {
  const [left, setLeft] = useState(seconds);
  const [running, setRunning] = useState(false);
  const t = useT();
  const tick = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    setLeft(seconds);
    setRunning(false);
  }, [seconds]);
  useEffect(() => {
    if (!running) return;
    tick.current = setInterval(() => setLeft((l) => (l > 0 ? l - 1 : 0)), 1000);
    return () => clearInterval(tick.current!);
  }, [running]);
  useEffect(() => {
    if (left === 0 && running) {
      setRunning(false);
      navigator.vibrate?.([200, 100, 200]);
    }
  }, [left, running]);
  return (
    <div className="cook-timer" data-testid="cook-timer">
      <div>
        <div className="cook-muted">{t("cook.timer")}</div>
        <div className="cook-clock" role="timer" aria-live="off">
          {clock(left)}
        </div>
        <div aria-live="polite" className="cook-muted">
          {left === 0 ? t("cook.timesUp") : ""}
        </div>
      </div>
      <div className="cook-timer-actions">
        {left !== seconds && (
          <button type="button" className="cook-ghost" onClick={() => { setRunning(false); setLeft(seconds); }}>
            {t("cook.reset")}
          </button>
        )}
        <button type="button" className="cook-light" onClick={() => setRunning((r) => !r)} disabled={left === 0}>
          {running ? t("cook.pause") : t("cook.start")}
        </button>
      </div>
    </div>
  );
}

function SafetyCard({ rules }: { rules: { rule: SafetyRule; foods: string[] }[] }) {
  const t = useT();
  return (
    <section className="cook-card" aria-labelledby="safe-title" data-testid="safe-temperatures">
      <h2 id="safe-title">{t("cook.safeTitle")}</h2>
      <ul>
        {rules.map(({ rule, foods }) => (
          <li key={rule.id}>
            <strong>
              {rule.fahrenheit !== null ? `${rule.fahrenheit}°F (${fahrenheitToCelsius(rule.fahrenheit)}°C)` : ruleLabel(rule)}
              {rule.restMinutes ? `, ${t("cook.rest", { n: rule.restMinutes })}` : ""}
            </strong>
            <span>{rule.fahrenheit !== null ? `${ruleLabel(rule)}. ` : ""}{ruleNote(rule)}</span>
            <span className="cook-muted">{t("cook.for", { foods: foods.join("; ") })}</span>
          </li>
        ))}
      </ul>
      <p className="cook-muted">
        {t("cook.thermometer")}{" "}
        <a href={SAFE_TEMPERATURE_SOURCE.url} target="_blank" rel="noopener noreferrer" lang="en">
          {SAFE_TEMPERATURE_SOURCE.title}
        </a>
        {t("cook.sourceAfter", { reviewed: SAFE_TEMPERATURE_SOURCE.lastReviewed, retrieved: SAFE_TEMPERATURE_SOURCE.retrievedAt })}
      </p>
    </section>
  );
}

export function Cook({ id, report }: { id: string; report?: ReactNode }) {
  const { engine, catalog } = useApp();
  const [recipe, setRecipe] = useState<LocalRecipe | null | undefined>(undefined);
  const [index, setIndex] = useState(0);
  const t = useT();
  useWakeLock();

  useEffect(() => {
    if (!engine) return;
    void engine.getRecipe(id).then((r) => setRecipe(r ?? null));
  }, [engine, id]);

  const steps = useMemo(() => splitSteps(recipe?.body.method ?? ""), [recipe]);
  const rules = useMemo(() => {
    if (!recipe || catalog.status !== "ready") return [];
    const byRule = new Map<string, { rule: SafetyRule; foods: string[] }>();
    for (const ing of recipe.body.ingredients) {
      const food = catalog.foods.get(ing.foodId);
      const rule = food && safetyRuleFor(food);
      if (!food || !rule) continue;
      const entry = byRule.get(rule.id) ?? { rule, foods: [] };
      if (!entry.foods.includes(food.description)) entry.foods.push(food.description);
      byRule.set(rule.id, entry);
    }
    return [...byRule.values()];
  }, [recipe, catalog]);

  const exit = `#/recipe/${id}`;
  if (recipe === undefined) return <div className="cook"><p>{t("common.loading")}</p></div>;
  if (recipe === null) {
    return (
      <div className="cook">
        <p>{t("cook.notHere")}</p>
        <a className="cook-light" href="#/kitchen">{t("nav.backToKitchen")}</a>
      </div>
    );
  }

  // Page 0 is "Before you start"; then one page per step.
  const total = steps.length;
  const step = index === 0 ? null : steps[index - 1]!;
  const timer = step ? stepTimerSeconds(step) : null;

  return (
    <div className="cook" data-testid="cook-mode">
      <div className="cook-top">
        <a className="cook-exit" href={exit}>
          <Icon name="close" /> {t("cook.exit")}
        </a>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div className="cook-muted">{index === 0 ? t("consent.beforeStart") : t("cook.stepOf", { index, total })}</div>
          {report}
        </div>
      </div>
      {total > 0 && (
        <div className="cook-progress" aria-hidden="true">
          {steps.map((_, i) => (
            <span key={i} className={i < index ? "done" : ""} />
          ))}
        </div>
      )}

      {index === 0 ? (
        <>
          <div className="cook-eyebrow">{recipe.body.title}</div>
          <h1 className="cook-step">{total ? t("cook.steps", { n: total }) : t("cook.noSteps")}</h1>
          {total === 0 && <p className="cook-muted">{t("cook.addMethod")}</p>}
          {rules.length > 0 ? (
            <SafetyCard rules={rules} />
          ) : (
            <p className="cook-muted">{t("cook.noChart")}</p>
          )}
          <p className="cook-muted">
            {t("cook.ownSteps")}
          </p>
        </>
      ) : (
        <>
          <div className="cook-eyebrow">{recipe.body.title}</div>
          <p className="cook-step" data-testid="cook-step">{step}</p>
          {timer !== null && <Timer key={index} seconds={timer} />}
          {rules.length > 0 && index === total && <SafetyCard rules={rules} />}
        </>
      )}

      <div className="cook-nav">
        <button type="button" className="cook-ghost" disabled={index === 0} onClick={() => setIndex((i) => i - 1)}>
          {t("common.back")}
        </button>
        {index < total ? (
          <button type="button" className="cook-accent" onClick={() => setIndex((i) => i + 1)}>
            {index === 0 ? t("cook.startCooking") : t("cook.next")}
          </button>
        ) : (
          <a className="cook-accent" href={exit}>
            {t("common.done")}
          </a>
        )}
      </div>
    </div>
  );
}
