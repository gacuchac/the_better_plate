import { useMemo, useState } from "react";
import { calculateRecipe, formatAmount, type FoodRecord } from "@betterplate/nutrition";
import { ApiRequestError, api } from "../api.ts";
import type { LocalRecipe } from "../localdb.ts";
import { useApp, useSyncStatus } from "../store.tsx";
import { localDate, formatDay } from "../meals.ts";
import { EmptyState, navigate, Sheet } from "./common.tsx";
import { Icon } from "./icons.tsx";
import { NotInCatalog, searchFoods } from "./FoodPicker.tsx";

const STATE_LABEL: Record<LocalRecipe["state"], string> = {
  synced: "Synced",
  pending: "Saved on this device",
  conflict: "Needs attention",
  rejected: "Needs attention",
};

function greeting(d = new Date()) {
  const h = d.getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

export function Kitchen() {
  const { recipes, catalog, account, plans, logs } = useApp();
  const today = localDate();
  const planned = plans.filter((p) => p.body.date === today).length;
  const eaten = logs.filter((l) => l.body.localDate === today).length;
  const count = (n: number) => (n === 1 ? "1 meal" : `${n} meals`);
  return (
    <div className="screen">
      <header className="home-head">
        <div>
          <p className="eyebrow">Your Kitchen</p>
          <h1 className="greeting">
            {greeting()}
            {account?.displayName ? `, ${account.displayName.split(" ")[0]}` : ""}
          </h1>
        </div>
      </header>

      <a className="card today-card" href="#/meals" data-testid="today-card">
        <div className="card-head" style={{ marginBottom: 0 }}>
          <h2>Today</h2>
          <span className="hint" style={{ margin: 0 }}>
            {formatDay(today, { weekday: "short", day: "numeric", month: "short" })}
          </span>
        </div>
        <div className="today-stats">
          <div>
            <div className="stat-label">Planned</div>
            <div className="stat-value">{count(planned)}</div>
          </div>
          <div>
            <div className="stat-label">Eaten</div>
            <div className="stat-value">{count(eaten)}</div>
          </div>
        </div>
      </a>

      <div className="section-title">
        <h2>Recipes</h2>
        <button type="button" className="btn-primary fab" onClick={() => navigate(`/recipe/${crypto.randomUUID()}`)}>
          <Icon name="plus" /> New recipe
        </button>
      </div>
      {recipes.length === 0 ? (
        <EmptyState title="No recipes yet">
          <p>Start with something you already love to cook. It saves on this device first and syncs when you're online.</p>
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
          ? `${catalog.bundle.foodCount.toLocaleString()} USDA foods saved on this device${catalog.offline ? " (offline copy)" : ""}.`
          : catalog.status === "loading"
            ? "Getting the USDA foods ready…"
            : catalog.message}
      </p>
    </div>
  );
}

function RecipeCard({ recipe }: { recipe: LocalRecipe }) {
  const { catalog } = useApp();
  const energy = useMemo(() => {
    if (catalog.status !== "ready") return null;
    const n = calculateRecipe(recipe.body, catalog.foods, catalog.bundle.nutrients);
    return n.perServing.find((t) => t.key === "energy_kcal") ?? null;
  }, [recipe.body, catalog]);
  const servings = recipe.body.servings === 1 ? "1 serving" : `${recipe.body.servings} servings`;
  return (
    <li>
      <a className="recipe-card" href={`#/recipe/${recipe.id}`} data-testid="recipe-card">
        <span className="monogram" aria-hidden="true">
          {recipe.body.title.trim().charAt(0).toUpperCase() || "?"}
        </span>
        <span className="recipe-title">{recipe.body.title}</span>
        <span className="recipe-meta">
          {servings}
          {energy && energy.amount !== null ? ` · ${formatAmount(energy.amount, "kcal")} each, estimated` : ""}
        </span>
        <span className={`state state-${recipe.state}`}>{STATE_LABEL[recipe.state]}</span>
      </a>
    </li>
  );
}

export function Explore() {
  const { catalog } = useApp();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<FoodRecord | null>(null);
  if (catalog.status !== "ready") return <EmptyState title="Food list not ready">{catalog.status === "unavailable" ? catalog.message : "Loading…"}</EmptyState>;
  const results = searchFoods(catalog.foods, query, 50);
  const defs = catalog.bundle.nutrients;
  return (
    <div className="screen">
      <header className="screen-head">
        <div>
          <p className="eyebrow">Explore</p>
          <h1>Foods</h1>
        </div>
      </header>
      <label htmlFor="explore-search" className="sr-only">
        Search foods
      </label>
      <input id="explore-search" type="search" placeholder="Search foods, e.g. sirloin steak" value={query} onChange={(e) => setQuery(e.target.value)} />
      <p className="hint">
        {catalog.bundle.foodCount.toLocaleString()} foods from USDA FoodData Central are saved on this device, so search works offline too.
        Packaged and branded products aren't included yet.
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
          <p className="hint">Per 100 g, as published by USDA. "Not reported" means USDA has no value for this food.</p>
          <ul className="nutrient-list">
            {defs.map((d) => (
              <li key={d.key} className="nutrient-row static">
                <span className="nutrient-name">{d.name}</span>
                <span className={`nutrient-value ${open.nutrientsPer100g[d.key] === undefined ? "status-unknown" : ""}`}>
                  {formatAmount(open.nutrientsPer100g[d.key] ?? null, d.unit)}
                </span>
              </li>
            ))}
          </ul>
          {open.portions.length > 0 && <p className="hint">Portions: {open.portions.map((p) => `${p.label} = ${p.gramWeight} g`).join("; ")}</p>}
          <p className="fine">
            Source:{" "}
            <a href={open.source.url} target="_blank" rel="noopener noreferrer">
              {open.source.publisher}, {open.source.dataset}
            </a>
            , retrieved {open.source.retrievedAt.slice(0, 10)}. {open.source.license}
          </p>
        </Sheet>
      )}
    </div>
  );
}

export function You() {
  const { account, engine, signOut, online } = useApp();
  const status = useSyncStatus(engine);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  function download(data: unknown, name: string) {
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${name}-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function exportUnsynced() {
    if (!engine) return;
    download(await engine.exportUnsynced(), "better-plate-unsynced");
  }

  async function exportAll() {
    setNote(null);
    try {
      download(await api.exportData(), "better-plate-export");
    } catch (err) {
      setNote(err instanceof ApiRequestError ? err.message : "You need to be online to download your data.");
    }
  }

  async function doSignOut() {
    const pending = (await engine?.pendingCount()) ?? 0;
    if (pending && !confirm(`${pending} change(s) haven't synced and will be removed from this device. Export them first?\n\nOK = sign out anyway, Cancel = stay`)) return;
    setBusy(true);
    await signOut();
    navigate("/kitchen");
  }

  async function deleteAccount() {
    if (!confirm("Delete your account and all recipes from the cloud? This can't be undone.")) return;
    setBusy(true);
    try {
      await api.deleteAccount();
      await signOut();
    } catch (err) {
      setNote(err instanceof ApiRequestError ? err.message : "You need to be online to delete your account.");
      setBusy(false);
    }
  }

  return (
    <div className="screen">
      <header className="screen-head">
        <div>
          <p className="eyebrow">You</p>
          <h1>Account</h1>
        </div>
      </header>
      <dl className="facts">
        <dt>Email</dt>
        <dd data-testid="account-email" data-private>{account?.email}</dd>
        <dt>Sync</dt>
        <dd>{online ? status.replace("-", " ") : "offline"}{engine?.lastSyncedAt ? `, last checked ${new Date(engine.lastSyncedAt).toLocaleTimeString()}` : ""}</dd>
      </dl>
      <div className="stack">
        <button type="button" className="btn-secondary" onClick={() => void engine?.syncNow()}>
          Sync now
        </button>
        <button type="button" className="btn-secondary" disabled={!online} onClick={() => void exportAll()}>
          Download all my data
        </button>
        <button type="button" className="btn-secondary" onClick={() => void exportUnsynced()}>
          Export unsynced changes
        </button>
        <button type="button" className="btn-secondary" disabled={busy} onClick={() => void doSignOut()}>
          Sign out
        </button>
        <button type="button" className="btn-link danger" disabled={busy || !online} onClick={() => void deleteAccount()}>
          Delete account
        </button>
      </div>
      {note && <p className="error">{note}</p>}
      <p className="fine">
        We keep your email, the recipes you save, the meals you plan or mark eaten, links you share and issue reports you send. Download all of it any time. Signing out removes them from this device; synced data stays in your account until you delete it. Nutrition numbers are educational estimates, not medical advice.
      </p>
    </div>
  );
}
