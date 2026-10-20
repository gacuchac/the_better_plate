import { useMemo, useState } from "react";
import type { GoalBody } from "@betterplate/contracts";
import { DIETARY_GUIDELINES_SOURCE, dayCount, goalProblem, goalProgress, periodWindow, shiftDate, summarizePeriod } from "@betterplate/nutrition";
import type { GoalProgress, GoalWindowProgress, NutrientDefinition } from "@betterplate/nutrition";
import { useApp } from "../store.tsx";
import { goalSentence, intakeByDay } from "../goals.ts";
import { barScale, goalBars, type GoalBar } from "../goalBars.ts";
import type { LocalGoal } from "../localdb.ts";
import { localDate } from "../meals.ts";
import { dateLocale, formatQty, nutrientName, t as tr, useT, type MessageKey } from "../i18n.ts";
import { EmptyState, Sheet } from "./common.tsx";

/**
 * The person's own consumption goals (PRODUCT.md §2.3). Amounts are only ever what the person
 * typed; nothing is suggested, computed from body data or judged. Only meals marked as eaten
 * count, plans never; a nutrient no meal reports stays unknown, not zero.
 */

const MAX_RANGE_DAYS = 366;

function useIntake() {
  const { logs, catalog } = useApp();
  return useMemo(
    () => (catalog.status === "ready" ? intakeByDay(logs, catalog.foods, catalog.bundle.nutrients) : []),
    [logs, catalog],
  );
}

const shortDate = (date: string) =>
  new Date(`${date}T12:00:00`).toLocaleDateString(dateLocale(), { month: "short", day: "numeric", year: date.slice(0, 4) === localDate().slice(0, 4) ? undefined : "numeric" });

function windowLabel(goal: GoalBody, w: GoalWindowProgress, state: GoalProgress["state"]): string {
  const current = state === "active";
  if (goal.period === "day") return current ? tr("goals.window.today") : shortDate(w.from);
  if (goal.period === "week") return current ? tr("goals.window.thisWeek") : tr("goals.window.range", { from: shortDate(w.from), to: shortDate(w.to) });
  return current ? tr("goals.window.thisMonth") : new Date(`${w.from}T12:00:00`).toLocaleDateString(dateLocale(), { month: "long", year: "numeric" });
}

/** Plain facts about logged food against the person's own numbers; no red, no judgement. */
function statusWords(w: GoalWindowProgress): string {
  if (w.status === "no_data") return w.daysLogged ? tr("goals.status.notReported") : tr("goals.status.nothingLogged");
  if (w.status === "met") return tr("goals.status.met");
  if (w.status === "below") return w.inProgress ? tr("goals.status.belowSoFar") : tr("goals.status.below");
  return tr("goals.status.above");
}

const HISTORY = { day: "goals.history.day", week: "goals.history.week", month: "goals.history.month" } as const;
const PERIOD = { day: "goals.period.day", week: "goals.period.week", month: "goals.period.month" } as const;
const RANGE = { "7": "summary.range.7", "30": "summary.range.30", month: "summary.range.month", custom: "summary.range.custom" } as const;

export function Goals() {
  const { catalog, goals, engine, account } = useApp();
  const t = useT();
  const intake = useIntake();
  const [editing, setEditing] = useState<LocalGoal | "new" | null>(null);
  const today = localDate();

  if (catalog.status !== "ready" || !account) return <EmptyState title={t("catalog.notReady")}>{t("common.loading")}</EmptyState>;
  const defs = catalog.bundle.nutrients;
  const withProgress = goals.map((g) => ({ goal: g, progress: goalProgress(g.body, intake, today) }));
  const order = { active: 0, upcoming: 1, ended: 2 } as const;
  withProgress.sort((a, b) => order[a.progress.state] - order[b.progress.state] || a.goal.body.startDate.localeCompare(b.goal.body.startDate));

  return (
    <div className="screen">
      <header className="screen-head">
        <div>
          <p className="eyebrow">{t("nav.you")}</p>
          <h1>{t("goals.title")}</h1>
        </div>
      </header>
      <p className="hint">{t("goals.intro")}</p>
      <p className="hint" data-testid="guidelines-link">
        {t("targets.guideBefore")}{" "}
        <a href={DIETARY_GUIDELINES_SOURCE.url} target="_blank" rel="noopener noreferrer">
          {t("targets.guideLink")}
        </a>{" "}
        {t("targets.guideAfter", { released: DIETARY_GUIDELINES_SOURCE.releasedAt })}
      </p>
      <div className="stack" style={{ marginBottom: 16 }}>
        <button type="button" className="btn-primary" onClick={() => setEditing("new")}>
          {t("goals.add")}
        </button>
      </div>

      {withProgress.length === 0 ? (
        <EmptyState title={t("goals.emptyTitle")}>
          <p>{t("goals.emptyBody")}</p>
        </EmptyState>
      ) : (
        withProgress.map(({ goal, progress }) => {
          const name = nutrientName(goal.body.nutrientKey, defs.find((d) => d.key === goal.body.nutrientKey)?.name ?? goal.body.nutrientKey);
          const w = progress.current;
          return (
            <section key={goal.id} className="card" data-testid="goal-card" aria-label={name}>
              <div className="card-head">
                <div>
                  <h2 className="goal-title">{name}</h2>
                  <p className="meal-meta">{goalSentence(goal.body)}</p>
                </div>
                <button type="button" className="btn-link" onClick={() => setEditing(goal)} aria-label={t("goals.editNamed", { name })}>
                  {t("common.edit")}
                </button>
              </div>
              {progress.state === "upcoming" ? (
                <p className="hint">{t("goals.startsOn", { date: shortDate(goal.body.startDate) })}</p>
              ) : (
                <>
                  <p className="goal-now" data-testid="goal-status">
                    <strong>{windowLabel(goal.body, w, progress.state)}:</strong> {w.amount === null ? "" : `${formatQty(w.amount, goal.body.unit)} · `}
                    {statusWords(w)}
                  </p>
                  {w.partialData && w.amount !== null && <p className="fine">{t("goals.partial")}</p>}
                  {progress.past.length > 0 && (
                    <p className="meal-meta" data-testid="goal-history">
                      {t(HISTORY[goal.body.period], { met: progress.pastMet, n: progress.past.length })}
                    </p>
                  )}
                </>
              )}
              <p className="fine">
                {goal.body.endDate
                  ? progress.state === "ended"
                    ? t("goals.ended", { date: shortDate(goal.body.endDate) })
                    : t("goals.dates", { from: shortDate(goal.body.startDate), to: shortDate(goal.body.endDate) })
                  : t("goals.since", { date: shortDate(goal.body.startDate) })}
                {goal.state === "pending" && ` · ${t("sync.savedLocal")}`}
              </p>
              {goal.state === "rejected" && (
                <p className="error" role="alert">
                  {t("goals.rejected", { reason: goal.rejection ?? "" })}
                </p>
              )}
              {goal.state === "conflict" && (
                <div className="banner banner-warn" role="alert">
                  <p>{goal.conflictServer ? t("goals.conflict", { goal: goalSentence(goal.conflictServer) }) : t("goals.conflictRemoved")}</p>
                  <div className="banner-actions">
                    <button type="button" className="btn-secondary" onClick={() => void engine?.resolveGoalConflict(goal.id, "mine")}>
                      {t("conflict.keepMine")}
                    </button>
                    <button type="button" className="btn-secondary" onClick={() => void engine?.resolveGoalConflict(goal.id, "cloud")}>
                      {t("conflict.keepCloud")}
                    </button>
                  </div>
                </div>
              )}
            </section>
          );
        })
      )}
      <p className="fine">{t("goals.fine")}</p>
      {editing && <GoalSheet goal={editing === "new" ? null : editing} defs={defs} onClose={() => setEditing(null)} />}
    </div>
  );
}

const PROBLEM_KEYS: Record<string, MessageKey> = {
  "Set the lower amount": "goals.problem.min",
  "Set the upper amount": "goals.problem.max",
  "The lower amount must not be above the upper amount": "goals.problem.order",
  "The end date must be on or after the start date": "goals.problem.dates",
};

function GoalSheet({ goal, defs, onClose }: { goal: LocalGoal | null; defs: NutrientDefinition[]; onClose: () => void }) {
  const { engine } = useApp();
  const t = useT();
  const start = goal?.body;
  const [nutrientKey, setNutrientKey] = useState(start?.nutrientKey ?? defs.find((d) => d.key === "protein")?.key ?? defs[0]!.key);
  const [kind, setKind] = useState<GoalBody["kind"]>(start?.kind ?? "at_least");
  const [min, setMin] = useState(start?.min != null ? String(start.min) : "");
  const [max, setMax] = useState(start?.max != null ? String(start.max) : "");
  const [period, setPeriod] = useState<GoalBody["period"]>(start?.period ?? "day");
  const [startDate, setStartDate] = useState(start?.startDate ?? localDate());
  const [endDate, setEndDate] = useState(start?.endDate ?? "");
  const [tried, setTried] = useState(false);
  const def = defs.find((d) => d.key === nutrientKey)!;
  const num = (v: string) => (v.trim() === "" ? null : Number(v));

  const body: GoalBody = {
    nutrientKey,
    unit: def.unit,
    kind,
    min: kind === "at_most" ? null : num(min),
    max: kind === "at_least" ? null : num(max),
    period,
    startDate,
    endDate: endDate || null,
  };
  const outOfRange = [body.min, body.max].some((v) => v !== null && (!Number.isFinite(v) || v >= 1_000_000));
  const problem: MessageKey | null = !/^\d{4}-\d{2}-\d{2}$/.test(startDate) ? "goals.problem.start" : outOfRange ? "goals.problem.range" : (() => {
    const p = goalProblem(body);
    return p ? (PROBLEM_KEYS[p] ?? "goals.problem.range") : null;
  })();

  async function save() {
    setTried(true);
    if (problem || !engine) return;
    await engine.saveGoal(goal?.id ?? crypto.randomUUID(), body);
    onClose();
  }

  async function remove() {
    if (!goal || !engine || !confirm(t("goals.deleteConfirm"))) return;
    await engine.deleteGoal(goal.id);
    onClose();
  }

  const amountInput = (id: string, label: string, value: string, set: (v: string) => void) => (
    <>
      <label htmlFor={id}>{label}</label>
      <span className="target-input">
        <input id={id} type="number" min={0} step="any" inputMode="decimal" value={value} onChange={(e) => set(e.target.value)} />
        <span className="target-unit">{def.unit}</span>
      </span>
    </>
  );

  return (
    <Sheet title={goal ? t("goals.editTitle") : t("goals.addTitle")} onClose={onClose}>
      <label htmlFor="goal-nutrient">{t("goals.nutrient")}</label>
      <select id="goal-nutrient" value={nutrientKey} onChange={(e) => setNutrientKey(e.target.value)}>
        {defs.map((d) => (
          <option key={d.key} value={d.key}>
            {nutrientName(d.key, d.name)} ({d.unit})
          </option>
        ))}
      </select>
      <label htmlFor="goal-kind">{t("goals.kind")}</label>
      <select id="goal-kind" value={kind} onChange={(e) => setKind(e.target.value as GoalBody["kind"])}>
        <option value="at_least">{t("goals.kind.atLeast")}</option>
        <option value="at_most">{t("goals.kind.atMost")}</option>
        <option value="between">{t("goals.kind.between")}</option>
      </select>
      {kind !== "at_most" && amountInput("goal-min", kind === "between" ? t("goals.lower") : t("goals.amount"), min, setMin)}
      {kind !== "at_least" && amountInput("goal-max", kind === "between" ? t("goals.upper") : t("goals.amount"), max, setMax)}
      <label id="goal-period-label">{t("goals.period")}</label>
      <div className="segmented" role="radiogroup" aria-labelledby="goal-period-label">
        {(["day", "week", "month"] as const).map((p) => (
          <button key={p} type="button" role="radio" aria-checked={period === p} onClick={() => setPeriod(p)}>
            {t(PERIOD[p])}
          </button>
        ))}
      </div>
      {period === "week" && <p className="fine">{t("goals.weekNote")}</p>}
      <label htmlFor="goal-start">{t("goals.start")}</label>
      <input id="goal-start" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
      <label htmlFor="goal-end">{t("goals.end")}</label>
      <input id="goal-end" type="date" value={endDate} min={startDate} onChange={(e) => setEndDate(e.target.value)} />
      <p className="fine">{t("goals.endNote")}</p>
      {tried && problem && (
        <p className="error" role="alert">
          {t(problem)}
        </p>
      )}
      <div className="sheet-actions">
        <button type="button" className="btn-primary" onClick={() => void save()}>
          {t("goals.save")}
        </button>
        {goal && (
          <button type="button" className="btn-link danger" onClick={() => void remove()}>
            {t("goals.delete")}
          </button>
        )}
      </div>
    </Sheet>
  );
}

// ---------------------------------------------------------------- totals over a period (You page)

type Range = "7" | "30" | "month" | "custom";

export function PeriodTotals() {
  const { catalog, goals } = useApp();
  const t = useT();
  const intake = useIntake();
  const today = localDate();
  const [range, setRange] = useState<Range>("7");
  const [from, setFrom] = useState(shiftDate(today, -6));
  const [to, setTo] = useState(today);

  if (catalog.status !== "ready") return null;
  const defs = catalog.bundle.nutrients;
  const window =
    range === "7"
      ? { from: shiftDate(today, -6), to: today }
      : range === "30"
        ? { from: shiftDate(today, -29), to: today }
        : range === "month"
          ? { from: periodWindow("month", today).from, to: today }
          : { from, to };
  const validCustom = /^\d{4}-\d{2}-\d{2}$/.test(from) && /^\d{4}-\d{2}-\d{2}$/.test(to) && from <= to && dayCount(from, to) <= MAX_RANGE_DAYS;
  const summary = range !== "custom" || validCustom ? summarizePeriod(intake, window.from, window.to) : null;

  return (
    <section className="card" aria-labelledby="totals-title" data-testid="period-totals" style={{ marginTop: 16 }}>
      <div className="card-head">
        <h2 id="totals-title">{t("summary.title")}</h2>
      </div>
      <div className="segmented" role="tablist" aria-label={t("summary.range")} style={{ marginBottom: 12, flexWrap: "wrap" }}>
        {(["7", "30", "month", "custom"] as const).map((r) => (
          <button key={r} type="button" role="tab" aria-selected={range === r} onClick={() => setRange(r)}>
            {t(RANGE[r])}
          </button>
        ))}
      </div>
      {range === "custom" && (
        <div className="date-range">
          <span>
            <label htmlFor="totals-from">{t("summary.from")}</label>
            <input id="totals-from" type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
          </span>
          <span>
            <label htmlFor="totals-to">{t("summary.to")}</label>
            <input id="totals-to" type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
          </span>
        </div>
      )}
      {!summary ? (
        <p className="error" role="alert">
          {t("summary.badRange", { n: MAX_RANGE_DAYS })}
        </p>
      ) : (
        <>
          <p className="hint" data-testid="totals-days">
            {t("summary.daysLogged", { logged: summary.daysLogged, days: summary.days })}
            {summary.incomplete && summary.daysLogged > 0 && ` ${t("summary.incomplete")}`}
          </p>
          {summary.daysLogged === 0 ? (
            <p className="hint">{t("summary.empty")}</p>
          ) : (
            <>
            <GoalChart bars={goalBars(goals, intake, window.from, window.to)} otherGoals={goals.some((g) => !g.deleted && g.body.period !== "day")} defs={defs} />
            <table className="totals-table">
              <thead>
                <tr>
                  <th scope="col">{t("summary.nutrient")}</th>
                  <th scope="col">{t("summary.total")}</th>
                  <th scope="col">{t("summary.average")}</th>
                </tr>
              </thead>
              <tbody>
                {defs.map((d) => {
                  const n = summary.nutrients.find((x) => x.key === d.key && x.unit === d.unit);
                  const partial = n?.status === "partial";
                  const qty = (v: number | null | undefined) => (v == null ? t("nutrition.notReported") : partial ? t("summary.atLeast", { amount: formatQty(v, d.unit) }) : formatQty(v, d.unit));
                  return (
                    <tr key={d.key}>
                      <th scope="row">{nutrientName(d.key, d.name)}</th>
                      <td>{qty(n?.total)}</td>
                      <td>{qty(n?.averagePerLoggedDay)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            </>
          )}
          <p className="fine">{t("summary.fine")}</p>
        </>
      )}
    </section>
  );
}

/** Eaten next to the person's own daily goals: one pair of bars per goal, each on its own scale. */
function GoalChart({ bars, otherGoals, defs }: { bars: GoalBar[]; otherGoals: boolean; defs: NutrientDefinition[] }) {
  const t = useT();
  if (!bars.length) return otherGoals ? <p className="fine">{t("chart.otherGoals")}</p> : null;
  const pct = (v: number, scale: number) => `${Math.min(100, (v / scale) * 100)}%`;
  return (
    <div className="goal-chart" data-testid="goal-chart">
      <h3 id="goal-chart-title">{t("chart.title")}</h3>
      <p className="fine">{t("chart.intro")}</p>
      <ul aria-labelledby="goal-chart-title">
        {bars.map((bar) => {
          const { body } = bar.goal;
          const name = nutrientName(body.nutrientKey, defs.find((d) => d.key === body.nutrientKey)?.name ?? body.nutrientKey);
          const scale = barScale(bar);
          const eaten =
            bar.amount === null
              ? bar.daysLogged
                ? t("goals.status.notReported")
                : t("chart.noDays")
              : t("chart.eaten", { amount: bar.partial ? t("summary.atLeast", { amount: formatQty(bar.amount, body.unit) }) : formatQty(bar.amount, body.unit) });
          const lo = body.kind === "between" ? body.min! : 0;
          const hi = body.kind === "at_least" ? body.min! : body.max!;
          return (
            <li key={bar.goal.id} className="goal-bar" data-testid="goal-bar" data-status={bar.status}>
              <p className="goal-bar-head">
                <strong>{name}</strong>{" "}
                <span>
                  {eaten} · {goalSentence(body)}
                  {bar.amount !== null && ` · ${t(CHART_STATUS[bar.status])}`}
                </span>
              </p>
              <div className="goal-bar-rows" aria-hidden="true">
                <span className="goal-bar-label">{t("chart.eatenLabel")}</span>
                <span className="goal-bar-track">
                  {bar.amount !== null && <span className={`goal-bar-fill${bar.partial ? " partial" : ""}`} style={{ width: pct(bar.amount, scale) }} />}
                </span>
                <span className="goal-bar-label">{t("chart.goalLabel")}</span>
                <span className="goal-bar-track">
                  <span className="goal-bar-goal" style={{ left: pct(lo, scale), width: `calc(${pct(hi, scale)} - ${pct(lo, scale)})` }} />
                </span>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

const CHART_STATUS = { met: "goals.status.met", below: "goals.status.below", above: "goals.status.above", no_data: "goals.status.notReported" } as const;
