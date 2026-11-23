import { useCallback, useEffect, useState, type ReactNode } from "react";
import type { CookClient, CookMeal, CookMealSummary, CookPrice, CookProfile, CookShoppingList, CookTarget, CookTotals } from "@betterplate/contracts";
import { CURRENCIES } from "@betterplate/contracts";
import { api, ApiRequestError } from "../api.ts";
import { dateLocale, useT } from "../i18n.ts";
import { formatDay, localDate } from "../meals.ts";
import { useApp } from "../store.tsx";
import { EmptyState, navigate, Sheet } from "./common.tsx";
import { FoodPicker } from "./FoodPicker.tsx";
import { Icon } from "./icons.tsx";
import { ReceiptsTab, ShareSheet, StatementsTab } from "./CookBilling.tsx";

// ---------------------------------------------------------------- shared bits

export const money = (cents: number | null | undefined, currency: string) =>
  cents === null || cents === undefined ? "" : (cents / 100).toLocaleString(dateLocale(), { style: "currency", currency });

/** "12.50" → 1250; empty → null. */
export const toCents = (text: string): number | null => {
  const v = text.trim().replace(",", ".");
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
};
export const fromCents = (cents: number | null | undefined) => (cents === null || cents === undefined ? "" : (cents / 100).toFixed(2));

export const minutesText = (m: number) => `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`;

export function useErrors() {
  const t = useT();
  const [error, setError] = useState<string | null>(null);
  const run = useCallback(
    async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
      setError(null);
      try {
        return await fn();
      } catch (err) {
        setError(err instanceof ApiRequestError ? err.message : t("cooking.offline"));
        return undefined;
      }
    },
    [t],
  );
  return { error, setError, run };
}

export function ErrorLine({ error }: { error: string | null }) {
  return error ? (
    <p className="error" role="alert">
      {error}
    </p>
  ) : null;
}

export function TotalsTable({ totals, currency }: { totals: CookTotals; currency: string }) {
  const t = useT();
  return (
    <dl className="cook-totals" data-testid="meal-totals">
      <dt>{t("cooking.groceries")}</dt>
      <dd>{money(totals.groceriesCents, currency)}</dd>
      <dt>{t("cooking.time", { time: minutesText(totals.minutes.total) })}</dt>
      <dd>{money(totals.timeCents, currency)}</dd>
      {totals.expensesCents > 0 && (
        <>
          <dt>{t("cooking.otherCosts")}</dt>
          <dd>{money(totals.expensesCents, currency)}</dd>
        </>
      )}
      {totals.flatFeeCents > 0 && (
        <>
          <dt>{t("cooking.fee")}</dt>
          <dd>{money(totals.flatFeeCents, currency)}</dd>
        </>
      )}
      <dt className="total">{t("cooking.total")}</dt>
      <dd className="total" data-testid="meal-total">
        {money(totals.totalCents, currency)}
      </dd>
    </dl>
  );
}

const targetLabel = (t: ReturnType<typeof useT>, target: { kind: string; name: string }) => (target.kind === "me" ? t("cooking.forMe") : target.name);

let knownCook: boolean | undefined;

/** Whether the signed-in person has set up cooking for others; asked once per page load. */
export function useIsCook(enabled: boolean): boolean {
  const [isCook, setIsCook] = useState(knownCook ?? false);
  useEffect(() => {
    if (!enabled || knownCook !== undefined) return;
    api.cook.profile().then(
      (s) => setIsCook((knownCook = !!s.profile)),
      () => {},
    );
  }, [enabled]);
  return enabled && isCook;
}

// ---------------------------------------------------------------- "Cooking for" picker

/**
 * Shown when a cook taps Cook on a recipe: who it's for. Each choice says what the cook may know
 * about allergies (names only where they may see them). "Just cook" keeps the old behaviour.
 */
export function CookingForSheet({ recipe, onClose }: { recipe: { id: string; title: string; servings: number }; onClose: () => void }) {
  const t = useT();
  const [targets, setTargets] = useState<CookTarget[] | null>(null);
  const [picked, setPicked] = useState<CookTarget | null>(null);
  const [servings, setServings] = useState(recipe.servings);
  const { error, run } = useErrors();
  useEffect(() => void run(async () => setTargets((await api.cook.targets()).targets)), [run]);

  async function start() {
    if (!picked) return;
    const id = crypto.randomUUID();
    const meal = await run(() =>
      api.cook.startMeal({ id, name: recipe.title, cookedOn: localDate(), target: { kind: picked.kind, groupId: picked.groupId, memberId: picked.memberId, clientId: picked.clientId }, recipeId: recipe.id, servings }),
    );
    if (!meal) return;
    await run(() => api.cook.timer(meal.id, "start"));
    navigate(`/cook/${recipe.id}/meal/${meal.id}`);
  }

  return (
    <Sheet title={t("cooking.forWho")} onClose={onClose}>
      <p className="hint">{t("cooking.forWhoHint")}</p>
      {!targets && !error && <p className="hint">{t("common.loading")}</p>}
      {targets && (
        <ul className="cook-target-list" data-testid="cooking-for">
          {targets.map((x) => (
            <li key={x.key}>
              <button type="button" className={`target${picked?.key === x.key ? " picked" : ""}`} aria-pressed={picked?.key === x.key} onClick={() => setPicked(x)}>
                <span className="target-name">
                  {targetLabel(t, x)}
                  {x.groupName && <small> · {x.groupName}</small>}
                  {x.kind === "client" && <small> · {t("cooking.client")}</small>}
                </span>
                <AllergyLine info={x.info} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {picked && (
        <div className="field">
          <label htmlFor="cook-servings">{t("cooking.servings")}</label>
          <input id="cook-servings" type="number" min={0.5} step="any" inputMode="decimal" value={servings} onChange={(e) => setServings(Number(e.target.value) || recipe.servings)} />
        </div>
      )}
      <ErrorLine error={error} />
      <div className="stack">
        <button type="button" className="btn-primary" disabled={!picked} onClick={() => void start()} data-testid="cooking-start">
          {t("cooking.startCooking")}
        </button>
        <a className="btn-link" href={`#/cook/${recipe.id}`}>
          {t("cooking.justCook")}
        </a>
      </div>
    </Sheet>
  );
}

export function AllergyLine({ info }: { info: CookTarget["info"] }) {
  const t = useT();
  if (info.anonymous) {
    return <small className="allergy">{info.allergens.length ? t("cooking.groupAllergens", { list: info.allergens.join(", ") }) : t("cooking.noAllergensKnown")}</small>;
  }
  const lines = info.people.flatMap((p) => {
    const parts = [p.allergens.length ? p.allergens.join(", ") : p.allergyAnswer === "none" ? t("cooking.noAllergies") : p.allergyAnswer === "unknown" ? t("cooking.notAsked") : t("cooking.notSaid")];
    if (p.notes) parts.push(p.notes);
    return [`${p.name}: ${parts.join(" · ")}`];
  });
  return (
    <small className="allergy" data-testid="target-allergies">
      {lines.join(" — ")}
    </small>
  );
}

// ---------------------------------------------------------------- timer bar inside cook mode

export function MealTimerBar({ mealId }: { mealId: string }) {
  const t = useT();
  const [meal, setMeal] = useState<CookMeal | null>(null);
  const { error, run } = useErrors();
  useEffect(() => void run(async () => setMeal(await api.cook.meal(mealId))), [mealId, run]);
  if (!meal) return error ? <p className="cook-muted">{error}</p> : null;
  return (
    <div className="cook-meal-bar" data-testid="meal-timer">
      <div>
        <div className="cook-muted">{t("cooking.cookingFor", { name: targetLabel(t, meal.target) })}</div>
        <div className="cook-clock" role="timer" aria-live="off">
          <LiveClock key={`${meal.cookingSeconds}:${meal.timerStartedAt ?? ""}`} base={meal.cookingSeconds} running={meal.timerRunning} />
        </div>
      </div>
      <div className="cook-timer-actions">
        <button type="button" className="cook-ghost" onClick={() => void run(async () => setMeal(await api.cook.timer(mealId, meal.timerRunning ? "pause" : "start")))}>
          {meal.timerRunning ? t("cook.pause") : t("cooking.resume")}
        </button>
        <button
          type="button"
          className="cook-light"
          onClick={() =>
            void run(async () => {
              await api.cook.timer(mealId, "stop");
              navigate(`/cooking/meal/${mealId}`);
            })
          }
          data-testid="meal-timer-done"
        >
          {t("cooking.doneCooking")}
        </button>
      </div>
    </div>
  );
}

/** Seconds the server had counted when the meal loaded, plus what has run on this screen since. */
function LiveClock({ base, running }: { base: number; running: boolean }) {
  const [loadedAt] = useState(() => Date.now());
  const [now, setNow] = useState(loadedAt);
  useEffect(() => {
    if (!running) return;
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, [running]);
  const s = base + (running ? Math.max(0, Math.floor((now - loadedAt) / 1000)) : 0);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return <>{`${h}:${String(m).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`}</>;
}

// ---------------------------------------------------------------- cooking home

type Tab = "meals" | "clients" | "receipts" | "statements" | "prices" | "profile";

export function CookingHome({ tab }: { tab: Tab }) {
  const t = useT();
  const { online } = useApp();
  const [profile, setProfile] = useState<CookProfile | null | undefined>(undefined);
  const [invites, setInvites] = useState(false);
  const { error, run } = useErrors();
  useEffect(
    () =>
      void run(async () => {
        const s = await api.cook.profile();
        setProfile(s.profile);
        setInvites(s.features.clientInvites);
      }),
    [run],
  );

  if (profile === undefined) return <EmptyState title={t("cooking.title")}>{error ?? t("common.loading")}</EmptyState>;
  if (!online && !profile) return <EmptyState title={t("cooking.title")}>{t("cooking.offline")}</EmptyState>;
  if (!profile || tab === "profile") {
    return (
      <div className="screen">
        <header className="screen-head">
          <div>
            <p className="eyebrow">{t("nav.you")}</p>
            <h1>{profile ? t("cooking.profile") : t("cooking.setUpTitle")}</h1>
          </div>
        </header>
        {!profile && <p className="hint">{t("cooking.setUpIntro")}</p>}
        <ProfileForm profile={profile} onSaved={(p) => { setProfile(p); navigate("/cooking"); }} />
      </div>
    );
  }

  const tabs: [Tab, string][] = [
    ["meals", t("cooking.meals")],
    ["clients", t("cooking.clients")],
    ["receipts", t("cooking.receipts")],
    ["statements", t("cooking.statements")],
    ["prices", t("cooking.prices")],
  ];
  return (
    <div className="screen">
      <header className="screen-head">
        <div>
          <p className="eyebrow">{t("cooking.title")}</p>
          <h1 data-private>{profile.businessName || t("cooking.title")}</h1>
        </div>
        <a className="btn-link" href="#/cooking/profile">
          {t("cooking.editProfile")}
        </a>
      </header>
      <div className="choice-row" role="tablist" aria-label={t("cooking.title")}>
        {tabs.map(([key, label]) => (
          <button key={key} type="button" role="tab" aria-selected={tab === key} aria-pressed={tab === key} onClick={() => navigate(key === "meals" ? "/cooking" : `/cooking/${key}`)}>
            {label}
          </button>
        ))}
      </div>
      {tab === "meals" && <MealsTab currency={profile.currency} />}
      {tab === "clients" && <ClientsTab currency={profile.currency} invites={invites} />}
      {tab === "receipts" && <ReceiptsTab currency={profile.currency} />}
      {tab === "statements" && <StatementsTab currency={profile.currency} />}
      {tab === "prices" && <PricesTab currency={profile.currency} />}
    </div>
  );
}

function ProfileForm({ profile, onSaved }: { profile: CookProfile | null; onSaved: (p: CookProfile) => void }) {
  const t = useT();
  const [name, setName] = useState(profile?.businessName ?? "");
  const [currency, setCurrency] = useState<string>(profile?.currency ?? "USD");
  const [rate, setRate] = useState(fromCents(profile?.hourlyRateCents));
  const [fee, setFee] = useState(fromCents(profile?.flatFeeCents));
  const { error, run } = useErrors();
  async function save() {
    const s = await run(() => api.cook.saveProfile({ businessName: name, currency: currency as CookProfile["currency"], hourlyRateCents: toCents(rate), flatFeeCents: toCents(fee) }));
    if (s?.profile) {
      knownCook = true;
      onSaved(s.profile);
    }
  }
  return (
    <section className="card" data-testid="cook-profile-form">
      <div className="field">
        <label htmlFor="cook-name">{t("cooking.businessName")}</label>
        <input id="cook-name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder={t("cooking.businessNameHint")} />
      </div>
      <div className="field">
        <label htmlFor="cook-currency">{t("cooking.currency")}</label>
        <select id="cook-currency" value={currency} onChange={(e) => setCurrency(e.target.value)}>
          {CURRENCIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor="cook-rate">{t("cooking.hourlyRate")}</label>
        <input id="cook-rate" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} placeholder="0.00" />
      </div>
      <div className="field">
        <label htmlFor="cook-fee">{t("cooking.flatFee")}</label>
        <input id="cook-fee" inputMode="decimal" value={fee} onChange={(e) => setFee(e.target.value)} placeholder="0.00" />
      </div>
      <p className="fine">{t("cooking.noTaxNote")}</p>
      <ErrorLine error={error} />
      <button type="button" className="btn-primary" onClick={() => void save()}>
        {profile ? t("cooking.save") : t("cooking.setUp")}
      </button>
    </section>
  );
}

// ---------------------------------------------------------------- meals

function MealsTab({ currency }: { currency: string }) {
  const t = useT();
  const [meals, setMeals] = useState<CookMealSummary[] | null>(null);
  const [adding, setAdding] = useState(false);
  const { error, run } = useErrors();
  useEffect(() => void run(async () => setMeals((await api.cook.meals()).meals)), [run]);
  return (
    <section data-testid="cook-meals">
      <div className="stack">
        <button type="button" className="btn-secondary" onClick={() => setAdding(true)}>
          <Icon name="plus" size={18} /> {t("cooking.newMeal")}
        </button>
      </div>
      <ErrorLine error={error} />
      {meals && !meals.length && <p className="hint">{t("cooking.noMeals")}</p>}
      <ul className="row-list">
        {meals?.map((m) => <MealRow key={m.id} meal={m} currency={currency} />)}
      </ul>
      {adding && <NewMealSheet onClose={() => setAdding(false)} />}
    </section>
  );
}

export function MealRow({ meal, currency, action }: { meal: CookMealSummary; currency: string; action?: ReactNode }) {
  const t = useT();
  return (
    <li>
      <a className="row-item row-link" href={`#/cooking/meal/${meal.id}`} data-testid="cook-meal-row">
        <span className="row-text">
          <span className="row-label">{meal.name}</span>
          <span className="row-value">
            {formatDay(meal.cookedOn, { day: "numeric", month: "short", year: "numeric" })} · {targetLabel(t, meal.target)}
            {meal.statementId ? ` · ${t("cooking.onStatement")}` : ""}
            {meal.timerRunning ? ` · ${t("cooking.timerOn")}` : ""}
          </span>
        </span>
        <span className="row-amount">{money(meal.totals.totalCents, currency)}</span>
        {action}
      </a>
    </li>
  );
}

function NewMealSheet({ onClose }: { onClose: () => void }) {
  const t = useT();
  const [targets, setTargets] = useState<CookTarget[] | null>(null);
  const [key, setKey] = useState("me");
  const [name, setName] = useState("");
  const [date, setDate] = useState(localDate());
  const { error, run } = useErrors();
  useEffect(() => void run(async () => setTargets((await api.cook.targets()).targets)), [run]);
  async function create() {
    const target = targets?.find((x) => x.key === key);
    if (!target || !name.trim()) return;
    const meal = await run(() => api.cook.startMeal({ id: crypto.randomUUID(), name: name.trim(), cookedOn: date, target: { kind: target.kind, groupId: target.groupId, memberId: target.memberId, clientId: target.clientId } }));
    if (meal) navigate(`/cooking/meal/${meal.id}`);
  }
  return (
    <Sheet title={t("cooking.newMeal")} onClose={onClose}>
      <div className="field">
        <label htmlFor="meal-name">{t("cooking.mealName")}</label>
        <input id="meal-name" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} placeholder={t("cooking.mealNameHint")} />
      </div>
      <div className="field">
        <label htmlFor="meal-date">{t("cooking.date")}</label>
        <input id="meal-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="meal-for">{t("cooking.forWho")}</label>
        <select id="meal-for" value={key} onChange={(e) => setKey(e.target.value)}>
          {targets?.map((x) => (
            <option key={x.key} value={x.key}>
              {targetLabel(t, x)}
              {x.groupName ? ` (${x.groupName})` : ""}
            </option>
          ))}
        </select>
      </div>
      {targets?.find((x) => x.key === key) && <AllergyLine info={targets.find((x) => x.key === key)!.info} />}
      <ErrorLine error={error} />
      <button type="button" className="btn-primary" disabled={!name.trim() || !targets} onClick={() => void create()}>
        {t("cooking.create")}
      </button>
    </Sheet>
  );
}

export function CookMealScreen({ id }: { id: string }) {
  const t = useT();
  const { recipes } = useApp();
  const [meal, setMeal] = useState<CookMeal | null>(null);
  const [sheet, setSheet] = useState<null | "recipe" | "expense" | "share" | "shopping">(null);
  const [minutes, setMinutes] = useState({ cooking: "", shopping: "", travel: "" });
  const { error, run } = useErrors();
  const load = useCallback((m: CookMeal) => {
    setMeal(m);
    setMinutes({ cooking: String(Math.round(m.cookingSeconds / 60)), shopping: String(m.shoppingMinutes), travel: String(m.travelMinutes) });
  }, []);
  useEffect(() => void run(async () => load(await api.cook.meal(id))), [id, run, load]);
  if (!meal) return <EmptyState title={t("cooking.meal")}>{error ?? t("common.loading")}</EmptyState>;
  const c = meal.currency;
  const update = (body: Parameters<typeof api.cook.updateMeal>[1]) => void run(async () => load(await api.cook.updateMeal(id, body)));

  return (
    <div className="screen" data-testid="cook-meal">
      <header className="screen-head">
        <div>
          <p className="eyebrow">
            <a href="#/cooking">{t("cooking.title")}</a> · {targetLabel(t, meal.target)}
          </p>
          <h1>{meal.name}</h1>
          <p className="hint">{formatDay(meal.cookedOn)}</p>
        </div>
      </header>
      {meal.locked && <p className="banner banner-info">{t("cooking.lockedNote")}</p>}
      <ErrorLine error={error} />

      <section className="card">
        <TotalsTable totals={meal.totals} currency={c} />
        {meal.totals.unpricedIngredients > 0 && <p className="fine">{t("cooking.unpriced", { n: meal.totals.unpricedIngredients })}</p>}
        <div className="stack">
          <button type="button" className="btn-primary" onClick={() => setSheet("share")} data-testid="meal-share">
            <Icon name="share" size={18} /> {meal.shared ? t("cooking.sharedUpdate") : t("cooking.share")}
          </button>
        </div>
      </section>

      <section className="card" aria-labelledby="meal-recipes">
        <h2 id="meal-recipes">{t("cooking.recipes")}</h2>
        {!meal.recipes.length && <p className="hint">{t("cooking.noRecipes")}</p>}
        {meal.recipes.map((r) => (
          <div key={r.id} className="cook-recipe" data-testid="meal-recipe">
            <div className="cook-recipe-head">
              <strong>{r.title}</strong> <small>{t("common.servings", { n: r.servings })}</small>
              {!meal.locked && (
                <button type="button" className="btn-link" onClick={() => void run(async () => load(await api.cook.removeMealRecipe(id, r.id)))}>
                  {t("cooking.remove")}
                </button>
              )}
            </div>
            <ul className="cook-ingredients">
              {r.ingredients.map((i) => (
                <li key={i.foodId}>
                  <span>
                    {i.description}
                    {i.grams !== null && <small> · {Math.round(i.grams)} g</small>}
                  </span>
                  <span className={`cost cost-${i.source}`}>{i.source === "receipt" ? t("cooking.onReceipt") : i.source === "none" ? t("cooking.noPrice") : money(i.costCents, c)}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
        {!meal.locked && (
          <div className="choice-row">
            <button type="button" onClick={() => setSheet("recipe")}>{t("cooking.addRecipe")}</button>
            <button type="button" onClick={() => setSheet("shopping")}>{t("cooking.shoppingList")}</button>
          </div>
        )}
      </section>

      <section className="card" aria-labelledby="meal-time">
        <h2 id="meal-time">{t("cooking.timeSpent")}</h2>
        <p className="hint" data-testid="meal-timer-state">
          {meal.timerRunning ? t("cooking.timerRunning") : t("cooking.timerStopped")}
        </p>
        {!meal.locked && (
          <div className="choice-row">
            <button type="button" onClick={() => void run(async () => load(await api.cook.timer(id, meal.timerRunning ? "pause" : "start")))}>
              {meal.timerRunning ? t("cook.pause") : t("cooking.startTimer")}
            </button>
          </div>
        )}
        <div className="cook-minutes">
          {(["cooking", "shopping", "travel"] as const).map((k) => (
            <div className="field" key={k}>
              <label htmlFor={`min-${k}`}>{k === "cooking" ? t("cooking.minCooking") : k === "shopping" ? t("cooking.minShopping") : t("cooking.minTravel")}</label>
              <input id={`min-${k}`} type="number" min={0} inputMode="numeric" disabled={meal.locked} value={minutes[k]} onChange={(e) => setMinutes({ ...minutes, [k]: e.target.value })} />
            </div>
          ))}
        </div>
        {!meal.locked && (
          <button
            type="button"
            className="btn-secondary"
            onClick={() => update({ cookingMinutes: Number(minutes.cooking) || 0, shoppingMinutes: Number(minutes.shopping) || 0, travelMinutes: Number(minutes.travel) || 0 })}
          >
            {t("cooking.saveTime")}
          </button>
        )}
        <RateField meal={meal} onSave={(hourlyRateCents) => update({ hourlyRateCents })} />
      </section>

      <section className="card" aria-labelledby="meal-groceries">
        <h2 id="meal-groceries">{t("cooking.groceries")}</h2>
        {!meal.receiptLines.length && <p className="hint">{t("cooking.noReceiptLines")}</p>}
        <ul className="cook-ingredients">
          {meal.receiptLines.map((l) => (
            <li key={l.id}>
              <a href={`#/cooking/receipt/${l.receiptId}`}>
                {l.text} <small>· {l.store}</small>
              </a>
              <span>{money(l.priceCents + l.taxCents, c)}</span>
            </li>
          ))}
        </ul>
        <a className="btn-link" href="#/cooking/receipts">{t("cooking.addReceipt")}</a>
      </section>

      <section className="card" aria-labelledby="meal-expenses">
        <h2 id="meal-expenses">{t("cooking.otherCosts")}</h2>
        <ul className="cook-ingredients">
          {meal.expenses.map((e) => (
            <li key={e.id}>
              <span>{e.label}</span>
              <span>
                {money(e.amountCents, c)}{" "}
                {!meal.locked && (
                  <button type="button" className="btn-link" aria-label={t("cooking.remove")} onClick={() => void run(async () => load(await api.cook.removeExpense(id, e.id)))}>
                    <Icon name="close" size={14} />
                  </button>
                )}
              </span>
            </li>
          ))}
        </ul>
        {!meal.locked && <button type="button" className="btn-link" onClick={() => setSheet("expense")}>{t("cooking.addCost")}</button>}
      </section>

      <section className="card" aria-labelledby="meal-notes">
        <h2 id="meal-notes">{t("cooking.notes")}</h2>
        <NotesField meal={meal} onSave={(notes) => update({ notes })} />
      </section>

      {!meal.locked && (
        <button
          type="button"
          className="btn-link danger"
          onClick={() => {
            if (confirm(t("cooking.deleteMealConfirm"))) void run(async () => { await api.cook.deleteMeal(id); navigate("/cooking"); });
          }}
        >
          {t("cooking.deleteMeal")}
        </button>
      )}

      {sheet === "recipe" && (
        <Sheet title={t("cooking.addRecipe")} onClose={() => setSheet(null)}>
          <AddRecipe recipes={recipes.map((r) => ({ id: r.id, title: r.body.title, servings: r.body.servings }))} onAdd={(recipeId, servings) => void run(async () => { load(await api.cook.addMealRecipe(id, recipeId, servings)); setSheet(null); })} />
        </Sheet>
      )}
      {sheet === "expense" && (
        <Sheet title={t("cooking.addCost")} onClose={() => setSheet(null)}>
          <AddExpense onAdd={(label, cents) => void run(async () => { load(await api.cook.addExpense(id, label, cents)); setSheet(null); })} />
        </Sheet>
      )}
      {sheet === "shopping" && <ShoppingSheet id={id} onClose={() => setSheet(null)} />}
      {sheet === "share" && <ShareSheet kind="meal" id={id} onClose={() => setSheet(null)} onChanged={() => void run(async () => load(await api.cook.meal(id)))} />}
    </div>
  );
}

function RateField({ meal, onSave }: { meal: CookMeal; onSave: (cents: number | null) => void }) {
  const t = useT();
  const [rate, setRate] = useState(fromCents(meal.hourlyRateCents));
  return (
    <div className="field inline-field">
      <label htmlFor="meal-rate">{t("cooking.hourlyRate")}</label>
      <input id="meal-rate" inputMode="decimal" value={rate} disabled={meal.locked} onChange={(e) => setRate(e.target.value)} onBlur={() => toCents(rate) !== meal.hourlyRateCents && onSave(toCents(rate))} placeholder="0.00" />
    </div>
  );
}

function NotesField({ meal, onSave }: { meal: CookMeal; onSave: (notes: string) => void }) {
  const t = useT();
  const [notes, setNotes] = useState(meal.notes);
  return (
    <>
      <label className="sr-only" htmlFor="meal-notes-text">{t("cooking.notes")}</label>
      <textarea id="meal-notes-text" rows={3} maxLength={2000} value={notes} disabled={meal.locked} onChange={(e) => setNotes(e.target.value)} onBlur={() => notes !== meal.notes && onSave(notes)} />
      <p className="fine">{t("cooking.notesPrivate")}</p>
    </>
  );
}

function AddRecipe({ recipes, onAdd }: { recipes: { id: string; title: string; servings: number }[]; onAdd: (id: string, servings: number) => void }) {
  const t = useT();
  const [id, setId] = useState(recipes[0]?.id ?? "");
  const picked = recipes.find((r) => r.id === id);
  const [servings, setServings] = useState(picked?.servings ?? 2);
  if (!recipes.length) return <p className="hint">{t("cooking.noRecipesYet")}</p>;
  return (
    <>
      <div className="field">
        <label htmlFor="add-recipe">{t("cooking.recipe")}</label>
        <select id="add-recipe" value={id} onChange={(e) => { setId(e.target.value); setServings(recipes.find((r) => r.id === e.target.value)?.servings ?? 2); }}>
          {recipes.map((r) => (
            <option key={r.id} value={r.id}>
              {r.title}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor="add-servings">{t("cooking.servings")}</label>
        <input id="add-servings" type="number" min={0.5} step="any" value={servings} onChange={(e) => setServings(Number(e.target.value) || 1)} />
      </div>
      <button type="button" className="btn-primary" onClick={() => onAdd(id, servings)}>
        {t("cooking.add")}
      </button>
    </>
  );
}

function AddExpense({ onAdd }: { onAdd: (label: string, cents: number) => void }) {
  const t = useT();
  const [label, setLabel] = useState("");
  const [amount, setAmount] = useState("");
  const cents = toCents(amount);
  return (
    <>
      <div className="field">
        <label htmlFor="exp-label">{t("cooking.costWhat")}</label>
        <input id="exp-label" value={label} maxLength={120} onChange={(e) => setLabel(e.target.value)} placeholder={t("cooking.costHint")} />
      </div>
      <div className="field">
        <label htmlFor="exp-amount">{t("cooking.amount")}</label>
        <input id="exp-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />
      </div>
      <button type="button" className="btn-primary" disabled={!label.trim() || cents === null || cents < 0} onClick={() => onAdd(label.trim(), cents!)}>
        {t("cooking.add")}
      </button>
    </>
  );
}

function ShoppingSheet({ id, onClose }: { id: string; onClose: () => void }) {
  const t = useT();
  const [list, setList] = useState<CookShoppingList | null>(null);
  const { error, run } = useErrors();
  useEffect(() => void run(async () => setList(await api.cook.shoppingList(id))), [id, run]);
  return (
    <Sheet title={t("cooking.shoppingList")} onClose={onClose}>
      <ErrorLine error={error} />
      {list && (
        <>
          <ul className="cook-ingredients" data-testid="cook-shopping">
            {list.items.map((i) => (
              <li key={i.foodId} className={i.bought ? "done" : ""}>
                <span>
                  {i.description}
                  {i.grams !== null && <small> · {i.grams} g</small>}
                </span>
                <span>{i.bought ? t("cooking.bought") : i.estimateCents === null ? "" : money(i.estimateCents, list.currency)}</span>
              </li>
            ))}
          </ul>
          <p className="hint">{t("cooking.estimate", { amount: money(list.estimateCents, list.currency) })}</p>
        </>
      )}
    </Sheet>
  );
}

// ---------------------------------------------------------------- clients

function ClientsTab({ currency, invites }: { currency: string; invites: boolean }) {
  const t = useT();
  const [clients, setClients] = useState<CookClient[] | null>(null);
  const [editing, setEditing] = useState<CookClient | "new" | null>(null);
  const { error, run } = useErrors();
  const reload = useCallback(() => void run(async () => setClients((await api.cook.clients()).clients)), [run]);
  useEffect(reload, [reload]);
  return (
    <section data-testid="cook-clients">
      <p className="hint">{t("cooking.clientsIntro")}</p>
      <div className="stack">
        <button type="button" className="btn-secondary" onClick={() => setEditing("new")}>
          <Icon name="plus" size={18} /> {t("cooking.addClient")}
        </button>
      </div>
      <ErrorLine error={error} />
      <ul className="row-list">
        {clients?.map((c) => (
          <li key={c.id}>
            <button type="button" className="row-item row-link" onClick={() => setEditing(c)} data-testid="cook-client-row">
              <span className="row-icon"><Icon name="user" size={20} /></span>
              <span className="row-text">
                <span className="row-label">{c.name}</span>
                <span className="row-value">
                  {c.linked ? t("cooking.linked") : c.inviteEmail ? t("cooking.invitedAt", { email: c.inviteEmail }) : t("cooking.notInApp")}
                  {c.hourlyRateCents !== null ? ` · ${t("cooking.perHour", { amount: money(c.hourlyRateCents, currency) })}` : ""}
                </span>
              </span>
              <Icon name="forward" size={18} />
            </button>
          </li>
        ))}
      </ul>
      {editing && <ClientSheet client={editing === "new" ? null : editing} invites={invites} onClose={() => setEditing(null)} onChanged={reload} />}
    </section>
  );
}

function ClientSheet({ client, invites, onClose, onChanged }: { client: CookClient | null; invites: boolean; onClose: () => void; onChanged: () => void }) {
  const t = useT();
  const [name, setName] = useState(client?.name ?? "");
  const [notes, setNotes] = useState(client?.notes ?? "");
  const [rate, setRate] = useState(fromCents(client?.hourlyRateCents));
  const [email, setEmail] = useState("");
  const [current, setCurrent] = useState(client);
  const [note, setNote] = useState<string | null>(null);
  const { error, run } = useErrors();
  async function save() {
    const body = { name: name.trim(), notes, hourlyRateCents: toCents(rate) };
    const saved = await run(() => (current ? api.cook.saveClient(current.id, body) : api.cook.addClient(body)));
    if (!saved) return;
    setCurrent(saved);
    onChanged();
    if (!current) onClose();
  }
  return (
    <Sheet title={client ? client.name : t("cooking.addClient")} onClose={onClose}>
      <div className="field">
        <label htmlFor="client-name">{t("cooking.clientName")}</label>
        <input id="client-name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="client-notes">{t("cooking.clientNotes")}</label>
        <textarea id="client-notes" rows={3} maxLength={2000} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={t("cooking.clientNotesHint")} />
      </div>
      <div className="field">
        <label htmlFor="client-rate">{t("cooking.clientRate")}</label>
        <input id="client-rate" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} placeholder={t("cooking.clientRateHint")} />
      </div>
      <button type="button" className="btn-primary" disabled={!name.trim()} onClick={() => void save()}>
        {t("cooking.save")}
      </button>
      {current && invites && !current.linked && (
        <section className="stack" data-testid="client-invite">
          <h3>{t("cooking.inviteTitle")}</h3>
          <p className="hint">{t("cooking.inviteIntro")}</p>
          {current.inviteEmail ? (
            <>
              <p className="hint">{t("cooking.invitedAt", { email: current.inviteEmail })}</p>
              <button type="button" className="btn-link" onClick={() => void run(async () => { setCurrent(await api.cook.uninviteClient(current.id)); onChanged(); })}>
                {t("cooking.takeBackInvite")}
              </button>
            </>
          ) : (
            <>
              <label htmlFor="client-email">{t("cooking.inviteEmail")}</label>
              <input id="client-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
              <button
                type="button"
                className="btn-secondary"
                disabled={!/^\S+@\S+\.\S+$/.test(email)}
                onClick={() => void run(async () => { setCurrent(await api.cook.inviteClient(current.id, email)); setNote(t("cooking.inviteSent")); onChanged(); })}
              >
                {t("cooking.sendInvite")}
              </button>
            </>
          )}
        </section>
      )}
      {current?.linked && <p className="hint">{t("cooking.linkedNote")}</p>}
      {note && <p className="hint" role="status">{note}</p>}
      <ErrorLine error={error} />
      {current && (
        <button type="button" className="btn-link danger" onClick={() => void run(async () => { await api.cook.removeClient(current.id); onChanged(); onClose(); })}>
          {t("cooking.removeClient")}
        </button>
      )}
    </Sheet>
  );
}

// ---------------------------------------------------------------- prices

function PricesTab({ currency }: { currency: string }) {
  const t = useT();
  const { catalog, online } = useApp();
  const [prices, setPrices] = useState<CookPrice[] | null>(null);
  const [picking, setPicking] = useState(false);
  const { error, run } = useErrors();
  const reload = useCallback(() => void run(async () => setPrices((await api.cook.prices()).prices)), [run]);
  useEffect(reload, [reload]);
  return (
    <section data-testid="cook-prices">
      <p className="hint">{t("cooking.pricesIntro")}</p>
      <ErrorLine error={error} />
      <ul className="row-list">
        {prices?.map((p) => (
          <li key={p.foodId} className="row-item">
            <span className="row-text">
              <span className="row-label">{p.description}</span>
              <span className="row-value">
                {t("cooking.perKg", { amount: money(Math.round(p.centsPerKg), currency) })} · {p.source === "receipt" ? t("cooking.fromReceipt") : t("cooking.typedIn")}
              </span>
            </span>
            <PriceEdit price={p} onSave={(cents) => void run(async () => { await api.cook.setPrice(p.foodId, cents); reload(); })} />
            <button type="button" className="btn-link" aria-label={t("cooking.remove")} onClick={() => void run(async () => { await api.cook.removePrice(p.foodId); reload(); })}>
              <Icon name="close" size={14} />
            </button>
          </li>
        ))}
      </ul>
      {prices && !prices.length && <p className="hint">{t("cooking.noPrices")}</p>}
      {catalog.status === "ready" && (
        <button type="button" className="btn-secondary" onClick={() => setPicking(true)}>
          {t("cooking.addPrice")}
        </button>
      )}
      {picking && catalog.status === "ready" && (
        <Sheet title={t("cooking.addPrice")} onClose={() => setPicking(false)}>
          <FoodPicker
            foods={catalog.foods}
            online={online}
            onPick={(food) => {
              const v = prompt(t("cooking.pricePrompt", { food: food.description }));
              const cents = v === null ? null : toCents(v);
              setPicking(false);
              if (cents !== null && cents >= 0) void run(async () => { await api.cook.setPrice(food.id, cents); reload(); });
            }}
          />
        </Sheet>
      )}
    </section>
  );
}

function PriceEdit({ price, onSave }: { price: CookPrice; onSave: (cents: number) => void }) {
  const t = useT();
  const [v, setV] = useState(fromCents(Math.round(price.centsPerKg)));
  return (
    <>
      <label className="sr-only" htmlFor={`price-${price.foodId}`}>{t("cooking.perKgLabel")}</label>
      <input
        id={`price-${price.foodId}`}
        className="price-input"
        inputMode="decimal"
        value={v}
        onChange={(e) => setV(e.target.value)}
        onBlur={() => {
          const c = toCents(v);
          if (c !== null && c !== Math.round(price.centsPerKg)) onSave(c);
        }}
      />
    </>
  );
}
