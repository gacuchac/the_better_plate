import { useCallback, useEffect, useState } from "react";
import { LINK_AREAS, type Link, type LinkAccess, type LinkAction, type LinkActivity, type LinkArea, type LinkedAccounts, type LinkPermissions } from "@betterplate/contracts";
import { api, ApiRequestError } from "../api.ts";
import { dateLocale, useT, type MessageKey } from "../i18n.ts";
import { useApp } from "../store.tsx";
import { navigate } from "./common.tsx";

/**
 * Linked accounts (ADR-015): share parts of your account with someone, one toggle per area; accept
 * what someone shared with you and switch into their account; see what was done through each link.
 */

const AREA_LABEL: Record<LinkArea, MessageKey> = {
  recipes: "linked.area.recipes",
  plans: "linked.area.plans",
  eaten: "linked.area.eaten",
  goals: "linked.area.goals",
  preferences: "linked.area.preferences",
  shopping: "linked.area.shopping",
  children: "linked.area.children",
  milestones: "linked.area.milestones",
  groups: "linked.area.groups",
  companion: "linked.area.companion",
};

const ACTION_LABEL: Record<LinkAction, MessageKey> = {
  "recipe.save": "linked.action.recipe.save",
  "recipe.delete": "linked.action.recipe.delete",
  "recipe.photo": "linked.action.recipe.photo",
  "recipe.copy": "linked.action.recipe.copy",
  "plan.save": "linked.action.plan.save",
  "plan.delete": "linked.action.plan.delete",
  "meal.log": "linked.action.meal.log",
  "meal.remove": "linked.action.meal.remove",
  "water.log": "linked.action.water.log",
  "water.remove": "linked.action.water.remove",
  "feedback.save": "linked.action.feedback.save",
  "favorite.add": "linked.action.favorite.add",
  "favorite.remove": "linked.action.favorite.remove",
  "goal.save": "linked.action.goal.save",
  "goal.delete": "linked.action.goal.delete",
  "prefs.save": "linked.action.prefs.save",
  "profile.rename": "linked.action.profile.rename",
  "group.plan": "linked.action.group.plan",
  "group.plan.change": "linked.action.group.plan.change",
  "group.plan.remove": "linked.action.group.plan.remove",
  "group.plan.approve": "linked.action.group.plan.approve",
  "group.plan.decline": "linked.action.group.plan.decline",
  "group.recipe": "linked.action.group.recipe",
  "group.share": "linked.action.group.share",
  "group.share.change": "linked.action.group.share.change",
  "group.share.remove": "linked.action.group.share.remove",
  "group.react": "linked.action.group.react",
  "group.comment.remove": "linked.action.group.comment.remove",
  "group.preferences": "linked.action.group.preferences",
  "group.welcome": "linked.action.group.welcome",
  "companion.turn": "linked.action.companion.turn",
  "link.created": "linked.action.link.created",
  "link.accepted": "linked.action.link.accepted",
  "link.permissions": "linked.action.link.permissions",
  "link.ended": "linked.action.link.ended",
};

const ACCESS_LABEL: Record<LinkAccess, MessageKey> = { off: "linked.access.off", view: "linked.access.view", change: "linked.access.change" };

const noAccess = (): LinkPermissions => ({ areas: Object.fromEntries(LINK_AREAS.map((a) => [a, "off"])) as LinkPermissions["areas"], aiApps: false });

const personName = (l: Link) => l.person.name?.trim() || l.person.email;

/** The areas a link shares, in words: "Recipes (change), Plans (view)". */
function useSharedSummary() {
  const t = useT();
  return (p: LinkPermissions) => {
    const on = LINK_AREAS.filter((a) => p.areas[a] !== "off").map((a) => `${t(AREA_LABEL[a])} (${t(ACCESS_LABEL[p.areas[a]])})`);
    return on.length ? on.join(", ") : t("linked.nothingShared");
  };
}

export function AreaToggles({ value, onChange, idPrefix }: { value: LinkPermissions; onChange: (p: LinkPermissions) => void; idPrefix: string }) {
  const t = useT();
  const set = (area: LinkArea, access: LinkAccess) => onChange({ ...value, areas: { ...value.areas, [area]: access } });
  return (
    <div className="stack" data-testid={`${idPrefix}-toggles`}>
      {LINK_AREAS.map((area) => {
        const id = `${idPrefix}-${area}`;
        // The companion is used, never just looked at.
        const choices: LinkAccess[] = area === "companion" ? ["off", "change"] : ["off", "view", "change"];
        return (
          <div key={area} className="link-area">
            <span className="link-area-name" id={id}>{t(AREA_LABEL[area])}</span>
            <div className="segmented" role="radiogroup" aria-labelledby={id}>
              {choices.map((c) => (
                <button key={c} type="button" role="radio" aria-checked={value.areas[area] === c} data-testid={`${id}-${c}`} onClick={() => set(area, c)}>
                  {area === "companion" && c === "change" ? t("linked.access.on") : t(ACCESS_LABEL[c])}
                </button>
              ))}
            </div>
          </div>
        );
      })}
      <label className="check-row">
        <input type="checkbox" checked={value.aiApps} data-testid={`${idPrefix}-ai`} onChange={(e) => onChange({ ...value, aiApps: e.target.checked })} />
        <span>
          {t("linked.aiApps")}
          <span className="fine block">{t("linked.aiAppsHint")}</span>
        </span>
      </label>
    </div>
  );
}

function ActivityList({ who }: { who: "others" | "me" }) {
  const t = useT();
  const [entries, setEntries] = useState<LinkActivity[] | null>(null);
  const [before, setBefore] = useState<string | null>(null);
  const load = useCallback(
    async (cursor?: string) => {
      const page = await api.linkActivity(who, cursor);
      setEntries((prev) => (cursor && prev ? [...prev, ...page.entries] : page.entries));
      setBefore(page.before);
    },
    [who],
  );
  useEffect(() => void load().catch(() => setEntries([])), [load]);
  if (!entries) return <p className="hint">{t("app.opening")}</p>;
  if (!entries.length) return <p className="hint">{who === "others" ? t("linked.activityNone") : t("linked.activityNoneMine")}</p>;
  return (
    <>
      <ul className="row-list" data-testid={`link-activity-${who}`}>
        {entries.map((e) => (
          <li key={e.id} className="row-item">
            <span className="row-text">
              <span className="row-label" data-private>
                {who === "others" ? e.actor.name : e.account.name || t("linked.someone")}
              </span>
              <span className="row-value">
                {t(ACTION_LABEL[e.action])}
                {e.via === "connector" ? ` · ${t("linked.viaApp", { app: e.appName || t("linked.anAiApp") })}` : ""}
                {" · "}
                {new Date(e.at).toLocaleString(dateLocale(), { dateStyle: "medium", timeStyle: "short" })}
              </span>
            </span>
          </li>
        ))}
      </ul>
      {before && (
        <button type="button" className="btn-link" onClick={() => void load(before)}>
          {t("linked.olderActivity")}
        </button>
      )}
    </>
  );
}

function GivenLink({ link, onChanged }: { link: Link; onChanged: () => void }) {
  const t = useT();
  const summary = useSharedSummary();
  const [editing, setEditing] = useState(false);
  const [perms, setPerms] = useState(link.permissions);
  const [error, setError] = useState<string | null>(null);
  const waiting = link.status === "requested";

  async function save() {
    setError(null);
    try {
      await api.updateLink(link.id, perms);
      setEditing(false);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : t("linked.offline"));
    }
  }
  async function end() {
    if (!confirm(waiting ? t("linked.cancelConfirm", { who: personName(link) }) : t("linked.removeConfirm", { who: personName(link) }))) return;
    try {
      await api.endLink(link.id);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : t("linked.offline"));
    }
  }

  return (
    <li className="card link-card" data-testid="given-link">
      <p className="row-label" data-private>{personName(link)}</p>
      <p className="fine">{waiting ? t("linked.waiting") : t("linked.active")}</p>
      {!editing && <p className="row-value">{summary(link.permissions)}{link.permissions.aiApps ? ` · ${t("linked.aiAppsOn")}` : ""}</p>}
      {editing && <AreaToggles value={perms} onChange={setPerms} idPrefix={`edit-${link.id}`} />}
      <div className="banner-actions">
        {editing ? (
          <>
            <button type="button" className="btn-primary" data-testid="save-link" onClick={() => void save()}>{t("linked.save")}</button>
            <button type="button" className="btn-secondary" onClick={() => { setPerms(link.permissions); setEditing(false); }}>{t("linked.cancelEdit")}</button>
          </>
        ) : (
          <>
            <button type="button" className="btn-secondary" data-testid="edit-link" onClick={() => setEditing(true)}>{t("linked.change")}</button>
            <button type="button" className="btn-link danger" data-testid="end-link" onClick={() => void end()}>{waiting ? t("linked.cancelRequest") : t("linked.remove")}</button>
          </>
        )}
      </div>
      {error && <p className="error" role="alert">{error}</p>}
    </li>
  );
}

function ReceivedLink({ link, onChanged }: { link: Link; onChanged: () => void }) {
  const t = useT();
  const summary = useSharedSummary();
  const { acting, switchAccount } = useApp();
  const [error, setError] = useState<string | null>(null);
  const waiting = link.status === "requested";
  const here = acting?.linkId === link.id;

  async function run(action: () => Promise<unknown>) {
    setError(null);
    try {
      await action();
      onChanged();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : t("linked.offline"));
    }
  }

  return (
    <li className="card link-card" data-testid={waiting ? "link-request" : "received-link"}>
      <p className="row-label" data-private>{personName(link)}</p>
      <p className="fine">{waiting ? t("linked.requestFrom") : t("linked.youCanUse")}</p>
      <p className="row-value">{summary(link.permissions)}</p>
      {waiting && link.permissions.aiApps && <p className="fine">{t("linked.aiAppsAllowed")}</p>}
      <div className="banner-actions">
        {waiting ? (
          <>
            <button type="button" className="btn-primary" data-testid="accept-link" onClick={() => void run(() => api.acceptLink(link.id))}>{t("linked.accept")}</button>
            <button type="button" className="btn-secondary" data-testid="decline-link" onClick={() => void run(() => api.endLink(link.id))}>{t("linked.decline")}</button>
          </>
        ) : (
          <>
            {!here && (
              <button type="button" className="btn-primary" data-testid="switch-to" onClick={() => void run(async () => { await switchAccount(link.person.id); navigate("/home"); })}>
                {t("linked.switchTo", { who: personName(link) })}
              </button>
            )}
            <button
              type="button"
              className="btn-link danger"
              data-testid="leave-link"
              onClick={() => confirm(t("linked.leaveConfirm", { who: personName(link) })) && void run(async () => { if (here) await switchAccount(null); await api.endLink(link.id); })}
            >
              {t("linked.leave")}
            </button>
          </>
        )}
      </div>
      {error && <p className="error" role="alert">{error}</p>}
    </li>
  );
}

function ShareForm({ onSent }: { onSent: () => void }) {
  const t = useT();
  const [email, setEmail] = useState("");
  const [perms, setPerms] = useState(noAccess);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const anything = LINK_AREAS.some((a) => perms.areas[a] !== "off");

  async function send(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api.shareAccount(email.trim(), perms);
      setSent(email.trim());
      setEmail("");
      setPerms(noAccess());
      onSent();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : t("linked.offline"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="stack" onSubmit={(e) => void send(e)} data-testid="share-form">
      <label htmlFor="share-email">{t("linked.shareEmail")}</label>
      <input id="share-email" type="email" required autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} data-private />
      <p className="fine">{t("linked.shareHint")}</p>
      <AreaToggles value={perms} onChange={setPerms} idPrefix="share" />
      <button type="submit" className="btn-primary" disabled={busy || !anything || !email.trim()} data-testid="send-link">
        {t("linked.send")}
      </button>
      {!anything && <p className="fine">{t("linked.pickSomething")}</p>}
      {sent && <p className="hint" role="status">{t("linked.sent", { email: sent })}</p>}
      {error && <p className="error" role="alert">{error}</p>}
    </form>
  );
}

export function LinkedAccountsScreen() {
  const t = useT();
  const { online } = useApp();
  const [links, setLinks] = useState<LinkedAccounts | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"others" | "me">("others");
  const load = useCallback(async () => {
    try {
      setLinks(await api.linkedAccounts());
      setError(null);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : t("linked.offline"));
    }
  }, [t]);
  useEffect(() => void load(), [load, online]);

  const requests = links?.received.filter((l) => l.status === "requested") ?? [];
  const usable = links?.received.filter((l) => l.status === "active") ?? [];

  return (
    <div className="screen">
      <h1>{t("linked.title")}</h1>
      <p className="hint">{t("linked.intro")}</p>
      {error && <p className="error" role="alert">{error}</p>}

      {requests.length > 0 && (
        <section aria-labelledby="link-requests-h">
          <h2 className="section-h" id="link-requests-h">{t("linked.requestsTitle")}</h2>
          <ul className="stack plain">{requests.map((l) => <ReceivedLink key={l.id} link={l} onChanged={() => void load()} />)}</ul>
        </section>
      )}

      <section aria-labelledby="link-usable-h">
        <h2 className="section-h" id="link-usable-h">{t("linked.usableTitle")}</h2>
        {usable.length ? (
          <ul className="stack plain">{usable.map((l) => <ReceivedLink key={l.id} link={l} onChanged={() => void load()} />)}</ul>
        ) : (
          <p className="hint">{t("linked.usableNone")}</p>
        )}
      </section>

      <section aria-labelledby="link-given-h">
        <h2 className="section-h" id="link-given-h">{t("linked.givenTitle")}</h2>
        {links?.given.length ? (
          <ul className="stack plain">{links.given.map((l) => <GivenLink key={l.id} link={l} onChanged={() => void load()} />)}</ul>
        ) : (
          <p className="hint">{t("linked.givenNone")}</p>
        )}
      </section>

      <section aria-labelledby="link-share-h">
        <h2 className="section-h" id="link-share-h">{t("linked.shareTitle")}</h2>
        <ShareForm onSent={() => void load()} />
      </section>

      <section aria-labelledby="link-activity-h">
        <h2 className="section-h" id="link-activity-h">{t("linked.activityTitle")}</h2>
        <div className="segmented" role="tablist" aria-label={t("linked.activityTitle")} style={{ marginBottom: 12 }}>
          <button type="button" role="tab" aria-selected={tab === "others"} onClick={() => setTab("others")}>{t("linked.activityOthers")}</button>
          <button type="button" role="tab" aria-selected={tab === "me"} onClick={() => setTab("me")}>{t("linked.activityMine")}</button>
        </div>
        <ActivityList key={tab} who={tab} />
      </section>
    </div>
  );
}

/** Shown on every screen while working in someone else's account. */
export function ActingBanner() {
  const t = useT();
  const { account, acting, switchAccount } = useApp();
  const summary = useSharedSummary();
  const [error, setError] = useState<string | null>(null);
  if (!acting || !account) return null;
  const who = account.displayName?.trim() || account.email;
  return (
    <div className="banner banner-info acting-banner" role="status" data-testid="acting-banner">
      <p>
        <strong data-private>{t("linked.inAccount", { who })}</strong> {t("linked.sharedHere", { areas: summary(acting.permissions) })}
      </p>
      <div className="banner-actions">
        <button
          type="button"
          className="btn-secondary"
          data-testid="switch-back"
          onClick={() =>
            void switchAccount(null)
              .then(() => navigate("/home"))
              .catch((err) => setError(err instanceof ApiRequestError ? err.message : t("linked.offline")))
          }
        >
          {t("linked.switchBack")}
        </button>
      </div>
      {error && <p className="error">{error}</p>}
    </div>
  );
}

/** Screens for an area the owner doesn't share say so, instead of looking empty. */
export function NotShared({ area, ownerOnly = false }: { area: LinkArea; ownerOnly?: boolean }) {
  const t = useT();
  const { account } = useApp();
  return (
    <div className="screen" data-testid="not-shared">
      <h1>{t(AREA_LABEL[area])}</h1>
      <p className="hint" data-private>{ownerOnly ? t("linked.ownerOnly") : t("linked.notShared", { who: account?.displayName?.trim() || account?.email || "" })}</p>
    </div>
  );
}
