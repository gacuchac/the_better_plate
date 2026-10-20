import { useAiSettings } from "./Companion.tsx";
import { imageUrl } from "../api.ts";
import { useEffect, useMemo, useState } from "react";
import { calculateRecipe, type FoodRecord } from "@betterplate/nutrition";
import { ApiRequestError, api } from "../api.ts";
import { storageInfo, type LocalRecipe } from "../localdb.ts";
import type { SyncStatus } from "../sync.ts";
import { useApp, useSyncStatus } from "../store.tsx";
import { localDate, formatDay } from "../meals.ts";
import { downloadJson, EmptyState, navigate, Sheet } from "./common.tsx";
import { Icon } from "./icons.tsx";
import { EnglishNamesNote, NotInCatalog, searchFoods } from "./FoodPicker.tsx";
import { LanguagePicker } from "./LanguagePicker.tsx";
import { PeriodTotals } from "./Goals.tsx";
import { isActive } from "../goals.ts";
import { dateLocale, formatQty, nutrientName, t as translate, useT, type MessageKey } from "../i18n.ts";

const STATE_LABEL: Record<LocalRecipe["state"], MessageKey> = {
  synced: "sync.synced",
  pending: "sync.savedLocal",
  conflict: "sync.attention",
  rejected: "sync.attention",
};

const SYNC_WORDS: Record<SyncStatus, MessageKey> = {
  "saved-local": "sync.savedLocal",
  syncing: "sync.syncing",
  synced: "sync.synced",
  attention: "sync.attention",
  offline: "sync.offline",
  "signed-out": "sync.signIn",
};

function greeting(d = new Date()) {
  const h = d.getHours();
  return translate(h < 12 ? "kitchen.morning" : h < 18 ? "kitchen.afternoon" : "kitchen.evening");
}

export function Kitchen() {
  const { recipes, catalog, account, plans, logs, preferences, kitchenLoaded } = useApp();
  // Asked until the person answers (any answer, including "I'd rather not say").
  const askAllergies = kitchenLoaded && account && !preferences.some((p) => p.id === account.id);
  const t = useT();
  const today = localDate();
  const planned = plans.filter((p) => p.body.date === today).length;
  const eaten = logs.filter((l) => l.body.localDate === today).length;
  const count = (n: number) => t("kitchen.meals", { n });
  return (
    <div className="screen">
      <header className="home-head">
        <div>
          <p className="eyebrow">{t("kitchen.eyebrow")}</p>
          <h1 className="greeting">
            {greeting()}
            {account?.displayName ? `, ${account.displayName.split(" ")[0]}` : ""}
          </h1>
        </div>
      </header>

      <a className="card today-card" href="#/meals" data-testid="today-card">
        <div className="card-head" style={{ marginBottom: 0 }}>
          <h2>{t("day.today")}</h2>
          <span className="hint" style={{ margin: 0 }}>
            {formatDay(today, { weekday: "short", day: "numeric", month: "short" })}
          </span>
        </div>
        <div className="today-stats">
          <div>
            <div className="stat-label">{t("meals.planned")}</div>
            <div className="stat-value">{count(planned)}</div>
          </div>
          <div>
            <div className="stat-label">{t("meals.eaten")}</div>
            <div className="stat-value">{count(eaten)}</div>
          </div>
        </div>
      </a>

      {askAllergies && (
        <a className="card ask-card" href="#/preferences" data-testid="allergy-prompt">
          <strong>{t("prefs.askTitle")}</strong>
          <span className="hint" style={{ margin: 0 }}>{t("prefs.askBody")}</span>
        </a>
      )}

      <nav className="quick-links" aria-label={t("kitchen.more")}>
        <a className="btn-soft" href="#/shopping" data-testid="shopping-link">
          <Icon name="basket" size={18} /> {t("shop.title")}
        </a>
        <a className="btn-soft" href="#/preferences">
          <Icon name="check" size={18} /> {t("prefs.title")}
        </a>
      </nav>

      <div className="section-title">
        <h2>{t("kitchen.recipes")}</h2>
        <button type="button" className="btn-primary fab" onClick={() => navigate(`/recipe/${crypto.randomUUID()}`)}>
          <Icon name="plus" /> {t("kitchen.newRecipe")}
        </button>
      </div>
      {recipes.length === 0 ? (
        <EmptyState title={t("kitchen.emptyTitle")}>
          <p>{t("kitchen.emptyBody")}</p>
        </EmptyState>
      ) : (
        <ul className="recipe-list">
          {recipes.map((r) => (
            <RecipeCard key={r.id} recipe={r} />
          ))}
        </ul>
      )}
      <p className="catalog-status" data-testid="catalog-status">
        {catalog.status === "ready"
          ? t(catalog.offline ? "kitchen.catalogOffline" : "kitchen.catalog", { n: catalog.bundle.foodCount })
          : catalog.status === "loading"
            ? t("kitchen.catalogLoading")
            : t("catalog.unavailable")}
      </p>
    </div>
  );
}

function RecipeCard({ recipe }: { recipe: LocalRecipe }) {
  const { catalog, groups } = useApp();
  const t = useT();
  const energy = useMemo(() => {
    if (catalog.status !== "ready") return null;
    const n = calculateRecipe(recipe.body, catalog.foods, catalog.bundle.nutrients);
    return n.perServing.find((t) => t.key === "energy_kcal") ?? null;
  }, [recipe.body, catalog]);
  const servings = t("common.servings", { n: recipe.body.servings });
  return (
    <li>
      <a className="recipe-card" href={`#/recipe/${recipe.id}`} data-testid="recipe-card">
        {recipe.body.image ? (
          <img className="monogram recipe-thumb" src={imageUrl(recipe.body.image.id)} alt="" loading="lazy" crossOrigin="use-credentials" />
        ) : (
          <span className="monogram" aria-hidden="true">
            {recipe.body.title.trim().charAt(0).toUpperCase() || "?"}
          </span>
        )}
        <span className="recipe-title">{recipe.body.title}</span>
        <span className="recipe-meta">
          {servings}
          {energy && energy.amount !== null ? ` · ${t("kitchen.kcalEach", { amount: formatQty(energy.amount, "kcal") })}` : ""}
        </span>
        <span className={`state state-${recipe.state}`}>{t(STATE_LABEL[recipe.state])}</span>
        {recipe.groupId && (
          <span className="recipe-group" data-testid="group-recipe-tag">
            <Icon name="people" size={14} /> {groups?.find((g) => g.id === recipe.groupId)?.name ?? t("groups.groupRecipe")}
          </span>
        )}
      </a>
    </li>
  );
}

export function Explore() {
  const { catalog } = useApp();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<FoodRecord | null>(null);
  const t = useT();
  if (catalog.status !== "ready") return <EmptyState title={t("catalog.notReady")}>{catalog.status === "unavailable" ? t("catalog.unavailable") : t("common.loading")}</EmptyState>;
  const results = searchFoods(catalog.foods, query, 50);
  const defs = catalog.bundle.nutrients;
  return (
    <div className="screen">
      <header className="screen-head">
        <div>
          <p className="eyebrow">{t("nav.explore")}</p>
          <h1>{t("explore.title")}</h1>
        </div>
      </header>
      <label htmlFor="explore-search" className="sr-only">
        {t("food.search")}
      </label>
      <input id="explore-search" type="search" placeholder={t("food.explorePlaceholder")} value={query} onChange={(e) => setQuery(e.target.value)} />
      <p className="hint">
        {t("explore.hint", { n: catalog.bundle.foodCount })} <EnglishNamesNote />
      </p>
      <ul className="food-results">
        {results.map((f) => (
          <li key={f.id}>
            <button type="button" onClick={() => setOpen(f)}>
              <span>{f.description}</span>
              <small>{f.category}</small>
            </button>
          </li>
        ))}
      </ul>
      {results.length === 0 && <NotInCatalog />}
      {open && (
        <Sheet title={open.description} onClose={() => setOpen(null)}>
          <p className="hint">{t("explore.per100")}</p>
          <ul className="nutrient-list">
            {defs.map((d) => (
              <li key={d.key} className="nutrient-row static">
                <span className="nutrient-name">{nutrientName(d.key, d.name)}</span>
                <span className={`nutrient-value ${open.nutrientsPer100g[d.key] === undefined ? "status-unknown" : ""}`}>
                  {formatQty(open.nutrientsPer100g[d.key] ?? null, d.unit)}
                </span>
              </li>
            ))}
          </ul>
          {open.portions.length > 0 && <p className="hint">{t("explore.portions", { list: open.portions.map((p) => `${p.label} = ${p.gramWeight} g`).join("; ") })}</p>}
          <p className="fine">
            {t("explore.source")}{" "}
            <a href={open.source.url} target="_blank" rel="noopener noreferrer">
              {open.source.publisher}, {open.source.dataset}
            </a>
            {t("explore.retrieved", { date: open.source.retrievedAt.slice(0, 10) })} <span lang="en">{open.source.license}</span>
          </p>
        </Sheet>
      )}
    </div>
  );
}

export function You() {
  const { account, engine, signOut, online, goals, groups, profiles } = useApp();
  const activeGoals = goals.filter((g) => isActive(g.body)).length;
  const ai = useAiSettings(account?.id, online);
  const t = useT();
  const status = useSyncStatus(engine);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [storage, setStorage] = useState<Awaited<ReturnType<typeof storageInfo>> | null>(null);
  useEffect(() => void storageInfo().then(setStorage), []);

  async function exportUnsynced() {
    if (!engine) return;
    downloadJson(await engine.exportUnsynced(), "better-plate-unsynced");
  }

  async function exportAll() {
    setNote(null);
    try {
      downloadJson(await api.exportData(), "better-plate-export");
    } catch (err) {
      setNote(err instanceof ApiRequestError ? err.message : t("you.exportOffline"));
    }
  }

  async function doSignOut() {
    const pending = (await engine?.pendingCount()) ?? 0;
    if (pending && !confirm(t("you.signOutConfirm", { n: pending }))) return;
    setBusy(true);
    await signOut();
    navigate("/kitchen");
  }

  async function deleteAccount() {
    if (!confirm(t("you.deleteConfirm"))) return;
    setBusy(true);
    try {
      await api.deleteAccount();
      await signOut();
    } catch (err) {
      setNote(err instanceof ApiRequestError ? err.message : t("you.deleteOffline"));
      setBusy(false);
    }
  }

  return (
    <div className="screen">
      <header className="screen-head">
        <div>
          <p className="eyebrow">{t("nav.you")}</p>
          <h1>{t("you.title")}</h1>
        </div>
      </header>
      <dl className="facts">
        <dt>{t("signin.email")}</dt>
        <dd data-testid="account-email" data-private>{account?.email}</dd>
        <dt>{t("you.onDevice")}</dt>
        <dd data-testid="storage-info">
          {storage?.usage != null ? `${t("you.mbUsed", { mb: (storage.usage / 1_000_000).toLocaleString(dateLocale(), { maximumFractionDigits: 1, minimumFractionDigits: 1 }) })} ` : ""}
          {storage?.persisted ? t("you.persisted") : t("you.notPersisted")}
        </dd>
        <dt>{t("you.sync")}</dt>
        <dd>
          {t(!online ? "sync.offline" : SYNC_WORDS[status])}
          {engine?.lastSyncedAt ? `, ${t("you.lastChecked", { time: new Date(engine.lastSyncedAt).toLocaleTimeString(dateLocale()) })}` : ""}
        </dd>
        <dt>{t("goals.title")}</dt>
        <dd data-testid="goals-summary">
          {activeGoals ? t("goals.count", { n: activeGoals }) : t("goals.noneSet")} <a href="#/goals">{goals.length ? t("goals.manage") : t("targets.set")}</a>
        </dd>
        <dt>{t("groups.title")}</dt>
        <dd data-testid="groups-summary">
          {groups?.length ? t("groups.count", { n: groups.length }) : t("groups.none")}
          {profiles.length ? ` · ${t("groups.profilesCount", { n: profiles.length })}` : ""} <a href="#/groups">{t("groups.manage")}</a>
        </dd>
        <dt>{t("prefs.title")}</dt>
        <dd>
          <a href="#/preferences">{t("prefs.manage")}</a>
        </dd>
        {ai !== false && (
          <>
            <dt>{t("ai.status")}</dt>
            <dd data-testid="ai-summary">
              {ai?.activeProvider
                ? t("ai.statusOn", { provider: ai.activeProvider === "anthropic" ? "Anthropic" : "OpenAI" })
                : ai?.house.status === "available"
                  ? t("ai.statusIncluded")
                  : t("ai.statusOff")} <a href="#/ai">{t("ai.manage")}</a>
            </dd>
          </>
        )}
        <dt>{t("lang.label")}</dt>
        <dd>
          <LanguagePicker id="you-language" hideLabel />
        </dd>
      </dl>
      <PeriodTotals />
      <div className="stack">
        <button type="button" className="btn-secondary" onClick={() => void engine?.syncNow()}>
          {t("sync.now")}
        </button>
        <button type="button" className="btn-secondary" disabled={!online} onClick={() => void exportAll()}>
          {t("you.downloadAll")}
        </button>
        <button type="button" className="btn-secondary" onClick={() => void exportUnsynced()}>
          {t("you.exportUnsynced")}
        </button>
        <button type="button" className="btn-secondary" disabled={busy} onClick={() => void doSignOut()}>
          {t("common.signOut")}
        </button>
        <button type="button" className="btn-link danger" disabled={busy || !online} onClick={() => void deleteAccount()}>
          {t("you.deleteAccount")}
        </button>
      </div>
      {note && <p className="error">{note}</p>}
      <p className="fine">
        {t("you.fine")} <a href="#/privacy">{t("signin.privacyLink")}</a>
      </p>
    </div>
  );
}
