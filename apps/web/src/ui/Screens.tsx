import { useMemo, useState } from "react";
import { calculateRecipe, formatAmount, type FoodRecord } from "@betterplate/nutrition";
import { ApiRequestError, api } from "../api.ts";
import type { LocalRecipe } from "../localdb.ts";
import { useApp, useSyncStatus } from "../store.tsx";
import { EmptyState, navigate, Sheet } from "./common.tsx";
import { NotInCatalog, searchFoods } from "./FoodPicker.tsx";

const STATE_LABEL: Record<LocalRecipe["state"], string> = {
  synced: "Synced",
  pending: "Saved on this device",
  conflict: "Needs attention",
  rejected: "Needs attention",
};

export function Kitchen() {
  const { recipes, catalog } = useApp();
  return (
    <div className="screen">
      <header className="screen-head">
        <div>
          <p className="eyebrow">Your Kitchen</p>
          <h1>Recipes</h1>
        </div>
        <button type="button" className="btn-primary" onClick={() => navigate(`/recipe/${crypto.randomUUID()}`)}>
          New recipe
        </button>
      </header>
      <p className="catalog-status" data-testid="catalog-status">
        {catalog.status === "ready"
          ? `${catalog.bundle.foodCount.toLocaleString()} USDA foods saved on this device${catalog.offline ? " (offline copy)" : ""}.`
          : catalog.status === "loading"
            ? "Getting the USDA foods ready…"
            : catalog.message}
      </p>
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
  return (
    <li>
      <a className="recipe-card" href={`#/recipe/${recipe.id}`} data-testid="recipe-card">
        <span className="recipe-title">{recipe.body.title}</span>
        <span className="recipe-meta">
          {recipe.body.ingredients.length} ingredients · {recipe.body.servings} servings
          {energy && energy.amount !== null ? ` · ~${formatAmount(energy.amount, "kcal")} per serving (estimated)` : ""}
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

  async function exportUnsynced() {
    if (!engine) return;
    const data = await engine.exportUnsynced();
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `better-plate-unsynced-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
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
        <dd data-testid="account-email">{account?.email}</dd>
        <dt>Sync</dt>
        <dd>{online ? status.replace("-", " ") : "offline"}{engine?.lastSyncedAt ? `, last checked ${new Date(engine.lastSyncedAt).toLocaleTimeString()}` : ""}</dd>
      </dl>
      <div className="stack">
        <button type="button" className="btn-secondary" onClick={() => void engine?.syncNow()}>
          Sync now
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
        We keep your email and the recipes you save. Signing out removes your recipes from this device; synced recipes stay in your account. Nutrition numbers are educational estimates, not medical advice.
      </p>
    </div>
  );
}
