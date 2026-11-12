import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { Cheer, MilestoneKind, Milestones } from "@betterplate/contracts";
import { track } from "../activity.ts";
import { api, ApiRequestError, NetworkError } from "../api.ts";
import { localDate } from "../meals.ts";
import { dismiss, isDismissed, markExplained, suggestMilestones, wasExplained, type MilestoneSuggestion } from "../milestones.ts";
import { useApp } from "../store.tsx";
import { useT, type MessageKey } from "../i18n.ts";
import { Sheet } from "./common.tsx";
import { Icon, type IconName } from "./icons.tsx";

// ---------- shared state: one fetch for the home card and the cheers page ----------
// The server decides whether milestones are on (FEATURE_COMMUNITY_MILESTONES_ENABLED).

type State = { data: Milestones | null; available: boolean | null; offline: boolean };
let state: State = { data: null, available: null, offline: false };
const listeners = new Set<() => void>();
const set = (next: Partial<State>) => {
  state = { ...state, ...next };
  for (const l of listeners) l();
};

export async function refreshMilestones(): Promise<void> {
  try {
    set({ data: await api.milestones(), available: true, offline: false });
  } catch (err) {
    if (err instanceof ApiRequestError && err.code === "feature_disabled") set({ available: false });
    else set({ offline: err instanceof NetworkError });
  }
}

function useMilestones(): State {
  const { online, account } = useApp();
  const current = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => state,
  );
  useEffect(() => {
    if (online && account) void refreshMilestones();
  }, [online, account?.id]);
  return online ? current : { ...current, offline: true };
}

export const CHEERS: { value: Cheer; icon: IconName; label: MessageKey }[] = [
  { value: "well_done", icon: "check", label: "cheer.well_done" },
  { value: "keep_going", icon: "forward", label: "cheer.keep_going" },
  { value: "love_this", icon: "heart", label: "cheer.love_this" },
];

/** The words for each kind: "yours" talks to the person, "post" describes someone else's. */
const TEXT: Record<"yours" | "post", Record<MilestoneKind, MessageKey>> = {
  yours: {
    new_plant: "milestones.yours.new_plant",
    home_dinners: "milestones.yours.home_dinners",
    new_recipe: "milestones.yours.new_recipe",
    community_cooked: "milestones.yours.community_cooked",
    planned_and_ate: "milestones.yours.planned_and_ate",
  },
  post: {
    new_plant: "milestones.post.new_plant",
    home_dinners: "milestones.post.home_dinners",
    new_recipe: "milestones.post.new_recipe",
    community_cooked: "milestones.post.community_cooked",
    planned_and_ate: "milestones.post.planned_and_ate",
  },
};

export function milestoneText(t: ReturnType<typeof useT>, side: "yours" | "post", m: { kind: MilestoneKind; foodName: string | null }): string {
  return t(TEXT[side][m.kind], { food: m.foodName ?? "" });
}

// ---------- home: one card, a suggestion to share or a nudge to cheer others ----------

/** One slot on Your Kitchen. Shows nothing offline, when switched off, or with nothing to say. */
export function MilestoneCard() {
  const { logs, catalog } = useApp();
  const t = useT();
  const { data, available, offline } = useMilestones();
  const [hidden, setHidden] = useState(0); // bumps after "Not now" to re-read this device's list
  const [explaining, setExplaining] = useState<MilestoneSuggestion | null>(null);
  const [justShared, setJustShared] = useState<{ id: string; suggestion: MilestoneSuggestion } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  const suggestion = useMemo(() => {
    if (!data || catalog.status !== "ready") return null;
    const shared = new Set(data.mine.map((m) => `${m.kind}:${m.week}`));
    return (
      suggestMilestones({ logs, foods: catalog.foods, today: localDate(), communityCopyIds: data.communityCopyIds, newRecipeIds: data.newRecipeIds }).find(
        (s) => !shared.has(`${s.kind}:${s.week}`) && !isDismissed(s),
      ) ?? null
    );
  }, [data, logs, catalog, hidden]);

  if (available !== true || offline || !data) return null;

  async function share(s: MilestoneSuggestion) {
    setBusy(true);
    setError(false);
    try {
      const m = await api.shareMilestone({ kind: s.kind, week: s.week, foodId: s.foodId });
      track("Shared a milestone");
      markExplained();
      setExplaining(null);
      setJustShared({ id: m.milestoneId, suggestion: s });
      await refreshMilestones();
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  async function undo() {
    if (!justShared) return;
    setBusy(true);
    try {
      await api.unshareMilestone(justShared.id);
      track("Took back a shared milestone");
      setJustShared(null);
      await refreshMilestones();
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  if (justShared)
    return (
      <div className="card milestone-card" data-testid="milestone-card" role="status">
        <span className="eyebrow">
          <Icon name="sparkle" size={16} /> {t("milestones.eyebrow")}
        </span>
        <strong>{milestoneText(t, "yours", justShared.suggestion)}</strong>
        <span className="hint" style={{ margin: 0 }}>{t("milestones.shared")}</span>
        <div className="milestone-actions">
          <a className="btn-soft" href="#/cheers">{t("milestones.seeCheers")}</a>
          <button type="button" className="btn-link" disabled={busy} onClick={() => void undo()}>
            {t("milestones.undo")}
          </button>
        </div>
        {error && <p className="hint" role="alert">{t("milestones.error")}</p>}
      </div>
    );

  if (suggestion)
    return (
      <div className="card milestone-card" data-testid="milestone-card">
        <span className="eyebrow">
          <Icon name="sparkle" size={16} /> {t("milestones.eyebrow")}
        </span>
        <strong>{milestoneText(t, "yours", suggestion)}</strong>
        <span className="hint" style={{ margin: 0 }}>{t("milestones.cardHint")}</span>
        <div className="milestone-actions">
          <button type="button" className="btn-primary" disabled={busy} onClick={() => (wasExplained() ? void share(suggestion) : setExplaining(suggestion))}>
            <Icon name="share" size={18} /> {t("milestones.share")}
          </button>
          <button
            type="button"
            className="btn-link"
            onClick={() => {
              dismiss(suggestion);
              track("Skipped a milestone");
              setHidden((n) => n + 1);
            }}
          >
            {t("milestones.notNow")}
          </button>
        </div>
        {error && <p className="hint" role="alert">{t("milestones.error")}</p>}
        {explaining && (
          <Sheet title={t("milestones.sheetTitle")} onClose={() => setExplaining(null)}>
            <p>{t("milestones.sheetWillSee")}</p>
            <p className="milestone-quote" data-testid="milestone-preview">{milestoneText(t, "post", explaining)}</p>
            <p className="hint">{t("milestones.sheetFine")}</p>
            <div className="actions">
              <button type="button" className="btn-primary" disabled={busy} onClick={() => void share(explaining)}>
                {t("milestones.share")}
              </button>
              <button type="button" className="btn-link" onClick={() => setExplaining(null)}>
                {t("milestones.cancel")}
              </button>
            </div>
            {error && <p className="hint" role="alert">{t("milestones.error")}</p>}
          </Sheet>
        )}
      </div>
    );

  const toCheer = data.feed.filter((p) => !p.myCheer).length;
  if (toCheer === 0) return null;
  return (
    <a className="card milestone-card" href="#/cheers" data-testid="cheer-others-card">
      <span className="eyebrow">
        <Icon name="heart" size={16} /> {t("milestones.cheerOthers")}
      </span>
      <span className="hint" style={{ margin: 0 }}>{t("milestones.cheerOthersHint")}</span>
    </a>
  );
}

// ---------- the cheers page: others' milestones to cheer, then yours ----------

export function CheersPage() {
  const t = useT();
  const { data, available, offline } = useMilestones();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => track("Opened cheers"), []);

  async function act(id: string, run: () => Promise<void>) {
    setBusy(id);
    setError(false);
    try {
      await run();
      await refreshMilestones();
    } catch {
      setError(true);
    } finally {
      setBusy(null);
    }
  }

  if (available === false) return null;
  if (offline && !data) return <p className="hint pad">{t("milestones.offline")}</p>;
  if (!data) return <p className="hint pad">{t("common.loading")}</p>;

  return (
    <div className="screen cheers" data-testid="cheers-page">
      <h1>{t("milestones.pageTitle")}</h1>
      {error && <p className="hint" role="alert">{t("milestones.error")}</p>}

      <section aria-labelledby="cheer-others">
        <h2 id="cheer-others" className="h3">{t("milestones.others")}</h2>
        {data.feed.length === 0 ? (
          <p className="hint">{t("milestones.othersEmpty")}</p>
        ) : (
          <ul className="row-list">
            {data.feed.map((p) => {
              const text = milestoneText(t, "post", p);
              return (
                <li key={p.milestoneId} className="milestone-row" data-testid="milestone-post">
                  <span className="milestone-text">{text}</span>
                  <span className="cheer-buttons" role="group" aria-label={text}>
                    {CHEERS.map((c) => {
                      const on = p.myCheer === c.value;
                      return (
                        <button
                          key={c.value}
                          type="button"
                          className={`cheer${on ? " is-on" : ""}`}
                          aria-pressed={on}
                          disabled={busy === p.milestoneId || offline}
                          onClick={() =>
                            void act(p.milestoneId, async () => {
                              if (on) await api.uncheer(p.milestoneId);
                              else {
                                await api.cheer(p.milestoneId, c.value);
                                track("Cheered a milestone");
                              }
                            })
                          }
                        >
                          <Icon name={c.icon} size={16} /> {t(c.label)}
                        </button>
                      );
                    })}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section aria-labelledby="my-milestones">
        <h2 id="my-milestones" className="h3">{t("milestones.mine")}</h2>
        {data.mine.length === 0 ? (
          <p className="hint">{t("milestones.mineEmpty")}</p>
        ) : (
          <ul className="row-list">
            {data.mine.map((m) => {
              const total = m.cheers.well_done + m.cheers.keep_going + m.cheers.love_this;
              return (
                <li key={m.milestoneId} className="milestone-row" data-testid="my-milestone">
                  <span className="milestone-text">
                    {milestoneText(t, "post", m)}
                    {/* Never a zero: a milestone with no cheers yet just says it's shared. */}
                    <span className="hint" style={{ margin: 0, display: "block" }} data-testid="my-milestone-cheers">
                      {total > 0 ? t("milestones.cheerCount", { n: total }) : t("milestones.noCheersYet")}
                    </span>
                  </span>
                  <button
                    type="button"
                    className="btn-link"
                    disabled={busy === m.milestoneId || offline}
                    onClick={() => void act(m.milestoneId, () => api.unshareMilestone(m.milestoneId))}
                  >
                    {t("milestones.unshare")}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>
      <p className="hint">{t("milestones.fine")}</p>
    </div>
  );
}
