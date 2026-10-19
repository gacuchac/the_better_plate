import { useEffect, useMemo, useRef, useState } from "react";
import { fahrenheitToCelsius, SAFE_TEMPERATURE_SOURCE, safetyRuleFor, splitSteps, stepTimerSeconds, type SafetyRule } from "@betterplate/nutrition";
import type { LocalRecipe } from "../localdb.ts";
import { useApp } from "../store.tsx";
import { Icon } from "./icons.tsx";

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
        <div className="cook-muted">Timer</div>
        <div className="cook-clock" role="timer" aria-live="off">
          {clock(left)}
        </div>
        <div aria-live="polite" className="cook-muted">
          {left === 0 ? "Time's up" : ""}
        </div>
      </div>
      <div className="cook-timer-actions">
        {left !== seconds && (
          <button type="button" className="cook-ghost" onClick={() => { setRunning(false); setLeft(seconds); }}>
            Reset
          </button>
        )}
        <button type="button" className="cook-light" onClick={() => setRunning((r) => !r)} disabled={left === 0}>
          {running ? "Pause" : "Start"}
        </button>
      </div>
    </div>
  );
}

function SafetyCard({ rules }: { rules: { rule: SafetyRule; foods: string[] }[] }) {
  return (
    <section className="cook-card" aria-labelledby="safe-title" data-testid="safe-temperatures">
      <h2 id="safe-title">Safe minimum internal temperatures</h2>
      <ul>
        {rules.map(({ rule, foods }) => (
          <li key={rule.id}>
            <strong>
              {rule.fahrenheit !== null ? `${rule.fahrenheit}°F (${fahrenheitToCelsius(rule.fahrenheit)}°C)` : rule.label}
              {rule.restMinutes ? `, then rest ${rule.restMinutes} minutes` : ""}
            </strong>
            <span>{rule.fahrenheit !== null ? `${rule.label}. ` : ""}{rule.note ?? ""}</span>
            <span className="cook-muted">For: {foods.join("; ")}</span>
          </li>
        ))}
      </ul>
      <p className="cook-muted">
        Check with a food thermometer in the thickest part. Source:{" "}
        <a href={SAFE_TEMPERATURE_SOURCE.url} target="_blank" rel="noopener noreferrer">
          {SAFE_TEMPERATURE_SOURCE.title}
        </a>
        , FoodSafety.gov, last reviewed {SAFE_TEMPERATURE_SOURCE.lastReviewed} (copy retrieved {SAFE_TEMPERATURE_SOURCE.retrievedAt}).
      </p>
    </section>
  );
}

export function Cook({ id }: { id: string }) {
  const { engine, catalog } = useApp();
  const [recipe, setRecipe] = useState<LocalRecipe | null | undefined>(undefined);
  const [index, setIndex] = useState(0);
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
  if (recipe === undefined) return <div className="cook"><p>Loading…</p></div>;
  if (recipe === null) {
    return (
      <div className="cook">
        <p>This recipe isn't on this device.</p>
        <a className="cook-light" href="#/kitchen">Back to Kitchen</a>
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
          <Icon name="close" /> Exit
        </a>
        <div className="cook-muted">{index === 0 ? "Before you start" : `Step ${index} of ${total}`}</div>
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
          <h1 className="cook-step">{total ? `${total} ${total === 1 ? "step" : "steps"}, in your own words.` : "No steps yet."}</h1>
          {total === 0 && <p className="cook-muted">Add your method to the recipe, one step per line, and it will show here one step at a time.</p>}
          {rules.length > 0 ? (
            <SafetyCard rules={rules} />
          ) : (
            <p className="cook-muted">None of these ingredients is on the government's safe-temperature chart, so there's no temperature to check.</p>
          )}
          <p className="cook-muted">
            These steps are your own. Curated method guides with tested times and temperatures aren't available yet.
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
          Back
        </button>
        {index < total ? (
          <button type="button" className="cook-accent" onClick={() => setIndex((i) => i + 1)}>
            {index === 0 ? "Start cooking" : "Next step"}
          </button>
        ) : (
          <a className="cook-accent" href={exit}>
            Done
          </a>
        )}
      </div>
    </div>
  );
}
