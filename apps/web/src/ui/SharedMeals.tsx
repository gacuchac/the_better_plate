import { useCallback, useEffect, useState } from "react";
import type { GroupDetail, MealReactionKind, MealsToReview, MyGroupInvite, Recipe, RecipeImage, SharedMeal } from "@betterplate/contracts";
import { SHARED_MEAL_SUMMARY_MAX, MEAL_COMMENT_MAX } from "@betterplate/contracts";
import { track } from "../activity.ts";
import { api, ApiRequestError } from "../api.ts";
import { formatNutrient, nutrientName, useT } from "../i18n.ts";
import { useApp } from "../store.tsx";
import { navigate, Sheet } from "./common.tsx";
import { Icon } from "./icons.tsx";
import { PhotoSheet, RecipePhoto } from "./Photos.tsx";

/**
 * Groups, part two: people added by email (who join with a tap after signing in) and meals the
 * group's admins share as a simplified card (photo, short description, estimated nutrients; never
 * the recipe) that each person can like or pass on, with an optional comment.
 */

const message = (err: unknown, fallback: string) => (err instanceof ApiRequestError ? err.message : fallback);
const disabled = (err: unknown) => err instanceof ApiRequestError && err.code === "feature_disabled";

// ---------- people added by email ----------

export function AddByEmailSheet({ group, onClose, onDone }: { group: GroupDetail; onClose: () => void; onDone: (g: GroupDetail, note: string) => void }) {
  const t = useT();
  const { online } = useApp();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<"admin" | "member">("member");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) && name.trim().length > 0;

  async function add() {
    setBusy(true);
    setError(null);
    try {
      const res = await api.addByEmail(group.id, { email: email.trim(), name: name.trim(), role });
      track("Added someone to a group by email");
      onDone(res.group, t(res.emailed ? "groups.added" : "groups.addedNoEmail", { name: name.trim() }));
    } catch (err) {
      setError(message(err, t("groups.offline")));
      setBusy(false);
    }
  }

  return (
    <Sheet title={t("groups.addByEmailTitle")} onClose={onClose}>
      <p className="hint">{t("groups.addByEmailHint")}</p>
      <label htmlFor="pending-email">{t("groups.email")}</label>
      <input id="pending-email" type="email" autoComplete="off" inputMode="email" maxLength={254} value={email} onChange={(e) => setEmail(e.target.value)} />
      <label htmlFor="pending-name">{t("groups.theirName")}</label>
      <input id="pending-name" maxLength={60} value={name} placeholder={t("groups.theirNamePlaceholder")} onChange={(e) => setName(e.target.value)} />
      {group.role === "owner" && (
        <>
          <p className="label">{t("groups.addAs")}</p>
          <div className="choice-row" role="group" aria-label={t("groups.addAs")}>
            {(["member", "admin"] as const).map((r) => (
              <button key={r} type="button" aria-pressed={role === r} onClick={() => setRole(r)}>
                {t(r === "admin" ? "groups.roleAdmin" : "groups.roleMember")}
              </button>
            ))}
          </div>
        </>
      )}
      <p className="fine">{t(role === "admin" ? "groups.adminMeans" : "groups.memberMeans")}</p>
      <p className="fine">{t("groups.addFine")}</p>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="sheet-actions">
        <button type="button" className="btn-primary" disabled={!online || busy || !valid} onClick={() => void add()} data-testid="add-by-email-submit">
          <Icon name="mail" size={18} /> {t("groups.addAndEmail")}
        </button>
      </div>
    </Sheet>
  );
}

/** Rows for people added by email who haven't joined; admins only. */
export function PendingRows({ group, onChanged, onNote }: { group: GroupDetail; onChanged: (g?: GroupDetail) => void; onNote: (note: string | null) => void }) {
  const t = useT();
  const { online } = useApp();
  if (group.pending.length === 0) return null;
  async function run(fn: () => Promise<unknown>, after?: (r: unknown) => void) {
    onNote(null);
    try {
      const r = await fn();
      after?.(r);
    } catch (err) {
      onNote(message(err, t("groups.offline")));
    }
  }
  return (
    <>
      {group.pending.map((p) => (
        <div key={p.id} className="meal-row" data-testid="pending-member">
          <div>
            <div className="meal-name">{p.name}</div>
            <div className="meal-meta">
              {t(p.role === "admin" ? "groups.roleAdmin" : "groups.roleMember")} · {t("groups.invited")} · {p.email}
            </div>
          </div>
          <div className="meal-actions">
            <button
              type="button"
              className="btn-link"
              disabled={!online}
              onClick={() =>
                void run(
                  () => api.resendInvite(group.id, p.id),
                  (r) => {
                    const res = r as { group: GroupDetail; emailed: boolean };
                    onChanged(res.group);
                    onNote(res.emailed ? t("groups.resent", { name: p.name }) : t("groups.addedNoEmail", { name: p.name }));
                  },
                )
              }
            >
              {t("groups.resend")}
            </button>
            <button
              type="button"
              className="icon-btn"
              aria-label={t("groups.removePending", { name: p.name })}
              disabled={!online}
              onClick={() => confirm(t("groups.removePendingConfirm", { name: p.name })) && void run(() => api.removePending(group.id, p.id), () => onChanged())}
            >
              <Icon name="close" />
            </button>
          </div>
        </div>
      ))}
    </>
  );
}

/** Groups that added me by email; shown on the Groups screen until I join or say no. */
export function InvitesForMe({ onJoined }: { onJoined: () => void }) {
  const t = useT();
  const { online, account, engine } = useApp();
  const [invites, setInvites] = useState<MyGroupInvite[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!online || !account) return;
    try {
      setInvites((await api.myGroupInvites()).invites);
    } catch (err) {
      if (!disabled(err)) setError(message(err, t("groups.offline")));
    }
  }, [online, account?.id]);
  useEffect(() => void load(), [load]);

  if (invites.length === 0) return error ? <p className="error" role="alert">{error}</p> : null;

  async function join(inv: MyGroupInvite) {
    setBusy(inv.id);
    setError(null);
    try {
      const g = await api.joinByEmailInvite(inv.id, (names[inv.id] ?? inv.suggestedName).trim());
      track("Joined a group from an email invite");
      onJoined();
      void engine?.syncNow();
      navigate(`/groups/${g.id}`);
    } catch (err) {
      setError(message(err, t("groups.offline")));
      setBusy(null);
    }
  }

  async function decline(inv: MyGroupInvite) {
    if (!confirm(t("groups.declineConfirm", { group: inv.groupName }))) return;
    setError(null);
    try {
      await api.declineEmailInvite(inv.id);
      await load();
    } catch (err) {
      setError(message(err, t("groups.offline")));
    }
  }

  return (
    <section className="card" aria-labelledby="invites-for-me" data-testid="invites-for-me">
      <h2 id="invites-for-me">{t("groups.invitesForYou")}</h2>
      {invites.map((inv) => (
        <div key={inv.id} className="invite-for-me">
          <p className="meal-name">{t("groups.addedYou", { name: inv.invitedBy, group: inv.groupName })}</p>
          <p className="hint">{t(inv.role === "admin" ? "groups.adminMeans" : "groups.memberMeans")}</p>
          <label htmlFor={`invite-name-${inv.id}`}>{t("groups.myName")}</label>
          <input
            id={`invite-name-${inv.id}`}
            maxLength={60}
            value={names[inv.id] ?? inv.suggestedName}
            onChange={(e) => setNames({ ...names, [inv.id]: e.target.value })}
          />
          <div className="sheet-actions">
            <button type="button" className="btn-primary" disabled={!online || busy === inv.id || !(names[inv.id] ?? inv.suggestedName).trim()} onClick={() => void join(inv)}>
              {t("groups.joinNamed", { group: inv.groupName })}
            </button>
            <button type="button" className="btn-link" disabled={!online} onClick={() => void decline(inv)}>
              {t("groups.declineInvite")}
            </button>
          </div>
        </div>
      ))}
      {error && <p className="error" role="alert">{error}</p>}
    </section>
  );
}

/** One line on the home screen: a group added me, or shared meals wait for my answer. */
export function GroupNudge() {
  const t = useT();
  const { online, account } = useApp();
  const [invite, setInvite] = useState<MyGroupInvite | null>(null);
  const [review, setReview] = useState<MealsToReview["groups"][number] | null>(null);
  useEffect(() => {
    if (!online || !account) return;
    api.myGroupInvites().then((r) => setInvite(r.invites[0] ?? null), () => setInvite(null));
    api.mealsToReview().then((r) => setReview(r.groups[0] ?? null), () => setReview(null));
  }, [online, account?.id]);

  if (invite) {
    return (
      <a className="card nudge-card" href="#/groups" data-testid="group-nudge">
        <Icon name="people" size={18} />
        <span>{t("groups.addedYou", { name: invite.invitedBy, group: invite.groupName })}</span>
        <span className="btn-link">{t("groups.seeInvite")}</span>
      </a>
    );
  }
  if (review) {
    return (
      <a className="card nudge-card" href={`#/groups/${review.groupId}`} data-testid="meals-nudge">
        <Icon name="people" size={18} />
        <span>{t("shared.nudge", { group: review.groupName, n: review.count })}</span>
        <span className="btn-link">{t("shared.look")}</span>
      </a>
    );
  }
  return null;
}

// ---------- shared meals ----------

export function SharedMeals({ group, groupRecipes }: { group: GroupDetail; groupRecipes: Recipe[] }) {
  const t = useT();
  const { online } = useApp();
  const admin = group.role === "owner" || group.role === "admin";
  const [meals, setMeals] = useState<SharedMeal[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);

  const load = useCallback(async () => {
    if (!online) return;
    try {
      const page = await api.sharedMeals(group.id);
      setMeals(page.meals);
      setCursor(page.nextCursor);
      setError(null);
    } catch (err) {
      setError(message(err, t("groups.offline")));
    }
  }, [group.id, online]);
  useEffect(() => void load(), [load]);

  async function more() {
    if (!cursor) return;
    try {
      const page = await api.sharedMeals(group.id, cursor);
      setMeals([...(meals ?? []), ...page.meals]);
      setCursor(page.nextCursor);
    } catch (err) {
      setError(message(err, t("groups.offline")));
    }
  }

  const replace = (m: SharedMeal) => setMeals((list) => list?.map((x) => (x.id === m.id ? m : x)) ?? null);

  return (
    <section className="card" aria-labelledby="shared-meals-title" data-testid="shared-meals">
      <div className="card-head">
        <h2 id="shared-meals-title">{t("shared.title")}</h2>
        {admin && (
          <button type="button" className="btn-soft" disabled={!online} onClick={() => setSharing(true)} data-testid="share-meal-open">
            <Icon name="share" size={18} /> {t("shared.share")}
          </button>
        )}
      </div>
      <p className="hint">{t(admin ? "shared.introAdmin" : "shared.introMember")}</p>
      {error && <p className="error" role="alert">{error}</p>}
      {meals && meals.length === 0 && <p className="hint">{t("shared.none")}</p>}
      <ul className="meal-picks">
        {meals?.map((m) => (
          <SharedMealRow key={m.id} meal={m} group={group} onChange={replace} onWithdrawn={() => setMeals((list) => list?.filter((x) => x.id !== m.id) ?? null)} />
        ))}
      </ul>
      {cursor && (
        <button type="button" className="btn-link" onClick={() => void more()}>
          {t("shared.more")}
        </button>
      )}
      {sharing && (
        <ShareMealSheet
          group={group}
          groupRecipes={groupRecipes}
          onClose={() => setSharing(false)}
          onShared={(m) => {
            setMeals([m, ...(meals ?? [])]);
            setSharing(false);
          }}
        />
      )}
    </section>
  );
}

const MACROS = [
  ["energy_kcal", null],
  ["protein", "shared.protein"],
  ["carbohydrate", "shared.carbs"],
  ["fat_total", "shared.fat"],
] as const;

/** "320 kcal · 12 g protein · 45 g carbs · 8 g fat", skipping what the source doesn't report. */
function macroLine(meal: SharedMeal, t: ReturnType<typeof useT>): string {
  return MACROS.flatMap(([key, label]) => {
    const n = meal.nutrients.find((x) => x.key === key);
    if (!n || n.amount === null || n.status === "unknown") return [];
    const value = formatNutrient(n.key, n.amount, n.unit);
    return [label ? `${value} ${t(label)}` : value];
  }).join(" · ");
}

/** A soft tile with the meal's first letter, tinted from its name so a list without photos still reads at a glance. */
function MealThumb({ meal, large = false }: { meal: SharedMeal; large?: boolean }) {
  if (meal.image) return <img className={`meal-thumb${large ? " large" : ""}`} src={meal.image.url} alt={large ? meal.image.alt : ""} loading="lazy" crossOrigin="use-credentials" />;
  let hash = 0;
  for (const ch of meal.title) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return (
    <span className={`meal-thumb monogram tint-${hash % 4}${large ? " large" : ""}`} aria-hidden="true" data-testid="shared-monogram">
      {meal.title.trim().charAt(0).toUpperCase() || "?"}
    </span>
  );
}

function useReact(group: GroupDetail, meal: SharedMeal, onChange: (m: SharedMeal) => void) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(message(err, t("groups.offline")));
    } finally {
      setBusy(false);
    }
  }
  const react = (reaction: MealReactionKind, comment: string) =>
    run(async () => {
      onChange(await api.reactToMeal(group.id, meal.id, reaction, comment.trim()));
      track(reaction === "like" ? "Liked a shared meal" : "Passed on a shared meal");
    });
  const takeBack = () =>
    run(async () => {
      await api.unreactToMeal(group.id, meal.id);
      onChange({ ...meal, myReaction: null, reactions: meal.reactions?.filter((r) => !isMine(group, r.memberId)) ?? null });
    });
  return { busy, error, run, react, takeBack };
}

function Votes({ mine, busy, onVote }: { mine: MealReactionKind | null; busy: boolean; onVote: (r: MealReactionKind) => void }) {
  const t = useT();
  const { online } = useApp();
  return (
    <div className="meal-votes" role="group" aria-label={t("shared.yourAnswer")}>
      {(["like", "dislike"] as const).map((r) => (
        <button
          key={r}
          type="button"
          className={`vote vote-${r}`}
          aria-pressed={mine === r}
          aria-label={t(r === "like" ? "shared.like" : "shared.dislike")}
          title={t(r === "like" ? "shared.like" : "shared.dislike")}
          disabled={!online || busy}
          onClick={() => onVote(r)}
        >
          <Icon name={r === "like" ? "thumbUp" : "thumbDown"} size={20} />
        </button>
      ))}
    </div>
  );
}

function Tally({ meal }: { meal: SharedMeal }) {
  const t = useT();
  if (!meal.reactions) return null;
  if (meal.reactions.length === 0) return <span className="meal-tally">{t("shared.noAnswers")}</span>;
  const likes = meal.reactions.filter((r) => r.reaction === "like").length;
  return (
    <span className="meal-tally" data-testid="meal-tally">
      {t("shared.likes", { n: likes })} · {t("shared.passes", { n: meal.reactions.length - likes })}
    </span>
  );
}

/** One row of the list: photo, name, the start of the description, macros, and thumbs up or down in one tap. */
function SharedMealRow({ meal, group, onChange, onWithdrawn }: { meal: SharedMeal; group: GroupDetail; onChange: (m: SharedMeal) => void; onWithdrawn: () => void }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const { busy, error, react, takeBack } = useReact(group, meal, onChange);
  const mine = meal.myReaction?.reaction ?? null;
  const macros = macroLine(meal, t);
  return (
    <li className="meal-row-pick" data-testid="shared-meal">
      <button type="button" className="meal-open" onClick={() => setOpen(true)} aria-label={t("shared.open", { meal: meal.title })} data-testid="shared-meal-open">
        <MealThumb meal={meal} />
        <span className="meal-text">
          <span className="meal-title">{meal.title}</span>
          {meal.summary && <span className="meal-summary">{meal.summary}</span>}
          {macros && <span className="meal-macros">{macros}</span>}
          <Tally meal={meal} />
        </span>
      </button>
      <Votes mine={mine} busy={busy} onVote={(r) => void (mine === r ? takeBack() : react(r, meal.myReaction?.comment ?? ""))} />
      {error && <p className="error meal-row-error" role="alert">{error}</p>}
      {open && <SharedMealSheet meal={meal} group={group} onChange={onChange} onWithdrawn={onWithdrawn} onClose={() => setOpen(false)} />}
    </li>
  );
}

/** Everything about one shared meal: the whole description, every nutrient, your answer and comment, and for admins everyone's answers. */
function SharedMealSheet({ meal, group, onChange, onWithdrawn, onClose }: { meal: SharedMeal; group: GroupDetail; onChange: (m: SharedMeal) => void; onWithdrawn: () => void; onClose: () => void }) {
  const t = useT();
  const { online } = useApp();
  const admin = group.role === "owner" || group.role === "admin";
  const { busy, error, run, react, takeBack } = useReact(group, meal, onChange);
  const [pick, setPick] = useState<MealReactionKind | null>(meal.myReaction?.reaction ?? null);
  const [comment, setComment] = useState(meal.myReaction?.comment ?? "");
  const changed = pick !== (meal.myReaction?.reaction ?? null) || comment.trim() !== (meal.myReaction?.comment ?? "");

  return (
    <Sheet title={meal.title} onClose={onClose}>
      <div className="meal-detail" data-testid="shared-meal-detail">
        {meal.image ? <RecipePhoto image={meal.image as Omit<RecipeImage, "id"> & { url: string }} signedIn /> : <MealThumb meal={meal} large />}
        {meal.summary && <p className="meal-description">{meal.summary}</p>}
        <p className="meal-meta">{t("shared.by", { name: meal.sharedBy })}</p>

        <h3>{t("shared.nutrients")}</h3>
        <dl className="shared-nutrients" aria-label={t("shared.perServing")}>
          {meal.nutrients.map((n) => (
            <div key={n.key}>
              <dt>{nutrientName(n.key, n.name)}</dt>
              <dd>{formatNutrient(n.key, n.amount, n.unit)}</dd>
            </div>
          ))}
        </dl>
        <p className="fine">{t("shared.perServing")}</p>

        <h3>{t("shared.yourAnswer")}</h3>
        {meal.myReaction && (
          <p className="shared-answer" data-testid="my-reaction">
            <span className={`tag ${meal.myReaction.reaction === "like" ? "tag-sage" : "tag-amber"}`}>{t(meal.myReaction.reaction === "like" ? "shared.youLike" : "shared.youPass")}</span>
            {meal.myReaction.comment && <span className="meal-meta">“{meal.myReaction.comment}”</span>}
          </p>
        )}
        <div className="choice-row" role="group" aria-label={t("shared.yourAnswer")}>
          {(["like", "dislike"] as const).map((r) => (
            <button key={r} type="button" className="choice" aria-pressed={pick === r} disabled={!online || busy} onClick={() => setPick(r)}>
              <Icon name={r === "like" ? "thumbUp" : "thumbDown"} size={18} /> {t(r === "like" ? "shared.like" : "shared.dislike")}
            </button>
          ))}
        </div>
        <label htmlFor={`comment-${meal.id}`}>{t("shared.comment")}</label>
        <textarea id={`comment-${meal.id}`} rows={2} maxLength={MEAL_COMMENT_MAX} value={comment} onChange={(e) => setComment(e.target.value)} />
        <p className="fine">{t("shared.commentHint")}</p>
        <div className="milestone-actions">
          <button type="button" className="btn-primary" disabled={!online || busy || !pick || !changed} onClick={() => pick && void react(pick, comment)} data-testid="save-reaction">
            {t("shared.save")}
          </button>
          {meal.myReaction && (
            <button type="button" className="btn-link danger" disabled={!online || busy} onClick={() => void takeBack().then(() => (setPick(null), setComment("")))}>
              {t("shared.takeBack")}
            </button>
          )}
        </div>

        {admin && meal.reactions && (
          <div className="shared-answers" data-testid="meal-answers">
            <h3>{t("shared.answers")}</h3>
            <p className="meal-meta">
              <Tally meal={meal} />
            </p>
            {meal.reactions.map((r) => (
              <div key={r.memberId} className="meal-row" data-testid="meal-answer">
                <div>
                  <div className="meal-name">
                    {r.name} · {t(r.reaction === "like" ? "shared.like" : "shared.dislike")}
                  </div>
                  {r.comment && <div className="meal-meta">“{r.comment}”</div>}
                </div>
                {r.comment && (
                  <button
                    type="button"
                    className="btn-link"
                    disabled={!online}
                    onClick={() =>
                      void run(async () => {
                        await api.removeMealComment(group.id, meal.id, r.memberId);
                        onChange({ ...meal, reactions: meal.reactions!.map((x) => (x.memberId === r.memberId ? { ...x, comment: "" } : x)) });
                      })
                    }
                  >
                    {t("shared.removeComment")}
                  </button>
                )}
              </div>
            ))}
            <button
              type="button"
              className="btn-link danger"
              disabled={!online || busy}
              onClick={() =>
                confirm(t("shared.withdrawConfirm", { meal: meal.title })) &&
                void run(async () => {
                  await api.withdrawSharedMeal(group.id, meal.id);
                  onClose();
                  onWithdrawn();
                })
              }
            >
              {t("shared.withdraw")}
            </button>
          </div>
        )}
        {error && <p className="error" role="alert">{error}</p>}
      </div>
    </Sheet>
  );
}

const isMine = (group: GroupDetail, memberId: string) => group.members.some((m) => m.isMe && m.id === memberId);

type PhotoChoice = { kind: "recipe" } | { kind: "none" } | { kind: "other"; image: RecipeImage };

function ShareMealSheet({ group, groupRecipes, onClose, onShared }: { group: GroupDetail; groupRecipes: Recipe[]; onClose: () => void; onShared: (m: SharedMeal) => void }) {
  const t = useT();
  const { online, recipes } = useApp();
  // My own synced recipes, then the group's; the server checks each has a nutrition estimate.
  const options = [
    ...recipes.filter((r) => !r.groupId && r.serverVersion !== null && !r.deleted).map((r) => ({ id: r.id, title: r.body.title, description: r.body.description ?? "", image: r.body.image ?? null, group: false })),
    ...groupRecipes.map((r) => ({ id: r.id, title: r.title, description: r.description, image: r.image, group: true })),
  ];
  const [recipeId, setRecipeId] = useState("");
  const chosen = options.find((o) => o.id === recipeId) ?? null;
  const [summary, setSummary] = useState("");
  const [photo, setPhoto] = useState<PhotoChoice>({ kind: "recipe" });
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function choose(id: string) {
    setRecipeId(id);
    const next = options.find((o) => o.id === id);
    setSummary((next?.description ?? "").slice(0, SHARED_MEAL_SUMMARY_MAX));
    setPhoto(next?.image ? { kind: "recipe" } : { kind: "none" });
  }

  async function share() {
    if (!chosen) return;
    setBusy(true);
    setError(null);
    try {
      const imageId = photo.kind === "none" ? null : photo.kind === "other" ? photo.image.id : (chosen.image?.id ?? null);
      const meal = await api.shareMeal(group.id, { recipeId: chosen.id, summary: summary.trim(), imageId });
      track("Shared a meal with a group");
      onShared(meal);
    } catch (err) {
      setError(message(err, t("groups.offline")));
      setBusy(false);
    }
  }

  if (picking && chosen) {
    return (
      <PhotoSheet
        initial={chosen.title}
        title={chosen.title}
        onPick={(image) => (setPhoto({ kind: "other", image }), setPicking(false))}
        onClose={() => setPicking(false)}
      />
    );
  }

  return (
    <Sheet title={t("shared.share")} onClose={onClose}>
      {options.length === 0 ? (
        <p className="hint">{t("shared.noRecipes")}</p>
      ) : (
        <>
          <label htmlFor="share-recipe">{t("shared.recipe")}</label>
          <select id="share-recipe" value={recipeId} onChange={(e) => choose(e.target.value)}>
            <option value="">{t("shared.chooseRecipe")}</option>
            {options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.title}
                {o.group ? ` (${group.name})` : ""}
              </option>
            ))}
          </select>
          {chosen?.group && <p className="fine">{t("shared.groupRecipeNote")}</p>}
          {chosen && (
            <>
              <label htmlFor="share-summary">{t("shared.summary")}</label>
              <textarea id="share-summary" rows={3} maxLength={SHARED_MEAL_SUMMARY_MAX} value={summary} onChange={(e) => setSummary(e.target.value)} />
              <p className="fine">{t("shared.summaryHint")}</p>
              <p className="label">{t("shared.photo")}</p>
              <div className="choice-row" role="group" aria-label={t("shared.photo")}>
                {chosen.image && (
                  <button type="button" aria-pressed={photo.kind === "recipe"} onClick={() => setPhoto({ kind: "recipe" })}>
                    {t("shared.photoRecipe")}
                  </button>
                )}
                {photo.kind === "other" && (
                  <button type="button" aria-pressed>
                    {t("shared.photoChosen")}
                  </button>
                )}
                <button type="button" aria-pressed={photo.kind === "none"} onClick={() => setPhoto({ kind: "none" })}>
                  {t("shared.photoNone")}
                </button>
              </div>
              <button type="button" className="btn-link" disabled={!online} onClick={() => setPicking(true)}>
                <Icon name="image" size={18} /> {t("shared.photoOther")}
              </button>
            </>
          )}
          {error && <p className="error" role="alert">{error}</p>}
          <div className="sheet-actions">
            <button type="button" className="btn-primary" disabled={!online || busy || !chosen} onClick={() => void share()} data-testid="share-meal-submit">
              <Icon name="share" size={18} /> {t("shared.shareWith", { group: group.name })}
            </button>
          </div>
        </>
      )}
    </Sheet>
  );
}
