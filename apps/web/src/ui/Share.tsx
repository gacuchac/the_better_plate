import { useEffect, useState } from "react";
import type { RecipeBody, Share, SharedRecipe } from "@betterplate/contracts";
import { track } from "../activity.ts";
import { api, ApiRequestError, NetworkError } from "../api.ts";
import type { LocalRecipe } from "../localdb.ts";
import { useApp } from "../store.tsx";
import { navigate, Sheet } from "./common.tsx";
import { Icon } from "./icons.tsx";
import { disclosureText, NutrientLine } from "./Nutrition.tsx";
import { dateLocale, nutrientName, t as translate, useT, type MessageKey } from "../i18n.ts";

const EXPIRY: { value: string; label: MessageKey }[] = [
  { value: "", label: "share.untilRevoke" },
  { value: "7", label: "share.days7" },
  { value: "30", label: "share.days30" },
];

const MAIN_NUTRIENTS = ["energy_kcal", "protein", "carbohydrate", "fat_total", "fiber", "sodium"];

function problemText(err: unknown) {
  if (err instanceof NetworkError) return translate("share.errOffline");
  if (err instanceof ApiRequestError && err.status === 429) return translate("share.errTooMany");
  if (err instanceof ApiRequestError && err.status === 404) return translate("share.errNotSynced");
  return translate("share.errGeneric");
}

/**
 * Review, then publish a read-only link. Only what is listed here is shared; the link holder
 * never sees the owner's name, email, meals or other recipes.
 */
export function ShareSheet({ recipe, onClose }: { recipe: LocalRecipe; onClose: () => void }) {
  const { online, engine } = useApp();
  const t = useT();
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
    if (!confirm(t("share.revokeConfirm"))) return;
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
      setProblem(t("share.copyFailed"));
    }
  }

  const message = (url: string) => `${body.title}: ${url}`;

  return (
    <Sheet title={t("share.title")} onClose={onClose}>
      {!online ? (
        <p className="banner banner-warn" role="status">{t("share.offline")}</p>
      ) : !synced ? (
        <div className="banner banner-warn" role="status">
          <p>{t("share.syncFirst")}</p>
          <button type="button" className="btn-secondary" onClick={() => void engine?.syncNow()}>
            {t("sync.now")}
          </button>
        </div>
      ) : created ? (
        <div data-testid="share-created">
          <p className="hint">{t("share.ready")}</p>
          <label htmlFor="share-url">{t("share.link")}</label>
          <input id="share-url" readOnly value={created.url} onFocus={(e) => e.currentTarget.select()} />
          <div className="sheet-actions">
            {"share" in navigator && (
              <button
                type="button"
                className="btn-primary"
                onClick={() => void navigator.share({ title: body.title, text: body.title, url: created.url }).catch(() => {})}
              >
                <Icon name="share" size={18} /> {t("share.shareNative")}
              </button>
            )}
            <button type="button" className={"share" in navigator ? "btn-secondary" : "btn-primary"} onClick={() => void copy(created.url)}>
              <Icon name="link" size={18} /> {copied ? t("share.copied") : t("share.copy")}
            </button>
            <div className="share-fallbacks">
              <a href={`mailto:?subject=${encodeURIComponent(body.title)}&body=${encodeURIComponent(message(created.url))}`}>{t("signin.email")}</a>
              <a href={`sms:?&body=${encodeURIComponent(message(created.url))}`}>{t("share.sms")}</a>
            </div>
          </div>
        </div>
      ) : (
        <>
          <p className="hint">{t("share.willSee")}</p>
          <div className="card share-preview" data-testid="share-preview">
            <strong className="recipe-title">{body.title}</strong>
            {body.description && <p className="hint">{body.description}</p>}
            <ul>
              <li>{t("share.seeIngredients", { servings: t("common.servings", { n: body.servings }), ingredients: t("share.ingredients", { n: body.ingredients.length }) })}</li>
              <li>{t("share.seeNutrition")}</li>
              {includeMethod && <li>{t("share.seeMethod")}</li>}
            </ul>
            <p className="fine" style={{ marginTop: 8 }}>{t("share.never")}</p>
          </div>
          <label className="check">
            <input type="checkbox" checked={includeMethod} disabled={!body.method} onChange={(e) => setIncludeMethod(e.target.checked)} />
            {body.method ? t("share.includeMethod") : t("share.includeMethodNone")}
          </label>
          <label htmlFor="share-expiry">{t("share.linkWorks")}</label>
          <select id="share-expiry" value={expiry} onChange={(e) => setExpiry(e.target.value)}>
            {EXPIRY.map((o) => (
              <option key={o.value} value={o.value}>
                {t(o.label)}
              </option>
            ))}
          </select>
          <div className="sheet-actions">
            <button type="button" className="btn-primary" disabled={busy} onClick={() => void create()}>
              {busy ? t("share.creating") : t("share.create")}
            </button>
          </div>
          <p className="fine">{t("share.fine")}</p>
        </>
      )}
      {problem && (
        <p className="error" role="alert">
          {problem}
        </p>
      )}
      {links && links.length > 0 && (
        <section className="share-links" aria-labelledby="links-title">
          <h3 id="links-title">{t("share.active")}</h3>
          <ul data-testid="share-links">
            {links.map((s) => (
              <li key={s.shareId}>
                <span>
                  <span className="meal-name">{new Date(s.createdAt).toLocaleDateString(dateLocale(), { day: "numeric", month: "short" })}</span>
                  <span className="meal-meta">
                    {" "}
                    · {s.includeMethod ? t("share.withMethod") : t("share.withoutMethod")} ·{" "}
                    {s.expiresAt ? t("share.until", { date: new Date(s.expiresAt).toLocaleDateString(dateLocale(), { day: "numeric", month: "short" }) }) : t("share.untilRevoked")}
                  </span>
                </span>
                <button type="button" className="btn-link danger" onClick={() => void revoke(s)}>
                  {t("share.revoke")}
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
  const label = i.portionLabel ?? translate("share.portion");
  return i.quantity === 1 ? label : `${qty(i.quantity)} × ${label}`;
}

/** What a link holder sees. Works without an account; nothing from this device is shown. */
export function SharedRecipePage({ shareId }: { shareId: string }) {
  const { account, engine } = useApp();
  const [state, setState] = useState<{ status: "loading" } | { status: "ok"; recipe: SharedRecipe } | { status: "gone" } | { status: "error"; message: string }>({ status: "loading" });
  const [perServing, setPerServing] = useState(true);
  const t = useT();
  const [saved, setSaved] = useState<string | null>(null);

  useEffect(() => {
    track("Opened a shared recipe");
    api.shared(shareId).then(
      (recipe) => setState({ status: "ok", recipe }),
      (err) => {
        if (err instanceof ApiRequestError && (err.status === 404 || err.status === 400)) setState({ status: "gone" });
        else setState({ status: "error", message: err instanceof NetworkError ? translate("shared.offline") : translate("shared.error") });
      },
    );
  }, [shareId]);

  async function saveCopy(recipe: SharedRecipe) {
    const id = crypto.randomUUID();
    await engine!.saveRecipe(id, {
      title: recipe.title,
      description: recipe.description ?? "",
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
        {state.status === "loading" && <p className="hint">{t("shared.opening")}</p>}
        {state.status === "gone" && (
          <div className="empty" data-testid="share-gone">
            <h1 className="h3">{t("shared.goneTitle")}</h1>
            <p>{t("shared.goneBody")}</p>
          </div>
        )}
        {state.status === "error" && (
          <p className="banner banner-warn" role="alert">
            {state.message}
          </p>
        )}
        {state.status === "ok" && (
          <article data-testid="shared-recipe">
            <p className="eyebrow">{t("shared.eyebrow")}</p>
            <h1 className="shared-title">{state.recipe.title}</h1>
            {state.recipe.description && <p className="lede shared-description">{state.recipe.description}</p>}
            <p className="hint">
              {t("common.servings", { n: state.recipe.servings })} ·{" "}
              {t("shared.sharedOn", { date: new Date(state.recipe.sharedAt).toLocaleDateString(dateLocale(), { day: "numeric", month: "long", year: "numeric" }) })}
            </p>

            <div className="shared-grid">
              <section>
                <h2>{t("editor.ingredients")}</h2>
                <ul className="shared-ingredients">
                  {state.recipe.ingredients.map((i) => (
                    <li key={i.id}>
                      <span className="shared-amount">{amountLabel(i)}</span>
                      <span>
                        {i.name}
                        {i.role === "cooking_oil" && (
                          <span className="meal-meta">
                            {" "}
                            · {i.oilDiscardedGrams != null ? t("shared.oilDiscarded", { g: qty(i.oilDiscardedGrams) }) : t("shared.oil")}
                          </span>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
                {state.recipe.method && (
                  <>
                    <h2>{t("editor.method")}</h2>
                    <p className="shared-method">{state.recipe.method}</p>
                  </>
                )}
              </section>

              <section className="nutrition" aria-labelledby="shared-nutrition">
                <header className="nutrition-head">
                  <h2 id="shared-nutrition">
                    {t("nutrition.title")} <span className="tag">{t("common.estimated")}</span>
                  </h2>
                  <div className="segmented" role="group" aria-label={t("nutrition.amountShown")}>
                    <button type="button" aria-pressed={perServing} onClick={() => setPerServing(true)}>
                      {t("nutrition.perServing")}
                    </button>
                    <button type="button" aria-pressed={!perServing} onClick={() => setPerServing(false)}>
                      {t("nutrition.wholeRecipe")}
                    </button>
                  </div>
                </header>
                <ul className="nutrient-list">
                  {(perServing ? state.recipe.nutrition.perServing : state.recipe.nutrition.totals)
                    .filter((r) => MAIN_NUTRIENTS.includes(r.key))
                    .map((row) => (
                      <li key={row.key} className="nutrient-row static" data-testid={`shared-nutrient-${row.key}`}>
                        <NutrientLine row={row} name={nutrientName(row.key, state.recipe.nutrientNames[row.key] ?? row.key)} />
                      </li>
                    ))}
                </ul>
                {state.recipe.nutrition.disclosures.length > 0 && (
                  <ul className="disclosures">
                    {state.recipe.nutrition.disclosures.map((d, idx) => (
                      <li key={idx}>{disclosureText(d.code, state.recipe.ingredients.find((i) => i.id === d.ingredientId)?.name ?? t("editor.anIngredient"))}</li>
                    ))}
                  </ul>
                )}
                <p className="fine">
                  {t("shared.estimatedFrom")}{" "}
                  <a href={state.recipe.source.url} target="_blank" rel="noopener noreferrer">
                    {state.recipe.source.name}
                  </a>{" "}
                  {t("shared.fine", { version: state.recipe.nutrition.catalogVersion })}
                </p>
              </section>
            </div>

            <div className="public-cta">
              {account && engine ? (
                saved ? (
                  <button type="button" className="btn-primary" onClick={() => navigate(`/recipe/${saved}`)}>
                    {t("shared.openCopy")}
                  </button>
                ) : (
                  <button type="button" className="btn-primary" onClick={() => void saveCopy(state.recipe)}>
                    {t("shared.saveCopy")}
                  </button>
                )
              ) : (
                <a className="btn-primary" href="#/kitchen">
                  {t("shared.makeYourOwn")}
                </a>
              )}
            </div>
          </article>
        )}
      </main>
    </div>
  );
}
