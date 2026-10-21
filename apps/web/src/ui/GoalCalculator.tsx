import { useState } from "react";
import type { GoalBody } from "@betterplate/contracts";
import { ACTIVITY_LEVELS, AMDR, DRI_SOURCES, ESTIMATE_LIMITS, estimateGoals, estimateProblem, goalProblem, WATER_KEY } from "@betterplate/nutrition";
import type { ActivityLevel, Estimate, EstimateSex, GoalSuggestion, NutrientDefinition } from "@betterplate/nutrition";
import { useApp } from "../store.tsx";
import { isActive } from "../goals.ts";
import { localDate } from "../meals.ts";
import { formatNutrient, nutrientName, useT, type MessageKey } from "../i18n.ts";
import { Sheet } from "./common.tsx";

/**
 * "Help me calculate": asks for sex, age, height, weight and activity, suggests daily goals from
 * published Dietary Reference Intakes, and saves only the goals the person keeps. What is typed
 * here lives in this component's state: it is never saved, synced, logged or put in a report,
 * and is gone when the sheet closes. Adults only.
 */

const CM_PER_IN = 2.54;
const KG_PER_LB = 0.45359237;

const ACTIVITY_LABEL: Record<ActivityLevel, MessageKey> = {
  inactive: "calc.activity.inactive",
  low_active: "calc.activity.lowActive",
  active: "calc.activity.active",
  very_active: "calc.activity.veryActive",
};
const ACTIVITY_HELP: Record<ActivityLevel, MessageKey> = {
  inactive: "calc.activity.inactive.help",
  low_active: "calc.activity.lowActive.help",
  active: "calc.activity.active.help",
  very_active: "calc.activity.veryActive.help",
};
const BASIS: Record<GoalSuggestion["basis"], MessageKey> = {
  energy: "calc.basis.energy",
  protein: "calc.basis.protein",
  fat: "calc.basis.fat",
  carbohydrate: "calc.basis.carbohydrate",
  fiber: "calc.basis.fiber",
  water: "calc.basis.water",
};

interface Row {
  suggestion: GoalSuggestion;
  keep: boolean;
  min: string;
  max: string;
  /** The person already has a daily goal for this nutrient. */
  hasGoal: boolean;
}

/** Water is typed in ml, everything else in its own unit; stored water is grams. */
const num = (v: string) => (v.trim() === "" ? null : Number(v));

export function GoalCalculator({ defs, onClose }: { defs: NutrientDefinition[]; onClose: () => void }) {
  const { engine, goals } = useApp();
  const t = useT();
  const [metric, setMetric] = useState(true);
  const [sex, setSex] = useState<EstimateSex | "">("");
  const [age, setAge] = useState("");
  const [cm, setCm] = useState("");
  const [feet, setFeet] = useState("");
  const [inches, setInches] = useState("");
  const [kg, setKg] = useState("");
  const [lb, setLb] = useState("");
  const [activity, setActivity] = useState<ActivityLevel | "">("");
  const [tried, setTried] = useState(false);
  const [result, setResult] = useState<{ estimate: Estimate; rows: Row[] } | null>(null);
  const [saveTried, setSaveTried] = useState(false);

  const heightCm = metric ? Number(cm) : (Number(feet) * 12 + Number(inches || 0)) * CM_PER_IN;
  const weightKg = metric ? Number(kg) : Number(lb) * KG_PER_LB;
  const ageYears = Number(age);
  const blank = (v: string) => v.trim() === "";
  const problem: string | null =
    sex === "" || activity === ""
      ? "choose"
      : estimateProblem({ age: blank(age) ? NaN : ageYears, heightCm: blank(metric ? cm : feet) ? NaN : heightCm, weightKg: blank(metric ? kg : lb) ? NaN : weightKg });

  function estimate() {
    setTried(true);
    if (problem || sex === "" || activity === "") return;
    const est = estimateGoals({ sex, age: ageYears, heightCm, weightKg, activity });
    const rows = est.suggestions.map((s): Row => {
      const hasGoal = goals.some((g) => !g.deleted && g.body.period === "day" && g.body.nutrientKey === s.nutrientKey && isActive(g.body));
      return { suggestion: s, keep: !hasGoal, hasGoal, min: s.min === null ? "" : String(s.min), max: s.max === null ? "" : String(s.max) };
    });
    setResult({ estimate: est, rows });
    setSaveTried(false);
  }

  const update = (i: number, patch: Partial<Row>) => setResult((r) => (r ? { ...r, rows: r.rows.map((row, j) => (j === i ? { ...row, ...patch } : row)) } : r));

  function bodyFor(row: Row, today: string): GoalBody {
    const { suggestion: s } = row;
    return { nutrientKey: s.nutrientKey, unit: s.unit, kind: s.kind, min: num(row.min), max: s.kind === "at_least" ? null : num(row.max), period: "day", startDate: today, endDate: null };
  }
  const rowProblem = (row: Row): boolean => {
    const body = bodyFor(row, localDate());
    return goalProblem(body) !== null || [body.min, body.max].some((v) => v !== null && (!Number.isFinite(v) || v <= 0 || v >= 1_000_000));
  };

  async function save() {
    if (!result || !engine) return;
    setSaveTried(true);
    const keep = result.rows.filter((r) => r.keep);
    if (keep.some(rowProblem)) return;
    const today = localDate();
    for (const row of keep) await engine.saveGoal(crypto.randomUUID(), bodyFor(row, today));
    onClose();
  }

  const name = (key: string) => nutrientName(key, defs.find((d) => d.key === key)?.name ?? key);
  const unitOf = (s: GoalSuggestion) => (s.nutrientKey === WATER_KEY ? "ml" : s.unit);
  const kept = result?.rows.filter((r) => r.keep).length ?? 0;

  const field = (id: string, label: string, value: string, set: (v: string) => void, unit: string, step: string = "1") => (
    <>
      <label htmlFor={id}>{label}</label>
      <span className="target-input">
        <input id={id} type="number" min={0} step={step} inputMode="decimal" autoComplete="off" value={value} onChange={(e) => set(e.target.value)} />
        <span className="target-unit">{unit}</span>
      </span>
    </>
  );

  const problemKey: Record<string, MessageKey> = {
    choose: "calc.problem.choose",
    age: "calc.problem.age",
    height: "calc.problem.height",
    weight: "calc.problem.weight",
  };

  return (
    <Sheet title={t("calc.title")} onClose={onClose}>
      {!result ? (
        <form
          autoComplete="off"
          onSubmit={(e) => {
            e.preventDefault();
            estimate();
          }}
        >
          <p className="hint" data-testid="calc-privacy">
            {t("calc.privacy")}
          </p>
          <p className="fine">{t("calc.scope")}</p>
          <label id="calc-sex-label">{t("calc.sex")}</label>
          <div className="segmented" role="radiogroup" aria-labelledby="calc-sex-label">
            {(["female", "male"] as const).map((s) => (
              <button key={s} type="button" role="radio" aria-checked={sex === s} onClick={() => setSex(s)}>
                {t(s === "female" ? "calc.sex.female" : "calc.sex.male")}
              </button>
            ))}
          </div>
          <p className="fine">{t("calc.sexNote")}</p>
          {field("calc-age", t("calc.age"), age, setAge, t("calc.years"))}
          <label id="calc-units-label">{t("calc.units")}</label>
          <div className="segmented" role="radiogroup" aria-labelledby="calc-units-label">
            <button type="button" role="radio" aria-checked={metric} onClick={() => setMetric(true)}>
              {t("calc.units.metric")}
            </button>
            <button type="button" role="radio" aria-checked={!metric} onClick={() => setMetric(false)}>
              {t("calc.units.us")}
            </button>
          </div>
          {metric ? (
            <>
              {field("calc-height", t("calc.height"), cm, setCm, "cm", "any")}
              {field("calc-weight", t("calc.weight"), kg, setKg, "kg", "any")}
            </>
          ) : (
            <>
              {field("calc-feet", t("calc.feet"), feet, setFeet, "ft")}
              {field("calc-inches", t("calc.inches"), inches, setInches, "in", "any")}
              {field("calc-pounds", t("calc.weight"), lb, setLb, "lb", "any")}
            </>
          )}
          <label id="calc-activity-label">{t("calc.activity")}</label>
          <div className="radio-list" role="radiogroup" aria-labelledby="calc-activity-label">
            {ACTIVITY_LEVELS.map((a) => (
              <label key={a} className="check radio-row">
                <input type="radio" name="calc-activity" checked={activity === a} onChange={() => setActivity(a)} />
                <span>
                  <strong>{t(ACTIVITY_LABEL[a])}</strong>
                  <span className="fine">{t(ACTIVITY_HELP[a])}</span>
                </span>
              </label>
            ))}
          </div>
          <p className="fine">{t("calc.activityNote")}</p>
          {tried && problem && (
            <p className="error" role="alert">
              {t(problemKey[problem]!, { minAge: ESTIMATE_LIMITS.age.min, maxAge: ESTIMATE_LIMITS.age.max })}
            </p>
          )}
          <div className="sheet-actions">
            <button type="submit" className="btn-primary">
              {t("calc.show")}
            </button>
          </div>
        </form>
      ) : (
        <div data-testid="calc-results">
          <p className="hint">{t("calc.resultsIntro")}</p>
          <ul className="calc-list">
            {result.rows.map((row, i) => {
              const { suggestion: s } = row;
              const water = s.nutrientKey === WATER_KEY;
              const bad = saveTried && row.keep && rowProblem(row);
              return (
                <li key={s.nutrientKey} data-testid="calc-row" data-nutrient={s.nutrientKey}>
                  <label className="check calc-keep">
                    <input type="checkbox" checked={row.keep} onChange={(e) => update(i, { keep: e.target.checked })} />
                    <strong>{name(s.nutrientKey)}</strong>
                  </label>
                  <div className="calc-amounts">
                    <span className="target-input">
                      <input
                        type="number"
                        min={0}
                        step="any"
                        inputMode="decimal"
                        autoComplete="off"
                        aria-label={t(s.kind === "between" ? "calc.lowerNamed" : "calc.atLeastNamed", { name: name(s.nutrientKey) })}
                        value={row.min}
                        onChange={(e) => update(i, { min: e.target.value })}
                      />
                      <span className="target-unit">{unitOf(s)}</span>
                    </span>
                    {s.kind === "between" && (
                      <>
                        <span aria-hidden="true">–</span>
                        <span className="target-input">
                          <input
                            type="number"
                            min={0}
                            step="any"
                            inputMode="decimal"
                            autoComplete="off"
                            aria-label={t("calc.upperNamed", { name: name(s.nutrientKey) })}
                            value={row.max}
                            onChange={(e) => update(i, { max: e.target.value })}
                          />
                          <span className="target-unit">{unitOf(s)}</span>
                        </span>
                      </>
                    )}
                  </div>
                  <p className="fine">
                    {t(BASIS[s.basis], {
                      kcal: formatNutrient("energy_kcal", result.estimate.energyKcal, "kcal"),
                      rmse: formatNutrient("energy_kcal", result.estimate.energyRmse, "kcal"),
                      from: s.basis === "protein" ? AMDR.protein.from : s.basis === "fat" ? AMDR.fat.from : AMDR.carbohydrate.from,
                      to: s.basis === "protein" ? AMDR.protein.to : s.basis === "fat" ? AMDR.fat.to : AMDR.carbohydrate.to,
                    })}
                  </p>
                  {water && <p className="fine">{t("calc.waterNote")}</p>}
                  {row.hasGoal && <p className="fine">{t("calc.hasGoal")}</p>}
                  {bad && (
                    <p className="error" role="alert">
                      {t("goals.problem.range")}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
          <p className="fine">
            {t("calc.sources")}{" "}
            <a href={DRI_SOURCES.energy.url} target="_blank" rel="noopener noreferrer">
              {t("calc.sourceEnergy")}
            </a>
            {" · "}
            <a href={DRI_SOURCES.macronutrientsAndWater.url} target="_blank" rel="noopener noreferrer">
              {t("calc.sourceTables")}
            </a>
          </p>
          <p className="fine">{t("calc.fine")}</p>
          <div className="sheet-actions">
            <button type="button" className="btn-primary" disabled={kept === 0} onClick={() => void save()}>
              {t("calc.save", { n: kept })}
            </button>
            <button type="button" className="btn-secondary" onClick={() => setResult(null)}>
              {t("calc.back")}
            </button>
          </div>
        </div>
      )}
    </Sheet>
  );
}
