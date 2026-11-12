import { useEffect, useState } from "react";
import type { CommunityHome, CommunityReason, CommunityRecipe, CommunityStatus, RecipeBody } from "@betterplate/contracts";
import { track } from "../activity.ts";
import { api, ApiRequestError, NetworkError } from "../api.ts";
import type { LocalRecipe } from "../localdb.ts";
import { localDate } from "../meals.ts";
import { useApp } from "../store.tsx";
import { dateLocale, t as translate, useT, type MessageKey } from "../i18n.ts";
import { navigate, Sheet } from "./common.tsx";
import { RecipePhoto } from "./Photos.tsx";
import { SnapshotDetails } from "./Share.tsx";
import { Icon } from "./icons.tsx";

// ---------- availability: the server decides (FEATURE_COMMUNITY_RECIPES_ENABLED) ----------

let available: boolean | null = null;
const disabled = (err: unknown) => err instanceof ApiRequestError && err.code === "feature_disabled";

/** Community picks for home. available is false only when the server has community recipes switched off. */
export function useCommunityHome(): { home: CommunityHome | null; available: boolean | null; offline: boolean } {
  const { online, account } = useApp();
  const [home, setHome] = useState<CommunityHome | null>(null);
  const [state, setState] = useState<boolean | null>(available);
  const [offline, setOffline] = useState(false);
  useEffect(() => {
    if (!online || !account) {
      setOffline(!online);
      return;
    }
    let cancelled = false;
    api.communityHome(localDate()).then(
      (h) => {
        if (cancelled) return;
        available = true;
        setState(true);
        setOffline(false);
        setHome(h);
      },
      (err) => {
        if (cancelled) return;
        if (disabled(err)) available = false;
        setState(available);
        setOffline(err instanceof NetworkError);
      },
    );
    return () => void (cancelled = true);
  }, [online, account?.id]);
  return { home, available: state, offline };
}

/** Whether to offer sharing with the community: hidden only once the server said it is off. */
export function useCommunityAvailable(): boolean {
  const { online } = useApp();
  const [state, setState] = useState<boolean | null>(available);
  useEffect(() => {
    if (available !== null || !online) return;
    api.communityHome(localDate()).then(
      () => setState((available = true)),
      (err) => disabled(err) && setState((available = false)),
    );
  }, [online]);
  return state !== false;
}

function problemText(err: unknown) {
  if (err instanceof NetworkError) return translate("community.errOffline");
  if (err instanceof ApiRequestError && err.status === 429) return translate("share.errTooMany");
  if (err instanceof ApiRequestError && err.status === 404) return translate("share.errNotSynced");
  return translate("share.errGeneric");
}

// ---------- the author's side: review, share, update, stop sharing ----------

/**
 * Review what everyone signed in will see, then share it with the community. Only the listed fields
 * go; never the author's name, email, meals or other recipes.
 */
export function CommunitySheet({ recipe, onClose }: { recipe: LocalRecipe; onClose: () => void }) {
  const { online, engine } = useApp();
  const t = useT();
  const body: RecipeBody = recipe.body;
  const synced = recipe.state === "synced" && recipe.serverVersion !== null;
  const [status, setStatus] = useState<CommunityStatus | null | undefined>(undefined);
  const [includeMethod, setIncludeMethod] = useState(false);
  const [includeImage, setIncludeImage] = useState(true);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const withImage = includeImage && !!body.image;

  useEffect(() => {
    if (!online || !synced || recipe.groupId) return;
    api.communityStatus(recipe.id).then(
      (s) => {
        setStatus(s);
        setIncludeMethod(s.includeMethod);
        setIncludeImage(s.includeImage);
      },
      (err) => (err instanceof ApiRequestError && err.code === "not_shared" ? setStatus(null) : setProblem(problemText(err))),
    );
  }, [online, synced, recipe.id, recipe.groupId]);

  async function share() {
    setBusy(true);
    setProblem(null);
    try {
      setStatus(await api.shareWithCommunity(recipe.id, { includeMethod, includeImage: withImage }));
      track(status ? "Updated a community recipe" : "Shared a recipe with the community");
    } catch (err) {
      setProblem(problemText(err));
    } finally {
      setBusy(false);
    }
  }

  async function unshare() {
    if (!confirm(t("community.unshareConfirm"))) return;
    setBusy(true);
    try {
      await api.unshareFromCommunity(recipe.id);
      track("Stopped sharing a recipe with the community");
      setStatus(null);
    } catch (err) {
      setProblem(problemText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet title={t("community.shareTitle")} onClose={onClose}>
      {recipe.groupId ? (
        <p className="banner banner-warn" role="status">{t("community.groupRecipe")}</p>
      ) : !online ? (
        <p className="banner banner-warn" role="status">{t("community.errOffline")}</p>
      ) : !synced ? (
        <div className="banner banner-warn" role="status">
          <p>{t("share.syncFirst")}</p>
          <button type="button" className="btn-secondary" onClick={() => void engine?.syncNow()}>
            {t("sync.now")}
          </button>
        </div>
      ) : status === undefined ? (
        <p className="hint">{t("common.loading")}</p>
      ) : (
        <>
          {status && (
            <p className="banner" role="status" data-testid="community-shared">
              {status.hidden
                ? t("community.hidden")
                : t("community.sharedSince", { date: new Date(status.sharedAt).toLocaleDateString(dateLocale(), { day: "numeric", month: "short" }) })}
              {status.recipeVersion !== recipe.serverVersion && !status.hidden ? ` ${t("community.olderVersion")}` : ""}
            </p>
          )}
          <p className="hint">{t("community.willSee")}</p>
          <div className="card share-preview" data-testid="community-preview">
            {withImage && body.image && <RecipePhoto image={body.image} compact />}
            <strong className="recipe-title">{body.title}</strong>
            {body.description && <p className="hint">{body.description}</p>}
            <ul>
              <li>{t("share.seeIngredients", { servings: t("common.servings", { n: body.servings }), ingredients: t("share.ingredients", { n: body.ingredients.length }) })}</li>
              <li>{t("share.seeNutrition")}</li>
              {includeMethod && <li>{t("share.seeMethod")}</li>}
              {withImage && <li>{t("share.seePhoto")}</li>}
            </ul>
            <p className="fine" style={{ marginTop: 8 }}>{t("share.never")}</p>
          </div>
          <label className="check">
            <input type="checkbox" checked={includeMethod} disabled={!body.method} onChange={(e) => setIncludeMethod(e.target.checked)} />
            {body.method ? t("share.includeMethod") : t("share.includeMethodNone")}
          </label>
          {body.image && (
            <label className="check">
              <input type="checkbox" checked={includeImage} onChange={(e) => setIncludeImage(e.target.checked)} />
              {t("share.includePhoto")}
            </label>
          )}
          <div className="sheet-actions">
            <button type="button" className="btn-primary" disabled={busy} onClick={() => void share()}>
              {status ? t("community.update") : t("community.share")}
            </button>
            {status && (
              <button type="button" className="btn-link danger" disabled={busy} onClick={() => void unshare()}>
                {t("community.unshare")}
              </button>
            )}
          </div>
          <p className="fine">{t("community.fine")}</p>
        </>
      )}
      {problem && (
        <p className="error" role="alert">
          {problem}
        </p>
      )}
    </Sheet>
  );
}

// ---------- the reader's side ----------

export function CommunityTile({ card }: { card: CommunityHome["trending"][number] }) {
  return (
    <li>
      <a className="tile" href={`#/community/${card.communityId}`} data-testid="community-tile">
        {card.image ? (
          <img className="trail-photo" src={card.image.url} alt="" loading="lazy" crossOrigin="use-credentials" />
        ) : (
          <span className="trail-photo monogram" aria-hidden="true">
            {card.title.trim().charAt(0).toUpperCase() || "?"}
          </span>
        )}
        <span className="tile-title">{card.title}</span>
      </a>
    </li>
  );
}

const REASONS: { value: CommunityReason; label: MessageKey }[] = [
  { value: "not_food", label: "community.reasonNotFood" },
  { value: "offensive", label: "community.reasonOffensive" },
  { value: "unsafe", label: "community.reasonUnsafe" },
  { value: "spam", label: "community.reasonSpam" },
  { value: "other", label: "community.reasonOther" },
];

function ReportSheet({ communityId, onClose }: { communityId: string; onClose: () => void }) {
  const t = useT();
  const [reason, setReason] = useState<CommunityReason>("not_food");
  const [done, setDone] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  async function send() {
    try {
      await api.reportCommunity(communityId, reason);
      track("Reported a community recipe");
      setDone(true);
    } catch (err) {
      setProblem(problemText(err));
    }
  }
  return (
    <Sheet title={t("community.reportTitle")} onClose={onClose}>
      {done ? (
        <p className="hint" role="status" data-testid="report-done">{t("community.reportThanks")}</p>
      ) : (
        <>
          <fieldset className="radio-list">
            <legend className="hint">{t("community.reportWhy")}</legend>
            {REASONS.map((r) => (
              <label key={r.value} className="check">
                <input type="radio" name="report-reason" value={r.value} checked={reason === r.value} onChange={() => setReason(r.value)} />
                {t(r.label)}
              </label>
            ))}
          </fieldset>
          <div className="sheet-actions">
            <button type="button" className="btn-primary" onClick={() => void send()}>
              {t("community.reportSend")}
            </button>
          </div>
          <p className="fine">{t("community.reportFine")}</p>
        </>
      )}
      {problem && (
        <p className="error" role="alert">
          {problem}
        </p>
      )}
    </Sheet>
  );
}

/** A community recipe inside the app: the author's reviewed snapshot, nothing about who wrote it. */
export function CommunityRecipePage({ id }: { id: string }) {
  const { engine } = useApp();
  const t = useT();
  const [state, setState] = useState<{ status: "loading" } | { status: "ok"; recipe: CommunityRecipe } | { status: "gone" } | { status: "error"; message: string }>({ status: "loading" });
  const [busy, setBusy] = useState(false);
  const [reporting, setReporting] = useState(false);

  useEffect(() => {
    track("Opened a community recipe");
    api.communityRecipe(id).then(
      (recipe) => setState({ status: "ok", recipe }),
      (err) => {
        if (err instanceof ApiRequestError && (err.status === 404 || err.status === 400)) setState({ status: "gone" });
        else setState({ status: "error", message: err instanceof NetworkError ? t("community.errOffline") : t("shared.error") });
      },
    );
  }, [id]);

  async function save() {
    setBusy(true);
    try {
      const { recipeId } = await api.saveCommunityCopy(id);
      track("Saved a copy of a community recipe");
      // The copy was made on the server; bring it to this device before opening it.
      await engine?.syncNow();
      navigate(`/recipe/${recipeId}`);
    } catch (err) {
      setState({ status: "error", message: problemText(err) });
    } finally {
      setBusy(false);
    }
  }

  if (state.status === "loading") return <p className="hint pad">{t("shared.opening")}</p>;
  if (state.status === "gone")
    return (
      <div className="screen">
        <div className="empty" data-testid="community-gone">
          <h1 className="h3">{t("community.goneTitle")}</h1>
          <p>{t("community.goneBody")}</p>
        </div>
      </div>
    );
  if (state.status === "error")
    return (
      <div className="screen">
        <p className="banner banner-warn" role="alert">
          {state.message}
        </p>
      </div>
    );
  const recipe = state.recipe;
  return (
    <article className="screen" data-testid="community-recipe">
      <p className="eyebrow">{t("community.eyebrow")}</p>
      {recipe.image && <RecipePhoto image={recipe.image} signedIn />}
      <h1 className="shared-title">{recipe.title}</h1>
      {recipe.description && <p className="lede shared-description">{recipe.description}</p>}
      <p className="hint">
        {t("common.servings", { n: recipe.servings })} ·{" "}
        {t("shared.sharedOn", { date: new Date(recipe.sharedAt).toLocaleDateString(dateLocale(), { day: "numeric", month: "long", year: "numeric" }) })}
      </p>
      <div className="public-cta">
        {recipe.mine ? (
          <p className="hint">{t("community.yours")}</p>
        ) : recipe.savedRecipeId ? (
          <button type="button" className="btn-primary" onClick={() => navigate(`/recipe/${recipe.savedRecipeId}`)}>
            {t("shared.openCopy")}
          </button>
        ) : (
          <button type="button" className="btn-primary" disabled={busy || !engine} onClick={() => void save()}>
            {t("shared.saveCopy")}
          </button>
        )}
        {!recipe.mine && (
          <button type="button" className="btn-link" onClick={() => setReporting(true)}>
            <Icon name="flag" size={16} /> {t("community.report")}
          </button>
        )}
      </div>
      <SnapshotDetails recipe={recipe} />
      {reporting && <ReportSheet communityId={id} onClose={() => setReporting(false)} />}
    </article>
  );
}
