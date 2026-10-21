import { useCallback, useEffect, useState } from "react";
import type { FoodPreferencesBody, GroupDetail, GroupMember, InvitePreview, MealSlot, PlannedMeal, Recipe } from "@betterplate/contracts";
import { api, ApiRequestError, type GroupMemberMeals } from "../api.ts";
import { useT, type MessageKey } from "../i18n.ts";
import { addDays, formatDay, localDate, slotLabel } from "../meals.ts";
import { useApp } from "../store.tsx";
import { EmptyState, navigate, Sheet } from "./common.tsx";
import { Icon } from "./icons.tsx";
import { ServingsStepper, SlotPicker } from "./MealSheets.tsx";
import { ALLERGEN_LABEL, AllergenAlert, listedAllergens, PreferencesForm } from "./People.tsx";
import { weekStart } from "./Shopping.tsx";

const ROLE_LABEL: Record<GroupMember["role"], MessageKey> = { owner: "groups.roleOwner", admin: "groups.roleAdmin", member: "groups.roleMember" };

const message = (err: unknown, offline: string) => (err instanceof ApiRequestError ? err.message : offline);

/** Groups need a connection; plans they make reach each kitchen through sync and work offline there. */
function useOnlineNote() {
  const { online } = useApp();
  const t = useT();
  return online ? null : <p className="banner banner-info" data-testid="groups-offline">{t("groups.offline")}</p>;
}

export function Groups() {
  const { groups, refreshGroups, online } = useApp();
  const t = useT();
  const offline = useOnlineNote();
  const [name, setName] = useState("");
  const [myName, setMyName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => void refreshGroups(), [refreshGroups]);

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const g = await api.createGroup(name.trim(), myName.trim());
      await refreshGroups();
      navigate(`/groups/${g.id}`);
    } catch (err) {
      setError(message(err, t("groups.offline")));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="screen">
      <header className="screen-head">
        <div>
          <h1>{t("groups.title")}</h1>
        </div>
      </header>
      <p className="hint">{t("groups.intro")}</p>
      {offline}
      {groups && groups.length > 0 ? (
        <ul className="recipe-list group-list">
          {groups.map((g) => (
            <li key={g.id}>
              <a className="recipe-card" href={`#/groups/${g.id}`} data-testid="group-card">
                <span className="monogram" aria-hidden="true">
                  <Icon name="people" />
                </span>
                <span className="recipe-title">{g.name}</span>
                <span className="recipe-meta">
                  {t(ROLE_LABEL[g.role])} · {t("groups.memberCount", { n: g.memberCount })}
                </span>
              </a>
            </li>
          ))}
        </ul>
      ) : (
        groups && <EmptyState title={t("groups.noneTitle")}><p>{t("groups.noneBody")}</p></EmptyState>
      )}
      <section className="card" aria-labelledby="new-group">
        <h2 id="new-group">{t("groups.start")}</h2>
        <label htmlFor="group-name">{t("groups.name")}</label>
        <input id="group-name" maxLength={80} value={name} placeholder={t("groups.namePlaceholder")} onChange={(e) => setName(e.target.value)} />
        <label htmlFor="group-my-name">{t("groups.myName")}</label>
        <input id="group-my-name" maxLength={60} value={myName} placeholder={t("groups.myNamePlaceholder")} onChange={(e) => setMyName(e.target.value)} />
        <p className="fine">{t("groups.myNameFine")}</p>
        <div className="sheet-actions">
          <button type="button" className="btn-primary" disabled={!online || busy || !name.trim() || !myName.trim()} onClick={() => void create()}>
            {t("groups.create")}
          </button>
        </div>
        {error && <p className="error" role="alert">{error}</p>}
      </section>
    </div>
  );
}

export function JoinGroup({ token }: { token: string }) {
  const { refreshGroups, engine, online } = useApp();
  const t = useT();
  const offline = useOnlineNote();
  const [invite, setInvite] = useState<InvitePreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [myName, setMyName] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!online) return;
    api.invite(token).then(setInvite, (err) => setError(err instanceof ApiRequestError && err.status === 404 ? t("groups.inviteGone") : message(err, t("groups.offline"))));
  }, [token, online]);

  async function join() {
    setBusy(true);
    setError(null);
    try {
      const g = await api.acceptInvite(token, myName.trim());
      await refreshGroups();
      void engine?.syncNow();
      navigate(`/groups/${g.id}`);
    } catch (err) {
      setError(message(err, t("groups.offline")));
      setBusy(false);
    }
  }

  return (
    <div className="screen">
      <header className="screen-head">
        <div>
          <p className="eyebrow">{t("groups.title")}</p>
          <h1>{invite ? t("groups.joinTitle", { group: invite.groupName }) : t("groups.joinGeneric")}</h1>
        </div>
      </header>
      {offline}
      {invite && (
        <section className="card" data-testid="invite-preview">
          <p>{t(invite.role === "admin" ? "groups.inviteAdmin" : "groups.inviteMember", { name: invite.invitedBy, group: invite.groupName })}</p>
          <p className="hint">{t(invite.role === "admin" ? "groups.adminMeans" : "groups.memberMeans")}</p>
          <label htmlFor="join-name">{t("groups.myName")}</label>
          <input id="join-name" maxLength={60} value={myName} placeholder={t("groups.myNamePlaceholder")} onChange={(e) => setMyName(e.target.value)} />
          <p className="fine">{t("groups.myNameFine")}</p>
          <div className="sheet-actions">
            <button type="button" className="btn-primary" disabled={!online || busy || !myName.trim()} onClick={() => void join()}>
              {t("groups.join")}
            </button>
          </div>
        </section>
      )}
      {error && <p className="error" role="alert">{error}</p>}
    </div>
  );
}

export function GroupScreen({ id }: { id: string }) {
  const { refreshGroups, engine, online, recipes, catalog } = useApp();
  const t = useT();
  const offline = useOnlineNote();
  const [group, setGroup] = useState<GroupDetail | null>(null);
  const [groupRecipes, setGroupRecipes] = useState<Recipe[]>([]);
  const [week, setWeek] = useState(() => weekStart(localDate()));
  const [meals, setMeals] = useState<GroupMemberMeals[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sheet, setSheet] = useState<
    | { kind: "plan"; member: GroupMember }
    | { kind: "prefs"; member: GroupMember }
    | { kind: "addRecipe" }
    | { kind: "addProfile" }
    | { kind: "invite"; link: string }
    | null
  >(null);
  const admin = group?.role === "owner" || group?.role === "admin";
  const to = addDays(week, 6);

  const load = useCallback(async () => {
    if (!online) return;
    try {
      const g = await api.group(id);
      setGroup(g);
      setGroupRecipes((await api.groupRecipes(id)).recipes);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiRequestError && err.status === 404 ? t("groups.notFound") : message(err, t("groups.offline")));
    }
  }, [id, online]);

  const loadMeals = useCallback(async () => {
    if (!online || !admin) return;
    try {
      setMeals((await api.groupMeals(id, week, to)).members);
    } catch (err) {
      setError(message(err, t("groups.offline")));
    }
  }, [id, online, admin, week, to]);

  useEffect(() => void load(), [load]);
  useEffect(() => void loadMeals(), [loadMeals]);

  async function act(fn: () => Promise<unknown>, after: () => Promise<void> | void = load) {
    setError(null);
    try {
      await fn();
      await after();
      void engine?.syncNow();
    } catch (err) {
      setError(message(err, t("groups.offline")));
    }
  }

  if (!group) {
    return (
      <div className="screen">
        {offline}
        {error ? <p className="error" role="alert">{error}</p> : online && <p className="hint">{t("common.loading")}</p>}
      </div>
    );
  }

  const me = group.members.find((m) => m.isMe);
  const mealsOf = (m: GroupMember) => meals?.find((x) => x.memberId === m.id);

  async function leave() {
    if (!me || !confirm(t("groups.leaveConfirm", { group: group!.name }))) return;
    await act(
      () => api.removeMember(id, me.id),
      async () => {
        await refreshGroups();
        navigate("/groups");
      },
    );
  }

  async function end() {
    if (!confirm(t("groups.endConfirm", { group: group!.name }))) return;
    await act(
      () => api.endGroup(id),
      async () => {
        await refreshGroups();
        navigate("/groups");
      },
    );
  }

  async function invite(role: "admin" | "member") {
    await act(async () => {
      const inv = await api.createInvite(id, role);
      setSheet({ kind: "invite", link: inv.url });
    });
  }

  return (
    <div className="screen">
      <header className="screen-head">
        <div>
          <p className="eyebrow">{t(ROLE_LABEL[group.role])}</p>
          <h1>{group.name}</h1>
        </div>
      </header>
      {offline}
      {error && <p className="error" role="alert">{error}</p>}
      {!admin && <p className="hint">{t("groups.memberIntro")}</p>}

      <section className="card" aria-labelledby="members-title" data-testid="group-members">
        <div className="card-head">
          <h2 id="members-title">{t("groups.members")}</h2>
          {admin && (
            <button type="button" className="btn-soft" onClick={() => setSheet({ kind: "addProfile" })}>
              <Icon name="plus" size={18} /> {t("groups.addChild")}
            </button>
          )}
        </div>
        {group.members.map((m) => (
          <div key={m.id} className="meal-row" data-testid="group-member">
            <div>
              <div className="meal-name">
                {m.name}
                {m.isMe && ` ${t("groups.you")}`}
              </div>
              <div className="meal-meta">
                {t(ROLE_LABEL[m.role])}
                {m.kind === "profile" && ` · ${t("groups.profile")}`}
                {m.ownedByMe && ` · ${t("groups.yourProfile")}`}
              </div>
            </div>
            <div className="meal-actions">
              {admin && m.kind === "profile" && (
                <button type="button" className="btn-link" onClick={() => setSheet({ kind: "prefs", member: m })}>
                  {t("groups.preferences")}
                </button>
              )}
              {group.role === "owner" && m.kind === "person" && m.role !== "owner" && (
                <button type="button" className="btn-link" onClick={() => void act(() => api.setMemberRole(id, m.id, m.role === "admin" ? "member" : "admin"))}>
                  {m.role === "admin" ? t("groups.makeMember") : t("groups.makeAdmin")}
                </button>
              )}
              {m.role !== "owner" && !m.isMe && (group.role === "owner" || m.ownedByMe) && (
                <button
                  type="button"
                  className="icon-btn"
                  aria-label={t("groups.remove", { name: m.name })}
                  onClick={() => confirm(t("groups.removeConfirm", { name: m.name })) && void act(() => api.removeMember(id, m.id))}
                >
                  <Icon name="close" />
                </button>
              )}
            </div>
          </div>
        ))}
        {admin && (
          <div className="sheet-actions">
            <button type="button" className="btn-secondary" disabled={!online} onClick={() => void invite("member")}>
              <Icon name="link" size={18} /> {t("groups.inviteMemberBtn")}
            </button>
            {group.role === "owner" && (
              <button type="button" className="btn-secondary" disabled={!online} onClick={() => void invite("admin")}>
                <Icon name="link" size={18} /> {t("groups.inviteAdminBtn")}
              </button>
            )}
          </div>
        )}
        {admin && group.invites.length > 0 && (
          <details className="invites">
            <summary>{t("groups.openInvites", { n: group.invites.length })}</summary>
            <ul>
              {group.invites.map((inv) => (
                <li key={inv.id} className="meal-row">
                  <span className="meal-meta">
                    {t(inv.role === "admin" ? "groups.roleAdmin" : "groups.roleMember")} · {t("groups.expires", { date: formatDay(inv.expiresAt.slice(0, 10), { day: "numeric", month: "short" }) })}
                  </span>
                  <button type="button" className="btn-link danger" onClick={() => void act(() => api.revokeInvite(id, inv.id))}>
                    {t("groups.revoke")}
                  </button>
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>

      {admin && (
        <section className="card" aria-labelledby="week-title" data-testid="group-week">
          <div className="day-nav">
            <button type="button" className="icon-btn round" aria-label={t("meals.prevWeek")} onClick={() => setWeek(addDays(week, -7))}>
              <Icon name="back" />
            </button>
            <div className="day-title">
              <h2 id="week-title">{t("groups.week")}</h2>
              <p>{`${formatDay(week, { day: "numeric", month: "short" })} – ${formatDay(to, { day: "numeric", month: "short" })}`}</p>
            </div>
            <button type="button" className="icon-btn round" aria-label={t("meals.nextWeek")} onClick={() => setWeek(addDays(week, 7))}>
              <Icon name="forward" />
            </button>
          </div>
          {group.members.map((m) => {
            const data = mealsOf(m);
            const listed = listedAllergens(data?.preferences);
            return (
              <div key={m.id} className="member-week" data-testid="member-week">
                <div className="card-head">
                  <h3>{m.name}</h3>
                  <button type="button" className="btn-soft" disabled={!online || groupRecipes.length === 0} onClick={() => setSheet({ kind: "plan", member: m })}>
                    <Icon name="calendar" size={18} /> {t("groups.planFor")}
                  </button>
                </div>
                <p className="meal-meta">
                  {data?.preferences
                    ? data.preferences.allergyAnswer === "listed"
                      ? t("groups.allergies", { list: listed.map((a) => t(ALLERGEN_LABEL[a as keyof typeof ALLERGEN_LABEL])).join(", ") })
                      : data.preferences.allergyAnswer === "none"
                        ? t("groups.noAllergies")
                        : t("groups.allergiesNotSaid")
                    : t("groups.allergiesNotAsked")}
                </p>
                {data && data.planned.length === 0 && data.eaten.length === 0 && <p className="hint">{t("groups.nothingThisWeek")}</p>}
                {data?.planned.map((p) => (
                  <GroupPlanRow key={p.id} plan={p} eaten={data.eaten.some((l) => l.plannedMealId === p.id)} onAct={(fn) => void act(fn, loadMeals)} groupId={id} />
                ))}
                {data?.eaten.map((l) => {
                  const fb = data.feedback.find((f) => f.id === l.id);
                  return (
                    <div key={l.id} className="meal-row" data-testid="member-eaten">
                      <div>
                        <div className="meal-name">{l.recipe.title}</div>
                        <div className="meal-meta">
                          {t("meals.eaten")} · {formatDay(l.localDate, { weekday: "short" })} · {slotLabel(l.slot)}
                          {fb && ` · ${fb.rating === "liked" ? t("feedback.liked") : fb.rating === "disliked" ? t("feedback.disliked") : t("feedback.noted")}`}
                          {fb?.comment && `: “${fb.comment}”`}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })}
          <p className="fine">{t("groups.weekFine")}</p>
          <a className="btn-secondary" href={`#/shopping/group/${id}`}>
            <Icon name="basket" size={18} /> {t("groups.shopping")}
          </a>
        </section>
      )}

      <section className="card" aria-labelledby="group-recipes-title" data-testid="group-recipes">
        <div className="card-head">
          <h2 id="group-recipes-title">{t("groups.recipes")}</h2>
          {admin && (
            <button type="button" className="btn-soft" disabled={!online} onClick={() => setSheet({ kind: "addRecipe" })}>
              <Icon name="plus" size={18} /> {t("groups.addRecipe")}
            </button>
          )}
        </div>
        {groupRecipes.length === 0 ? (
          <p className="hint">{admin ? t("groups.noRecipesAdmin") : t("groups.noRecipes")}</p>
        ) : (
          <ul className="food-results">
            {groupRecipes.map((r) => (
              <li key={r.id}>
                <button type="button" onClick={() => navigate(`/recipe/${r.id}`)}>
                  <span>{r.title}</span>
                  <small>{t("common.servings", { n: r.servings })}</small>
                </button>
              </li>
            ))}
          </ul>
        )}
        {admin && <p className="fine">{t("groups.recipesFine")}</p>}
      </section>

      <div className="stack">
        {group.role === "owner" ? (
          <button type="button" className="btn-link danger" disabled={!online} onClick={() => void end()}>
            {t("groups.end")}
          </button>
        ) : (
          <button type="button" className="btn-link danger" disabled={!online} onClick={() => void leave()}>
            {t("groups.leave")}
          </button>
        )}
      </div>

      {sheet?.kind === "invite" && (
        <Sheet title={t("groups.inviteReady")} onClose={() => setSheet(null)}>
          <p className="hint">{t("groups.inviteHint")}</p>
          <input readOnly value={sheet.link} aria-label={t("groups.inviteLink")} data-testid="invite-link" onFocus={(e) => e.target.select()} />
          <div className="sheet-actions">
            <button
              type="button"
              className="btn-primary"
              onClick={() => void (navigator.share ? navigator.share({ url: sheet.link }).catch(() => {}) : navigator.clipboard?.writeText(sheet.link).catch(() => {}))}
            >
              <Icon name="share" size={18} /> {t("groups.shareLink")}
            </button>
          </div>
          <p className="fine">{t("groups.inviteFine")}</p>
        </Sheet>
      )}
      {sheet?.kind === "addProfile" && <AddProfileSheet groupId={id} onClose={() => setSheet(null)} onDone={(g) => (setGroup(g), void loadMeals(), void engine?.syncNow())} />}
      {sheet?.kind === "addRecipe" && (
        <Sheet title={t("groups.addRecipe")} onClose={() => setSheet(null)}>
          <p className="hint">{t("groups.addRecipeHint")}</p>
          <ul className="food-results">
            {recipes
              .filter((r) => !r.groupId && r.serverVersion !== null)
              .map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setSheet(null);
                      void act(() => api.shareRecipeWithGroup(id, r.id));
                    }}
                  >
                    <span>{r.body.title}</span>
                    <small>{t("common.servings", { n: r.body.servings })}</small>
                  </button>
                </li>
              ))}
          </ul>
          {recipes.every((r) => r.groupId || r.serverVersion === null) && <p className="hint">{t("groups.noOwnRecipes")}</p>}
        </Sheet>
      )}
      {sheet?.kind === "plan" && catalog.status === "ready" && (
        <GroupPlanSheet
          groupId={id}
          member={sheet.member}
          recipes={groupRecipes}
          listed={listedAllergens(mealsOf(sheet.member)?.preferences)}
          initialDate={week > localDate() ? week : localDate()}
          onClose={() => setSheet(null)}
          onDone={() => void loadMeals()}
        />
      )}
      {sheet?.kind === "prefs" && (
        <Sheet title={t("groups.preferencesFor", { name: sheet.member.name })} onClose={() => setSheet(null)}>
          <PreferencesForm
            initial={mealsOf(sheet.member)?.preferences ?? undefined}
            name={sheet.member.name}
            onSave={async (body: FoodPreferencesBody) => {
              await act(() => api.setMemberPreferences(id, sheet.member.id, body), loadMeals);
              setSheet(null);
            }}
          />
        </Sheet>
      )}
    </div>
  );
}

function GroupPlanRow({ plan, eaten, groupId, onAct }: { plan: PlannedMeal; eaten: boolean; groupId: string; onAct: (fn: () => Promise<unknown>) => void }) {
  const t = useT();
  return (
    <div className="meal-row" data-testid="member-planned">
      <div>
        <div className="meal-name">{plan.title}</div>
        <div className="meal-meta">
          {formatDay(plan.date, { weekday: "short", day: "numeric", month: "short" })} · {slotLabel(plan.slot)} · {t("common.servings", { n: plan.servings })}
          {plan.plannedBy && plan.groupId && ` · ${t("plan.plannedBy", { name: plan.plannedBy })}`}
        </div>
        {plan.status === "proposed" && <span className="badge">{t("plan.awaiting")}</span>}
        {plan.status === "declined" && <span className="badge">{t("plan.declined")}</span>}
        {eaten && (
          <span className="badge badge-sage">
            <Icon name="check" size={14} /> {t("meals.eaten")}
          </span>
        )}
      </div>
      <div className="meal-actions">
        {plan.status === "proposed" && (
          <>
            <button type="button" className="btn-secondary" onClick={() => onAct(() => api.approvePlan(groupId, plan.id))}>
              {t("plan.approve")}
            </button>
            <button type="button" className="btn-link" onClick={() => onAct(() => api.declinePlan(groupId, plan.id))}>
              {t("plan.decline")}
            </button>
          </>
        )}
        {plan.groupId === groupId && (
          <button type="button" className="icon-btn" aria-label={t("meals.removePlan", { title: plan.title })} onClick={() => onAct(() => api.removeGroupPlan(groupId, plan.id, plan.version))}>
            <Icon name="close" />
          </button>
        )}
      </div>
    </div>
  );
}

function AddProfileSheet({ groupId, onClose, onDone }: { groupId: string; onClose: () => void; onDone: (g: GroupDetail) => void }) {
  const { engine } = useApp();
  const t = useT();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  async function add() {
    try {
      const id = crypto.randomUUID();
      const g = await api.addProfile(groupId, name.trim(), id);
      // Shows in Meals right away; the next sync brings the same record.
      await engine?.rememberProfile({ id, name: name.trim(), version: 1, createdAt: new Date().toISOString() });
      onDone(g);
      onClose();
    } catch (err) {
      setError(message(err, t("groups.offline")));
    }
  }
  return (
    <Sheet title={t("groups.addChild")} onClose={onClose}>
      <p className="hint">{t("groups.childHint")}</p>
      <label htmlFor="profile-name">{t("groups.childName")}</label>
      <input id="profile-name" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />
      <div className="sheet-actions">
        <button type="button" className="btn-primary" disabled={!name.trim()} onClick={() => void add()}>
          {t("groups.addChildSave")}
        </button>
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      <p className="fine">{t("groups.childFine")}</p>
    </Sheet>
  );
}

/** An admin plans a group recipe for one member; a listed allergy shows an alert but never blocks. */
function GroupPlanSheet({
  groupId,
  member,
  recipes,
  listed,
  initialDate,
  onClose,
  onDone,
}: {
  groupId: string;
  member: GroupMember;
  recipes: Recipe[];
  listed: string[];
  initialDate: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const { catalog } = useApp();
  const t = useT();
  const [recipeId, setRecipeId] = useState(recipes[0]?.id ?? "");
  const [date, setDate] = useState(initialDate);
  const [slot, setSlot] = useState<MealSlot>("dinner");
  const [servings, setServings] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const recipe = recipes.find((r) => r.id === recipeId);
  const valid = !!recipe && /^\d{4}-\d{2}-\d{2}$/.test(date) && servings > 0 && servings <= 100;

  async function save() {
    try {
      await api.planForMember(groupId, member.id, { date, slot, recipeId, servings });
      onDone();
      onClose();
    } catch (err) {
      setError(message(err, t("groups.offline")));
    }
  }

  return (
    <Sheet title={t("groups.planForName", { name: member.name })} onClose={onClose}>
      <label htmlFor="gp-recipe">{t("groups.recipe")}</label>
      <select id="gp-recipe" value={recipeId} onChange={(e) => setRecipeId(e.target.value)}>
        {recipes.map((r) => (
          <option key={r.id} value={r.id}>
            {r.title}
          </option>
        ))}
      </select>
      {recipe && catalog.status === "ready" && <AllergenAlert recipe={recipe} listed={listed} name={member.isMe ? null : member.name} foods={catalog.foods} />}
      <label htmlFor="gp-date">{t("meals.day")}</label>
      <input id="gp-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      <label>{t("mealSheet.meal")}</label>
      <SlotPicker value={slot} onChange={setSlot} />
      <ServingsStepper id="gp-servings" value={servings} onChange={setServings} />
      <div className="sheet-actions">
        <button type="button" className="btn-primary" disabled={!valid} onClick={() => void save()}>
          {t("mealSheet.addToPlan")}
        </button>
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      <p className="fine">{t("groups.planFine")}</p>
    </Sheet>
  );
}
