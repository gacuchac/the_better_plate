import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  cookSteps,
  fahrenheitToCelsius,
  SAFE_TEMPERATURE_SOURCE,
  safetyRuleFor,
  stepSafetyRules,
  stepsFingerprint,
  stepTimerSeconds,
  type SafetyRule,
  type Technique,
} from "@betterplate/nutrition";
import type { LocalRecipe } from "../localdb.ts";
import { useApp } from "../store.tsx";
import { Icon } from "./icons.tsx";
import { tOr, useT } from "../i18n.ts";

const ruleLabel = (rule: SafetyRule) => tOr(`safety.${rule.id}.label`, rule.label);
const ruleNote = (rule: SafetyRule) => (rule.note === null ? "" : tOr(`safety.${rule.id}.note`, rule.note));
const techniqueLabel = (tech: Technique) => tOr(`technique.${tech.id}.label`, tech.label);
const techniqueWhat = (tech: Technique) => tOr(`technique.${tech.id}.what`, tech.what);
const ruleTemp = (rule: SafetyRule) =>
  rule.fahrenheit !== null ? `${rule.fahrenheit}°F (${fahrenheitToCelsius(rule.fahrenheit)}°C)` : ruleNote(rule);

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

/**
 * Ticked steps, kept on this device per account and recipe (like the shopping list's ticks).
 * They reset when the method's steps change, after a day without a tick, or on Start over / Finish.
 */
const STALE_MS = 24 * 60 * 60 * 1000;
const progressKey = (account: string, recipeId: string) => `bp.cook.${account}.${recipeId}`;

function readProgress(key: string, fingerprint: string): Set<number> {
  try {
    const saved = JSON.parse(localStorage.getItem(key) ?? "null") as { fp: string; done: number[]; at: number } | null;
    if (!saved || saved.fp !== fingerprint || Date.now() - saved.at > STALE_MS) return new Set();
    return new Set(saved.done);
  } catch {
    return new Set();
  }
}

function writeProgress(key: string, fingerprint: string, done: Set<number>) {
  try {
    if (done.size === 0) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify({ fp: fingerprint, done: [...done].sort((a, b) => a - b), at: Date.now() }));
  } catch {
    // Ticks last for this visit only.
  }
}

function Techniques({ techniques }: { techniques: Technique[] }) {
  const t = useT();
  if (!techniques.length) return null;
  return (
    <div className="cook-techniques" data-testid="cook-technique">
      <div className="cook-muted">{t("cook.technique")}</div>
      <ul>
        {techniques.map((tech) => (
          <li key={tech.id}>
            <strong>{techniqueLabel(tech)}</strong>
            <span>{techniqueWhat(tech)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function Cook({ id, report }: { id: string; report?: ReactNode }) {
  const { engine, catalog, account } = useApp();
  const [recipe, setRecipe] = useState<LocalRecipe | null | undefined>(undefined);
  const t = useT();
  useWakeLock();

  useEffect(() => {
    if (!engine) return;
    void engine.getRecipe(id).then((r) => setRecipe(r ?? null));
  }, [engine, id]);

  const { intro, steps } = useMemo(() => cookSteps(recipe?.body.method ?? ""), [recipe]);
  const fingerprint = useMemo(() => stepsFingerprint(steps), [steps]);
  const key = progressKey(account?.id ?? "signed-out", id);
  const [done, setDone] = useState<Set<number>>(() => new Set());
  useEffect(() => {
    if (recipe) setDone(readProgress(key, fingerprint));
  }, [key, fingerprint, recipe]);

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

  const total = steps.length;
  const update = (next: Set<number>) => {
    setDone(next);
    writeProgress(key, fingerprint, next);
  };
  const toggle = (i: number) => {
    const next = new Set(done);
    if (next.has(i)) next.delete(i);
    else next.add(i);
    update(next);
  };
  const current = steps.findIndex((_, i) => !done.has(i));
  const step = current >= 0 ? steps[current]! : null;
  const timer = step ? stepTimerSeconds(step.text) : null;
  const reminders = step ? stepSafetyRules(step, rules.map((r) => r.rule)) : [];

  return (
    <div className="cook" data-testid="cook-mode">
      <div className="cook-top">
        <a className="cook-exit" href={exit}>
          <Icon name="close" /> {t("cook.exit")}
        </a>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {total > 0 && <div className="cook-muted" data-testid="cook-count">{t("cook.doneOf", { done: done.size, total })}</div>}
          {report}
        </div>
      </div>
      {total > 0 && (
        <div className="cook-progress" aria-hidden="true">
          {steps.map((_, i) => (
            <span key={i} className={done.has(i) ? "done" : ""} />
          ))}
        </div>
      )}

      <div>
        <div className="cook-eyebrow">{recipe.body.title}</div>
        {total > 0 && <div className="cook-muted">{t("cook.steps", { n: total })}</div>}
      </div>
      {intro.length > 0 && <p className="cook-muted cook-intro">{intro.join(" ")}</p>}

      {total === 0 ? (
        <>
          <h1 className="cook-step">{t("cook.noSteps")}</h1>
          <p className="cook-muted">{t("cook.addMethod")}</p>
        </>
      ) : step ? (
        <section className="cook-next" aria-labelledby="cook-next-title" data-testid="cook-next">
          <h1 id="cook-next-title" className="cook-next-head">
            {t("cook.stepOf", { index: current + 1, total })}
            {step.label ? ` · ${step.label}` : ""}
          </h1>
          <p className="cook-step" data-testid="cook-step">{step.text}</p>
          <Techniques techniques={step.techniques} />
          {reminders.length > 0 && (
            <div className="cook-reminder" data-testid="cook-step-safety">
              <strong>{t("cook.checkTemp")}</strong>
              {reminders.map((rule) => (
                <span key={rule.id}>
                  {ruleTemp(rule)}
                  {rule.fahrenheit !== null ? ` · ${ruleLabel(rule)}` : ""}
                  {rule.restMinutes ? `, ${t("cook.rest", { n: rule.restMinutes })}` : ""}
                </span>
              ))}
            </div>
          )}
          {timer !== null && <Timer key={current} seconds={timer} />}
          <button type="button" className="cook-accent cook-wide" onClick={() => toggle(current)}>
            {t("cook.markDone")}
          </button>
        </section>
      ) : (
        <section className="cook-next" data-testid="cook-all-done">
          <h1 className="cook-step">{t("cook.allDone")}</h1>
          <div className="cook-nav">
            <button type="button" className="cook-ghost" onClick={() => update(new Set())}>
              {t("cook.startOver")}
            </button>
            <a className="cook-accent" href={exit} onClick={() => writeProgress(key, fingerprint, new Set())}>
              {t("cook.finish")}
            </a>
          </div>
        </section>
      )}

      {total > 0 && (
        <section aria-labelledby="cook-list-title">
          <h2 id="cook-list-title" className="cook-list-title">{t("cook.allSteps")}</h2>
          <ol className="cook-list" data-testid="cook-checklist">
            {steps.map((s, i) => (
              <li key={i} className={`${done.has(i) ? "done" : ""}${i === current ? " current" : ""}`} aria-current={i === current ? "step" : undefined}>
                <label>
                  <input type="checkbox" checked={done.has(i)} onChange={() => toggle(i)} />
                  <span className="cook-list-n" aria-hidden="true">{i + 1}</span>
                  <span className="cook-list-text">
                    {s.label && <strong>{s.label}: </strong>}
                    {s.text}
                    {s.techniques.length > 0 && (
                      <span className="cook-chips">
                        {s.techniques.map((tech) => (
                          <span key={tech.id} className="cook-chip">{techniqueLabel(tech)}</span>
                        ))}
                      </span>
                    )}
                  </span>
                </label>
              </li>
            ))}
          </ol>
          {done.size > 0 && step && (
            <button type="button" className="cook-ghost cook-wide" onClick={() => update(new Set())}>
              {t("cook.startOver")}
            </button>
          )}
        </section>
      )}

      {rules.length > 0 ? <SafetyCard rules={rules} /> : <p className="cook-muted">{t("cook.noChart")}</p>}
      <p className="cook-muted">
        {t("cook.ownSteps")} {t("cook.techniqueNote")} {t("cook.savedHere")}
      </p>
    </div>
  );
}
