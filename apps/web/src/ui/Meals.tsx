import { useMemo, useState } from "react";
import { formatAmount, type DayTotal } from "@betterplate/nutrition";
import type { LocalLog, LocalPlan } from "../localdb.ts";
import { addDays, dayName, formatDay, localDate, logEaten, slotLabel, summarizeDay, type DaySummary } from "../meals.ts";
import { useApp } from "../store.tsx";
import { EmptyState, navigate, Sheet } from "./common.tsx";
import { Icon } from "./icons.tsx";
import { LogSheet, PlanSheet } from "./MealSheets.tsx";
import { DailyValueNote, NutrientLine } from "./Nutrition.tsx";

const MACROS = [
  { key: "energy_kcal", label: "kcal" },
  { key: "protein", label: "Protein" },
  { key: "carbohydrate", label: "Carbs" },
  { key: "fat_total", label: "Fat" },
];

function macroText(t: DayTotal | undefined) {
  if (!t || t.amount === null) return "–";
  const v = t.unit === "kcal" ? Math.round(t.amount).toString() : formatAmount(t.amount, t.unit);
  return t.status === "partial" ? `≥ ${v}` : v;
}

export function Meals({ date: routeDate }: { date?: string }) {
  const { catalog, plans, logs, recipes } = useApp();
  const today = localDate();
  const date = routeDate ?? today;
  const [range, setRange] = useState<"day" | "week">("day");
  const [logging, setLogging] = useState<LocalPlan | null>(null);
  const [planning, setPlanning] = useState(false);
  const [details, setDetails] = useState(false);

  const foods = catalog.status === "ready" ? catalog.foods : new Map();
  const defs = catalog.status === "ready" ? catalog.bundle.nutrients : [];
  const day = useMemo(() => summarizeDay(date, logs, plans, foods, defs), [date, logs, plans, foods, defs]);
  const week = useMemo(() => Array.from({ length: 7 }, (_, i) => summarizeDay(addDays(date, i - 6), logs, plans, foods, defs)), [date, logs, plans, foods, defs]);

  if (catalog.status !== "ready") return <EmptyState title="Food list not ready">{catalog.status === "unavailable" ? catalog.message : "Loading…"}</EmptyState>;
  const go = (d: string) => navigate(d === today ? "/meals" : `/meals/${d}`);
  const recipeFor = (plan: LocalPlan) => recipes.find((r) => r.id === plan.body.recipeId);

  return (
    <div className="screen">
      <div className="day-nav">
        <button type="button" className="icon-btn round" aria-label={range === "day" ? "Previous day" : "Previous week"} onClick={() => go(addDays(date, range === "day" ? -1 : -7))}>
          <Icon name="back" />
        </button>
        <div className="day-title">
          <h1>{range === "day" ? dayName(date, today) : "Last 7 days"}</h1>
          <p>{range === "day" ? formatDay(date) : `${formatDay(addDays(date, -6), { day: "numeric", month: "short" })} – ${formatDay(date, { day: "numeric", month: "short" })}`}</p>
        </div>
        <button type="button" className="icon-btn round" aria-label={range === "day" ? "Next day" : "Next week"} onClick={() => go(addDays(date, range === "day" ? 1 : 7))}>
          <Icon name="forward" />
        </button>
      </div>
      <div style={{ display: "flex", justifyContent: "center", marginBottom: 16 }}>
        <div className="segmented" role="tablist" aria-label="Range">
          <button type="button" role="tab" aria-selected={range === "day"} onClick={() => setRange("day")}>
            Day
          </button>
          <button type="button" role="tab" aria-selected={range === "week"} onClick={() => setRange("week")}>
            7 days
          </button>
        </div>
      </div>

      {range === "day" ? (
        <>
          <EatenCard day={day} today={today} onDetails={() => setDetails(true)} />
          <PlannedCard day={day} recipeFor={recipeFor} onLog={setLogging} />
          <div className="sheet-actions">
            <button type="button" className="btn-primary" onClick={() => setPlanning(true)}>
              <Icon name="plus" /> Plan a meal
            </button>
          </div>
        </>
      ) : (
        <WeekList week={week} today={today} onPick={(d) => {
          setRange("day");
          go(d);
        }} />
      )}

      {logging && (() => {
        const recipe = recipeFor(logging);
        return recipe ? (
          <LogSheet
            recipeId={recipe.id}
            recipe={recipe.body}
            plannedMealId={logging.id}
            initialServings={logging.body.servings}
            initialSlot={logging.body.slot}
            initialDate={logging.body.date}
            onClose={() => setLogging(null)}
          />
        ) : null;
      })()}
      {planning && <PickRecipeToPlan date={date} onClose={() => setPlanning(false)} />}
      {details && day.totals && (
        <Sheet title={`${dayName(date, today)}: what you ate`} onClose={() => setDetails(false)}>
          <p className="hint">Sum of meals marked as eaten. Plans are not included. Estimated from USDA data.</p>
          <ul className="nutrient-list">
            {defs.map((d) => {
              const t = day.totals!.find((x) => x.key === d.key);
              if (!t) return null;
              return (
                <li key={d.key} className="nutrient-row static">
                  <NutrientLine row={t} name={d.name} />
                </li>
              );
            })}
          </ul>
          <DailyValueNote />
        </Sheet>
      )}
    </div>
  );
}

function dayBadge(day: DaySummary, today: string): string | null {
  if (day.date === today) return "Day in progress";
  if (day.openPlans.length) return "Plans not marked";
  return day.logs.length ? "Only what you logged" : null;
}

function EatenCard({ day, today, onDetails }: { day: DaySummary; today: string; onDetails: () => void }) {
  const { engine, catalog } = useApp();
  const badge = dayBadge(day, today);
  const foods = catalog.status === "ready" ? catalog.foods : new Map();
  const defs = catalog.status === "ready" ? catalog.bundle.nutrients : [];
  return (
    <section className="card" aria-labelledby="eaten-title" data-testid="eaten-card">
      <div className="card-head">
        <h2 id="eaten-title">Eaten</h2>
        {badge && <span className="badge">{badge}</span>}
      </div>
      {day.logs.length === 0 ? (
        <p className="hint">Nothing marked as eaten{day.date > today ? " yet" : ""}. Open a recipe and tap "I ate this".</p>
      ) : (
        <>
          {day.logs.map((log) => (
            <LogRow key={log.id} log={log} kcal={logEaten(log, foods, defs).find((t) => t.key === "energy_kcal")} onRemove={() => void engine?.deleteLog(log.id)} />
          ))}
          <button type="button" className="summary-card card" onClick={onDetails} style={{ textAlign: "left", width: "100%", cursor: "pointer", font: "inherit" }} data-testid="day-totals">
            <span className="card-head" style={{ marginBottom: 0 }}>
              <span className="hint" style={{ margin: 0 }}>
                Day total · <span className="estimated">Estimated</span>
              </span>
              <span style={{ fontSize: "0.8125rem", fontWeight: 650, color: "var(--sage-ink)" }}>All nutrients</span>
            </span>
            <span className="macro-grid">
              {MACROS.map((m) => (
                <span key={m.key}>
                  <span className="macro-value" style={{ display: "block" }}>{macroText(day.totals?.find((t) => t.key === m.key))}</span>
                  <span className="macro-label">{m.label}</span>
                </span>
              ))}
            </span>
          </button>
        </>
      )}
      <p className="fine" style={{ marginTop: 12 }}>
        Totals cover only what you've marked as eaten. A missing value means the source doesn't report it, not zero.
      </p>
    </section>
  );
}

function LogRow({ log, kcal, onRemove }: { log: LocalLog; kcal: { amount: number | null; status: string } | undefined; onRemove: () => void }) {
  const servings = log.body.servings === 1 ? "1 serving" : `${log.body.servings} servings`;
  const state = log.state === "synced" ? "Synced" : log.state === "rejected" ? "Needs attention" : "Saved on this device";
  return (
    <div className="meal-row" data-testid="eaten-row">
      <div>
        <div className="meal-name">{log.body.recipe.title}</div>
        <div className="meal-meta">
          {slotLabel(log.body.slot)} · {servings}
          {kcal?.amount != null ? ` · ${kcal.status === "partial" ? "at least " : ""}${Math.round(kcal.amount)} kcal` : ""}
        </div>
        {log.state === "rejected" && <div className="meal-meta error">{log.rejection}</div>}
      </div>
      <div className="meal-actions">
        <span className={`state state-${log.state}`}>{state}</span>
        <button type="button" className="icon-btn" aria-label={`Remove ${log.body.recipe.title} from eaten`} onClick={onRemove}>
          <Icon name="close" />
        </button>
      </div>
    </div>
  );
}

function PlannedCard({ day, recipeFor, onLog }: { day: DaySummary; recipeFor: (p: LocalPlan) => { id: string } | undefined; onLog: (p: LocalPlan) => void }) {
  const { engine } = useApp();
  return (
    <section className="card card-dashed" aria-labelledby="planned-title" data-testid="planned-card">
      <div className="card-head">
        <h2 id="planned-title">Planned</h2>
      </div>
      {day.plans.length === 0 && <p className="hint">No plans for this day.</p>}
      {day.plans.map((plan) => {
        const done = !day.openPlans.includes(plan);
        const recipe = recipeFor(plan);
        return (
          <div key={plan.id} className="meal-row" data-testid="planned-row">
            <div>
              <div className="meal-name">{plan.body.title}</div>
              <div className="meal-meta">
                {slotLabel(plan.body.slot)} · {plan.body.servings === 1 ? "1 serving" : `${plan.body.servings} servings`}
                {!recipe && " · recipe no longer on this device"}
              </div>
              {plan.state === "conflict" && (
                <div className="banner banner-warn" role="alert" style={{ marginTop: 8 }}>
                  <p>This plan changed on another device{plan.conflictServer ? ` ("${plan.conflictServer.title}", ${plan.conflictServer.date})` : " and was removed there"}.</p>
                  <div className="banner-actions">
                    <button type="button" className="btn-secondary" onClick={() => void engine?.resolvePlanConflict(plan.id, "mine")}>
                      Keep this device's
                    </button>
                    <button type="button" className="btn-secondary" onClick={() => void engine?.resolvePlanConflict(plan.id, "cloud")}>
                      Keep cloud copy
                    </button>
                  </div>
                </div>
              )}
            </div>
            <div className="meal-actions">
              {done ? (
                <span className="badge badge-sage">
                  <Icon name="check" size={14} /> Eaten
                </span>
              ) : (
                <button type="button" className="btn-secondary" disabled={!recipe} onClick={() => onLog(plan)}>
                  I ate this
                </button>
              )}
              <button type="button" className="icon-btn" aria-label={`Remove plan ${plan.body.title}`} onClick={() => void engine?.deletePlan(plan.id)}>
                <Icon name="close" />
              </button>
            </div>
          </div>
        );
      })}
      <p className="fine" style={{ marginTop: 12 }}>
        Plans never count toward what you ate.
      </p>
    </section>
  );
}

function WeekList({ week, today, onPick }: { week: DaySummary[]; today: string; onPick: (d: string) => void }) {
  const logged = week.filter((d) => d.logs.length > 0).length;
  return (
    <>
      <p className="hint" data-testid="week-summary">
        {logged === 0 ? "Nothing logged in these 7 days." : `${logged} of 7 days have meals marked as eaten.`} Days are never averaged with missing meals counted as zero.
      </p>
      <ul className="week">
        {week.map((d) => {
          const kcal = d.totals?.find((t) => t.key === "energy_kcal");
          return (
            <li key={d.date}>
              <button type="button" className="week-day" style={{ width: "100%", textAlign: "left", font: "inherit", cursor: "pointer" }} onClick={() => onPick(d.date)} data-testid="week-day">
                <span className="week-date">
                  {formatDay(d.date, { weekday: "short" })}
                  <small>{formatDay(d.date, { day: "numeric", month: "short" })}</small>
                </span>
                <span className="meal-meta">
                  {d.logs.length ? `${d.logs.length} eaten` : "Nothing logged"}
                  {d.plans.length ? ` · ${d.plans.length} planned` : ""}
                </span>
                <span style={{ fontWeight: 650 }}>
                  {kcal && kcal.amount !== null ? `${kcal.status === "partial" ? "≥ " : ""}${Math.round(kcal.amount)} kcal` : ""}
                  {d.date === today && <span className="badge" style={{ marginLeft: 8 }}>Today</span>}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </>
  );
}

function PickRecipeToPlan({ date, onClose }: { date: string; onClose: () => void }) {
  const { recipes } = useApp();
  const [picked, setPicked] = useState<string | null>(null);
  const recipe = recipes.find((r) => r.id === picked);
  if (recipe) return <PlanSheet recipeId={recipe.id} title={recipe.body.title} initialDate={date} onClose={onClose} />;
  return (
    <Sheet title="Plan a meal" onClose={onClose}>
      {recipes.length === 0 ? (
        <p className="hint">Save a recipe first, then plan it here.</p>
      ) : (
        <ul className="food-results" role="listbox" aria-label="Your recipes">
          {recipes.map((r) => (
            <li key={r.id}>
              <button type="button" role="option" aria-selected={false} onClick={() => setPicked(r.id)}>
                <span>{r.body.title}</span>
                <small>{r.body.servings === 1 ? "1 serving" : `${r.body.servings} servings`}</small>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Sheet>
  );
}
