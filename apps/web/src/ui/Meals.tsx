import { useMemo, useState } from "react";
import { type DayTotal } from "@betterplate/nutrition";
import { formatQty, nutrientName, t as translate, useT } from "../i18n.ts";
import { MACROS } from "./RecipeEditor.tsx";
import type { LocalFeedback, LocalLog, LocalPlan } from "../localdb.ts";
import { addDays, dayName, formatDay, localDate, logEaten, slotLabel, summarizeDay, type DaySummary } from "../meals.ts";
import { useApp } from "../store.tsx";
import { EmptyState, navigate, Sheet } from "./common.tsx";
import { Icon } from "./icons.tsx";
import { FeedbackSheet, LogSheet, PlanSheet } from "./MealSheets.tsx";
import { isAdminOf, SubjectChips, useSubject, type Subject } from "./People.tsx";
import { DailyValueNote, NutrientLine } from "./Nutrition.tsx";

function macroText(t: DayTotal | undefined) {
  if (!t || t.amount === null) return "–";
  const v = t.unit === "kcal" ? Math.round(t.amount).toString() : formatQty(t.amount, t.unit);
  return t.status === "partial" ? `≥ ${v}` : v;
}

export function Meals({ date: routeDate }: { date?: string }) {
  const { catalog, allPlans, allLogs, recipes, profiles } = useApp();
  const t = useT();
  const [subject, setSubject] = useSubject();
  // One person at a time: the account's own meals, or a profile's, never mixed in one total.
  const plans = useMemo(() => allPlans.filter((p) => (p.body.profileId ?? null) === subject), [allPlans, subject]);
  const logs = useMemo(() => allLogs.filter((l) => (l.body.profileId ?? null) === subject), [allLogs, subject]);
  const who = profiles.find((p) => p.id === subject)?.name ?? null;
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

  if (catalog.status !== "ready") return <EmptyState title={t("catalog.notReady")}>{catalog.status === "unavailable" ? t("catalog.unavailable") : t("common.loading")}</EmptyState>;
  const go = (d: string) => navigate(d === today ? "/meals" : `/meals/${d}`);
  const recipeFor = (plan: LocalPlan) => recipes.find((r) => r.id === plan.body.recipeId);

  return (
    <div className="screen">
      <div className="day-nav">
        <button type="button" className="icon-btn round" aria-label={range === "day" ? t("meals.prevDay") : t("meals.prevWeek")} onClick={() => go(addDays(date, range === "day" ? -1 : -7))}>
          <Icon name="back" />
        </button>
        <div className="day-title">
          <h1>{range === "day" ? dayName(date, today) : t("meals.last7")}</h1>
          <p>{range === "day" ? formatDay(date) : `${formatDay(addDays(date, -6), { day: "numeric", month: "short" })} – ${formatDay(date, { day: "numeric", month: "short" })}`}</p>
        </div>
        <button type="button" className="icon-btn round" aria-label={range === "day" ? t("meals.nextDay") : t("meals.nextWeek")} onClick={() => go(addDays(date, range === "day" ? 1 : 7))}>
          <Icon name="forward" />
        </button>
      </div>
      <SubjectChips value={subject} onChange={setSubject} />
      <div style={{ display: "flex", justifyContent: "center", marginBottom: 16 }}>
        <div className="segmented" role="tablist" aria-label={t("meals.range")}>
          <button type="button" role="tab" aria-selected={range === "day"} onClick={() => setRange("day")}>
            {t("meals.day")}
          </button>
          <button type="button" role="tab" aria-selected={range === "week"} onClick={() => setRange("week")}>
            {t("meals.sevenDays")}
          </button>
        </div>
      </div>

      {range === "day" ? (
        <>
          {who && <p className="hint" data-testid="meals-for">{t("people.mealsFor", { name: who })}</p>}
          <EatenCard day={day} today={today} onDetails={() => setDetails(true)} />
          <PlannedCard day={day} recipeFor={recipeFor} onLog={setLogging} />
          <div className="sheet-actions">
            <button type="button" className="btn-primary" onClick={() => setPlanning(true)}>
              <Icon name="plus" /> {t("meals.planMeal")}
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
            profileId={subject}
            onClose={() => setLogging(null)}
          />
        ) : null;
      })()}
      {planning && <PickRecipeToPlan date={date} subject={subject} onClose={() => setPlanning(false)} />}
      {details && day.totals && (
        <Sheet title={t("meals.whatYouAte", { day: dayName(date, today) })} onClose={() => setDetails(false)}>
          <p className="hint">{t("meals.sumHint")}</p>
          <ul className="nutrient-list">
            {defs.map((d) => {
              const total = day.totals!.find((x) => x.key === d.key);
              if (!total) return null;
              return (
                <li key={d.key} className="nutrient-row static" data-testid={`day-nutrient-${d.key}`}>
                  <NutrientLine row={total} name={nutrientName(d.key, d.name)} />
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
  if (day.date === today) return translate("meals.inProgress");
  if (day.openPlans.length) return translate("meals.plansNotMarked");
  return day.logs.length ? translate("meals.onlyLogged") : null;
}

function EatenCard({ day, today, onDetails }: { day: DaySummary; today: string; onDetails: () => void }) {
  const { engine, catalog, feedback } = useApp();
  const t = useT();
  const [rating, setRating] = useState<LocalLog | null>(null);
  const badge = dayBadge(day, today);
  const foods = catalog.status === "ready" ? catalog.foods : new Map();
  const defs = catalog.status === "ready" ? catalog.bundle.nutrients : [];
  return (
    <section className="card" aria-labelledby="eaten-title" data-testid="eaten-card">
      <div className="card-head">
        <h2 id="eaten-title">{t("meals.eaten")}</h2>
        {badge && <span className="badge">{badge}</span>}
      </div>
      {day.logs.length === 0 ? (
        <p className="hint">{t(day.date > today ? "meals.nothingEatenYet" : "meals.nothingEaten")}</p>
      ) : (
        <>
          {day.logs.map((log) => (
            <LogRow
              key={log.id}
              log={log}
              feedback={feedback.find((f) => f.id === log.id)}
              kcal={logEaten(log, foods, defs).find((t) => t.key === "energy_kcal")}
              onRemove={() => void engine?.deleteLog(log.id)}
              onFeedback={() => setRating(log)}
            />
          ))}
          <button type="button" className="summary-card card" onClick={onDetails} style={{ textAlign: "left", width: "100%", cursor: "pointer", font: "inherit" }} data-testid="day-totals">
            <span className="card-head" style={{ marginBottom: 0 }}>
              <span className="hint" style={{ margin: 0 }}>
                {t("meals.dayTotal")} · <span className="estimated">{t("common.estimated")}</span>
              </span>
              <span style={{ fontSize: "0.8125rem", fontWeight: 650, color: "var(--sage-ink)" }}>{t("meals.allNutrients")}</span>
            </span>
            <span className="macro-grid">
              {MACROS.map((m) => (
                <span key={m.key}>
                  <span className="macro-value" style={{ display: "block" }}>{macroText(day.totals?.find((t) => t.key === m.key))}</span>
                  <span className="macro-label">{t(m.label)}</span>
                </span>
              ))}
            </span>
          </button>
        </>
      )}
      <p className="fine" style={{ marginTop: 12 }}>
        {t("meals.totalsFine")}
      </p>
      {rating && <FeedbackSheet log={rating} onClose={() => setRating(null)} />}
    </section>
  );
}

function LogRow({
  log,
  feedback,
  kcal,
  onRemove,
  onFeedback,
}: {
  log: LocalLog;
  feedback: LocalFeedback | undefined;
  kcal: { amount: number | null; status: string } | undefined;
  onRemove: () => void;
  onFeedback: () => void;
}) {
  const t = useT();
  const servings = t("common.servings", { n: log.body.servings });
  const state = t(log.state === "synced" ? "sync.synced" : log.state === "rejected" ? "sync.attention" : "sync.savedLocal");
  return (
    <div className="meal-row" data-testid="eaten-row">
      <div>
        <div className="meal-name">{log.body.recipe.title}</div>
        <div className="meal-meta">
          {slotLabel(log.body.slot)} · {servings}
          {kcal?.amount != null ? ` · ${kcal.status === "partial" ? `${t("nutrition.atLeast")} ` : ""}${Math.round(kcal.amount)} kcal` : ""}
        </div>
        {feedback && (
          <div className="meal-meta" data-testid="feedback-summary">
            {feedback.body.rating === "liked" ? t("feedback.liked") : feedback.body.rating === "disliked" ? t("feedback.disliked") : t("feedback.noted")}
            {feedback.body.comment ? `: “${feedback.body.comment}”` : ""}
          </div>
        )}
        {log.state === "rejected" && <div className="meal-meta error">{log.rejection}</div>}
      </div>
      <div className="meal-actions">
        <span className={`state state-${log.state}`}>{state}</span>
        <button type="button" className="btn-link" onClick={onFeedback} aria-label={t("feedback.howWasIt", { title: log.body.recipe.title })}>
          {feedback ? t("feedback.edit") : t("feedback.rate")}
        </button>
        <button type="button" className="icon-btn" aria-label={t("meals.removeEaten", { title: log.body.recipe.title })} onClick={onRemove}>
          <Icon name="close" />
        </button>
      </div>
    </div>
  );
}

function PlannedCard({ day, recipeFor, onLog }: { day: DaySummary; recipeFor: (p: LocalPlan) => { id: string } | undefined; onLog: (p: LocalPlan) => void }) {
  const { engine, groups } = useApp();
  const t = useT();
  return (
    <section className="card card-dashed" aria-labelledby="planned-title" data-testid="planned-card">
      <div className="card-head">
        <h2 id="planned-title">{t("meals.planned")}</h2>
      </div>
      {day.plans.length === 0 && <p className="hint">{t("meals.noPlans")}</p>}
      {day.plans.map((plan) => {
        const done = !day.openPlans.includes(plan);
        const recipe = recipeFor(plan);
        // Planned by a group's admin: only that group's admins change it.
        const managed = !!plan.meta?.groupId && !isAdminOf(groups, plan.meta.groupId);
        const status = plan.meta?.status;
        return (
          <div key={plan.id} className="meal-row" data-testid="planned-row">
            <div>
              <div className="meal-name">{plan.body.title}</div>
              <div className="meal-meta">
                {slotLabel(plan.body.slot)} · {t("common.servings", { n: plan.body.servings })}
                {!recipe && ` · ${t("meals.recipeGone")}`}
              </div>
              {(plan.meta?.groupId && plan.meta.plannedBy) || status === "proposed" || status === "declined" ? (
                <div className="meal-badges">
                  {plan.meta?.groupId && plan.meta.plannedBy && <span className="badge badge-sage" data-testid="planned-by">{t("plan.plannedBy", { name: plan.meta.plannedBy })}</span>}
                  {status === "proposed" && <span className="badge" data-testid="plan-proposed">{t("plan.awaiting")}</span>}
                  {status === "declined" && <span className="badge" data-testid="plan-declined">{t("plan.declined")}</span>}
                </div>
              ) : null}
              {plan.state === "rejected" && <div className="meal-meta error">{plan.rejection}</div>}
              {plan.state === "conflict" && (
                <div className="banner banner-warn" role="alert" style={{ marginTop: 8 }}>
                  <p>{plan.conflictServer ? t("meals.planConflict", { title: plan.conflictServer.title, date: plan.conflictServer.date }) : t("meals.planConflictRemoved")}</p>
                  <div className="banner-actions">
                    <button type="button" className="btn-secondary" onClick={() => void engine?.resolvePlanConflict(plan.id, "mine")}>
                      {t("conflict.keepMine")}
                    </button>
                    <button type="button" className="btn-secondary" onClick={() => void engine?.resolvePlanConflict(plan.id, "cloud")}>
                      {t("conflict.keepCloud")}
                    </button>
                  </div>
                </div>
              )}
            </div>
            <div className="meal-actions">
              {done ? (
                <span className="badge badge-sage">
                  <Icon name="check" size={14} /> {t("meals.eaten")}
                </span>
              ) : (
                <button type="button" className="btn-secondary" disabled={!recipe} onClick={() => onLog(plan)}>
                  {t("meals.iAteThis")}
                </button>
              )}
              {!managed && (
                <button type="button" className="icon-btn" aria-label={t("meals.removePlan", { title: plan.body.title })} onClick={() => void engine?.deletePlan(plan.id)}>
                  <Icon name="close" />
                </button>
              )}
            </div>
          </div>
        );
      })}
      <p className="fine" style={{ marginTop: 12 }}>
        {t("meals.plansNeverCount")}
      </p>
    </section>
  );
}

function WeekList({ week, today, onPick }: { week: DaySummary[]; today: string; onPick: (d: string) => void }) {
  const t = useT();
  const logged = week.filter((d) => d.logs.length > 0).length;
  return (
    <>
      <p className="hint" data-testid="week-summary">
        {logged === 0 ? t("meals.weekNone") : t("meals.weekSome", { n: logged })} {t("meals.weekNever")}
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
                  {d.logs.length ? t("meals.nEaten", { n: d.logs.length }) : t("meals.nothingLogged")}
                  {d.plans.length ? ` · ${t("meals.nPlanned", { n: d.plans.length })}` : ""}
                </span>
                <span style={{ fontWeight: 650 }}>
                  {kcal && kcal.amount !== null ? `${kcal.status === "partial" ? "≥ " : ""}${Math.round(kcal.amount)} kcal` : ""}
                  {d.date === today && <span className="badge" style={{ marginLeft: 8 }}>{t("day.today")}</span>}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </>
  );
}

function PickRecipeToPlan({ date, subject, onClose }: { date: string; subject: Subject; onClose: () => void }) {
  const { recipes } = useApp();
  const t = useT();
  const [picked, setPicked] = useState<string | null>(null);
  const recipe = recipes.find((r) => r.id === picked);
  if (recipe) return <PlanSheet recipeId={recipe.id} title={recipe.body.title} initialDate={date} profileId={subject} onClose={onClose} />;
  return (
    <Sheet title={t("meals.planMeal")} onClose={onClose}>
      {recipes.length === 0 ? (
        <p className="hint">{t("meals.saveFirst")}</p>
      ) : (
        <ul className="food-results" aria-label={t("meals.yourRecipes")}>
          {recipes.map((r) => (
            <li key={r.id}>
              <button type="button" onClick={() => setPicked(r.id)}>
                <span>{r.body.title}</span>
                <small>{t("common.servings", { n: r.body.servings })}</small>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Sheet>
  );
}
