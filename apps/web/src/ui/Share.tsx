import { useEffect, useState } from "react";
import type { RecipeBody, Share, SharedRecipe } from "@betterplate/contracts";
import { track } from "../activity.ts";
import { api, ApiRequestError, NetworkError } from "../api.ts";
import type { LocalRecipe } from "../localdb.ts";
import { useApp } from "../store.tsx";
import { navigate, Sheet } from "./common.tsx";
import { Icon } from "./icons.tsx";
import { disclosureText, NutrientLine } from "./Nutrition.tsx";

const EXPIRY = [
  { value: "", label: "Until I revoke it" },
  { value: "7", label: "7 days" },
  { value: "30", label: "30 days" },
];

const MAIN_NUTRIENTS = ["energy_kcal", "protein", "carbohydrate", "fat_total", "fiber", "sodium"];

function problemText(err: unknown) {
  if (err instanceof NetworkError) return "You're offline. Creating or revoking a link needs an internet connection.";
  if (err instanceof ApiRequestError && err.status === 429) return "Too many links in a short time. Try again later.";
  if (err instanceof ApiRequestError && err.status === 404) return "The cloud doesn't have this recipe yet. Let it sync, then try again.";
  return "Something went wrong. Try again in a moment.";
}

/**
 * Review, then publish a read-only link. Only what is listed here is shared; the link holder
 * never sees the owner's name, email, meals or other recipes.
 */
export function ShareSheet({ recipe, onClose }: { recipe: LocalRecipe; onClose: () => void }) {
  const { online, engine } = useApp();
  const [includeMethod, setIncludeMethod] = useState(false);
  const [expiry, setExpiry] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [created, setCreated] = useState<Share | null>(null);
  const [links, setLinks] = useState<Share[] | null>(null);
  const [copied, setCopied] = useState(false);
  const synced = recipe.state === "synced" && recipe.serverVersion !== null;
  const body: RecipeBody = recipe.body;

  useEffect(() => {
    if (!online || !synced) return;
    api.shares(recipe.id).then((r) => setLinks(r.shares), () => setLinks(null));
  }, [online, synced, recipe.id, created]);

  async function create() {
    setBusy(true);
    setProblem(null);
    try {
      const share = await api.createShare(recipe.id, { includeMethod, expiresInDays: expiry ? Number(expiry) : null });
      track("Created a share link");
      setCreated(share);
    } catch (err) {
      setProblem(problemText(err));
    } finally {
      setBusy(false);
    }
  }

  async function revoke(share: Share) {
    if (!confirm("Revoke this link? Anyone who opens it will see that it no longer works.")) return;
    try {
      await api.revokeShare(share.shareId);
      track("Revoked a share link");
      if (created?.shareId === share.shareId) setCreated(null);
      setLinks((l) => l?.filter((s) => s.shareId !== share.shareId) ?? null);
    } catch (err) {
      setProblem(problemText(err));
    }
  }

  async function copy(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      setProblem("Couldn't copy. Select the link and copy it yourself.");
    }
  }

  const message = (url: string) => `${body.title}: ${url}`;

  return (
    <Sheet title="Share recipe" onClose={onClose}>
      {!online ? (
        <p className="banner banner-warn" role="status">You're offline. Creating a link needs an internet connection; your recipe is safe on this device.</p>
      ) : !synced ? (
        <div className="banner banner-warn" role="status">
          <p>Sync this recipe first, so the link shows exactly what you see here.</p>
          <button type="button" className="btn-secondary" onClick={() => void engine?.syncNow()}>
            Sync now
          </button>
        </div>
      ) : created ? (
        <div data-testid="share-created">
          <p className="hint">Your link is ready. Anyone who has it can read this recipe until you revoke it.</p>
          <label htmlFor="share-url">Link</label>
          <input id="share-url" readOnly value={created.url} onFocus={(e) => e.currentTarget.select()} />
          <div className="sheet-actions">
            {"share" in navigator && (
              <button
                type="button"
                className="btn-primary"
                onClick={() => void navigator.share({ title: body.title, text: body.title, url: created.url }).catch(() => {})}
              >
                <Icon name="share" size={18} /> Share…
              </button>
            )}
            <button type="button" className={"share" in navigator ? "btn-secondary" : "btn-primary"} onClick={() => void copy(created.url)}>
              <Icon name="link" size={18} /> {copied ? "Copied" : "Copy link"}
            </button>
            <div className="share-fallbacks">
              <a href={`mailto:?subject=${encodeURIComponent(body.title)}&body=${encodeURIComponent(message(created.url))}`}>Email</a>
              <a href={`sms:?&body=${encodeURIComponent(message(created.url))}`}>Text message</a>
            </div>
          </div>
        </div>
      ) : (
        <>
          <p className="hint">People with the link will see:</p>
          <div className="card share-preview" data-testid="share-preview">
            <strong className="recipe-title">{body.title}</strong>
            <ul>
              <li>{body.servings} {body.servings === 1 ? "serving" : "servings"} and {body.ingredients.length} {body.ingredients.length === 1 ? "ingredient" : "ingredients"} with amounts</li>
              <li>The estimated nutrition, with USDA as the source</li>
              {includeMethod && <li>Your method, word for word</li>}
            </ul>
            <p className="fine" style={{ marginTop: 8 }}>Never your name, email, meals or other recipes.</p>
          </div>
          <label className="check">
            <input type="checkbox" checked={includeMethod} disabled={!body.method} onChange={(e) => setIncludeMethod(e.target.checked)} />
            Include my method{body.method ? "" : " (none written yet)"}
          </label>
          <label htmlFor="share-expiry">Link works</label>
          <select id="share-expiry" value={expiry} onChange={(e) => setExpiry(e.target.value)}>
            {EXPIRY.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <div className="sheet-actions">
            <button type="button" className="btn-primary" disabled={busy} onClick={() => void create()}>
              {busy ? "Creating…" : "Create link"}
            </button>
          </div>
          <p className="fine">Anyone with the link can read it until you revoke it or it expires. Later edits to your recipe aren't shared; create a new link to share them.</p>
        </>
      )}
      {problem && (
        <p className="error" role="alert">
          {problem}
        </p>
      )}
      {links && links.length > 0 && (
        <section className="share-links" aria-labelledby="links-title">
          <h3 id="links-title">Active links</h3>
          <ul data-testid="share-links">
            {links.map((s) => (
              <li key={s.shareId}>
                <span>
                  <span className="meal-name">{new Date(s.createdAt).toLocaleDateString(undefined, { day: "numeric", month: "short" })}</span>
                  <span className="meal-meta">
                    {" "}
                    · {s.includeMethod ? "with method" : "without method"} · {s.expiresAt ? `until ${new Date(s.expiresAt).toLocaleDateString(undefined, { day: "numeric", month: "short" })}` : "until revoked"}
                  </span>
                </span>
                <button type="button" className="btn-link danger" onClick={() => void revoke(s)}>
                  Revoke
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </Sheet>
  );
}

const qty = (n: number) => String(Number(n.toFixed(2)));

function amountLabel(i: SharedRecipe["ingredients"][number]) {
  if (i.unit !== "portion") return `${qty(i.quantity)} ${i.unit}`;
  const label = i.portionLabel ?? "portion";
  return i.quantity === 1 ? label : `${qty(i.quantity)} × ${label}`;
}

/** What a link holder sees. Works without an account; nothing from this device is shown. */
export function SharedRecipePage({ shareId }: { shareId: string }) {
  const { account, engine } = useApp();
  const [state, setState] = useState<{ status: "loading" } | { status: "ok"; recipe: SharedRecipe } | { status: "gone" } | { status: "error"; message: string }>({ status: "loading" });
  const [perServing, setPerServing] = useState(true);
  const [saved, setSaved] = useState<string | null>(null);

  useEffect(() => {
    track("Opened a shared recipe");
    api.shared(shareId).then(
      (recipe) => setState({ status: "ok", recipe }),
      (err) => {
        if (err instanceof ApiRequestError && (err.status === 404 || err.status === 400)) setState({ status: "gone" });
        else setState({ status: "error", message: err instanceof NetworkError ? "You're offline. Shared recipes open when you're online." : "Couldn't open this recipe. Try again in a moment." });
      },
    );
  }, [shareId]);

  async function saveCopy(recipe: SharedRecipe) {
    const id = crypto.randomUUID();
    await engine!.saveRecipe(id, {
      title: recipe.title,
      servings: recipe.servings,
      method: recipe.method ?? "",
      ingredients: recipe.ingredients.map((i) => ({
        id: crypto.randomUUID(),
        foodId: i.foodId,
        quantity: i.quantity,
        unit: i.unit,
        portionIndex: i.portionIndex ?? null,
        role: i.role,
        oilDiscardedGrams: i.oilDiscardedGrams ?? null,
      })),
    });
    track("Saved a copy of a shared recipe");
    setSaved(id);
  }

  return (
    <div className="public-page">
      <header className="public-head">
        <a className="public-brand" href="#/kitchen">
          The Better Plate
        </a>
      </header>
      <main id="main" className="public-main">
        {state.status === "loading" && <p className="hint">Opening the recipe…</p>}
        {state.status === "gone" && (
          <div className="empty" data-testid="share-gone">
            <h1 className="h3">This link no longer works</h1>
            <p>The person who shared it may have revoked it, or it expired.</p>
          </div>
        )}
        {state.status === "error" && (
          <p className="banner banner-warn" role="alert">
            {state.message}
          </p>
        )}
        {state.status === "ok" && (
          <article data-testid="shared-recipe">
            <p className="eyebrow">Shared recipe</p>
            <h1 className="shared-title">{state.recipe.title}</h1>
            <p className="hint">
              {state.recipe.servings} {state.recipe.servings === 1 ? "serving" : "servings"} · shared {new Date(state.recipe.sharedAt).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" })}
            </p>

            <div className="shared-grid">
              <section>
                <h2>Ingredients</h2>
                <ul className="shared-ingredients">
                  {state.recipe.ingredients.map((i) => (
                    <li key={i.id}>
                      <span className="shared-amount">{amountLabel(i)}</span>
                      <span>
                        {i.name}
                        {i.role === "cooking_oil" && <span className="meal-meta"> · cooking oil{i.oilDiscardedGrams != null ? `, ${qty(i.oilDiscardedGrams)} g discarded` : ""}</span>}
                      </span>
                    </li>
                  ))}
                </ul>
                {state.recipe.method && (
                  <>
                    <h2>Method</h2>
                    <p className="shared-method">{state.recipe.method}</p>
                  </>
                )}
              </section>

              <section className="nutrition" aria-labelledby="shared-nutrition">
                <header className="nutrition-head">
                  <h2 id="shared-nutrition">
                    Nutrition <span className="tag">Estimated</span>
                  </h2>
                  <div className="segmented" role="group" aria-label="Amount shown">
                    <button type="button" aria-pressed={perServing} onClick={() => setPerServing(true)}>
                      Per serving
                    </button>
                    <button type="button" aria-pressed={!perServing} onClick={() => setPerServing(false)}>
                      Whole recipe
                    </button>
                  </div>
                </header>
                <ul className="nutrient-list">
                  {(perServing ? state.recipe.nutrition.perServing : state.recipe.nutrition.totals)
                    .filter((r) => MAIN_NUTRIENTS.includes(r.key))
                    .map((row) => (
                      <li key={row.key} className="nutrient-row static" data-testid={`shared-nutrient-${row.key}`}>
                        <NutrientLine row={row} name={state.recipe.nutrientNames[row.key] ?? row.key} />
                      </li>
                    ))}
                </ul>
                {state.recipe.nutrition.disclosures.length > 0 && (
                  <ul className="disclosures">
                    {state.recipe.nutrition.disclosures.map((d, idx) => (
                      <li key={idx}>{disclosureText(d.code, state.recipe.ingredients.find((i) => i.id === d.ingredientId)?.name ?? "an ingredient")}</li>
                    ))}
                  </ul>
                )}
                <p className="fine">
                  Estimated from{" "}
                  <a href={state.recipe.source.url} target="_blank" rel="noopener noreferrer">
                    {state.recipe.source.name}
                  </a>{" "}
                  (catalog {state.recipe.nutrition.catalogVersion}). Not reported is not zero. This is general information, not medical advice.
                </p>
              </section>
            </div>

            <div className="public-cta">
              {account && engine ? (
                saved ? (
                  <button type="button" className="btn-primary" onClick={() => navigate(`/recipe/${saved}`)}>
                    Open my copy
                  </button>
                ) : (
                  <button type="button" className="btn-primary" onClick={() => void saveCopy(state.recipe)}>
                    Save a copy to my kitchen
                  </button>
                )
              ) : (
                <a className="btn-primary" href="#/kitchen">
                  Make your own in The Better Plate
                </a>
              )}
            </div>
          </article>
        )}
      </main>
    </div>
  );
}
