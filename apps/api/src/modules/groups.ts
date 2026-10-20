import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import type pg from "pg";
import {
  AllergenAlertSchema,
  FoodPreferencesBodySchema,
  FoodPreferencesSchema,
  GroupCreateSchema,
  GroupDetailSchema,
  GroupInviteSchema,
  GroupPlanCreateSchema,
  GroupPlanUpdateSchema,
  GroupRecipeCopySchema,
  GroupSummarySchema,
  GroupUpdateSchema,
  InviteAcceptSchema,
  InviteCreateSchema,
  InvitePreviewSchema,
  LocalDateSchema,
  MealFeedbackSchema,
  MealLogSchema,
  MemberAddSchema,
  MemberUpdateSchema,
  PlannedMealSchema,
  ProfileCreateSchema,
  ProfileSchema,
  RecipeSchema,
  type AllergenAlert,
  type FoodPreferences,
  type GroupDetail,
  type GroupRole,
  type Profile,
  type RecipeBody,
} from "@betterplate/contracts";
import { ALLERGEN_RULES_VERSION, allergenAlert, recipeAllergens } from "@betterplate/nutrition";
import { config } from "../config.ts";
import { pool, withTransaction } from "../db/pool.ts";
import { ApiError, type AppEnv, rateLimit, requireUser } from "../lib/http.ts";
import { groupUserIds, isAdminRole, lockUsers, roleIn } from "./access.ts";
import { foodsByIds } from "./catalog.ts";
import { ErrorResponses } from "./common.ts";
import { LOG_COLUMNS, loadPlanForWrite, PLAN_COLUMNS, toLog, toPlan, tombstonePlan, writePlan, type LogRow, type PlanRow } from "./meals.ts";
import { toFeedback, toPreferences, writePreferences, type FeedbackRow, type PreferencesRow } from "./preferences.ts";
import { getRecipe, putRecipe, toRecipe } from "./recipes.ts";

// ---------- service ----------

export const MAX_GROUPS_PER_PERSON = 20;
export const MAX_GROUP_MEMBERS = 50;
export const MAX_OPEN_INVITES = 20;
export const INVITE_DAYS = 7;

export const PROFILE_COLUMNS = "id, owner_user_id, name, version, server_seq, created_at, deleted_at";
type ProfileRow = { id: string; owner_user_id: string; name: string; version: number; server_seq: string; created_at: Date; deleted_at: Date | null };
export const toProfile = (r: ProfileRow): Profile => ({ id: r.id, name: r.name, version: r.version, createdAt: r.created_at.toISOString() });

type MemberRow = { id: string; group_id: string; user_id: string | null; profile_id: string | null; role: GroupRole; display_name: string; owner_user_id: string | null };
type InviteRow = { id: string; group_id: string; role: "admin" | "member"; created_by: string; created_at: Date; expires_at: Date; used_at: Date | null; revoked_at: Date | null };

const inviteUrl = (id: string) => `${config.publicAppUrl.replace(/\/$/, "")}/#/join/${id}`;
const notFound = () => new ApiError(404, "not_found", "Group not found");

/** The caller's role, or 404 for people outside the group (its existence is never revealed). */
async function requireRole(db: Pick<pg.PoolClient, "query">, groupId: string, userId: string, allowed: GroupRole[]): Promise<GroupRole> {
  const role = await roleIn(db, groupId, userId);
  if (!role) throw notFound();
  if (!allowed.includes(role)) {
    throw new ApiError(403, "forbidden", allowed.includes("admin") ? "Only the group's owner and admins can do this" : "Only the group's owner can do this");
  }
  return role;
}

async function members(db: Pick<pg.PoolClient, "query">, groupId: string): Promise<MemberRow[]> {
  const { rows } = await db.query<MemberRow>(
    `select m.id, m.group_id, m.user_id, m.profile_id, m.role, m.display_name, p.owner_user_id
       from group_members m left join profiles p on p.id = m.profile_id
      where m.group_id = $1 order by case m.role when 'owner' then 0 when 'admin' then 1 else 2 end, m.created_at`,
    [groupId],
  );
  return rows;
}

export async function groupDetail(groupId: string, userId: string): Promise<GroupDetail> {
  const role = await requireRole(pool, groupId, userId, ["owner", "admin", "member"]);
  const [group, list, invites] = await Promise.all([
    pool.query<{ name: string }>("select name from groups where id = $1", [groupId]),
    members(pool, groupId),
    isAdminRole(role)
      ? pool
          .query<InviteRow>("select * from group_invites where group_id = $1 and used_at is null and revoked_at is null and expires_at > now() order by created_at desc", [groupId])
          .then((r) => r.rows)
      : Promise.resolve([] as InviteRow[]),
  ]);
  return {
    id: groupId,
    name: group.rows[0]!.name,
    role,
    members: list.map((m) => ({
      id: m.id,
      kind: m.profile_id ? ("profile" as const) : ("person" as const),
      userId: m.user_id,
      profileId: m.profile_id,
      name: m.display_name,
      role: m.role,
      isMe: m.user_id === userId,
      ownedByMe: m.owner_user_id === userId,
    })),
    invites: invites.map((i) => ({ id: i.id, role: i.role, url: inviteUrl(i.id), createdAt: i.created_at.toISOString(), expiresAt: i.expires_at.toISOString() })),
  };
}

/** Sends the group's recipes again to every member's kitchen (after someone joins). */
async function resendGroupRecipes(client: pg.PoolClient, groupId: string) {
  await lockUsers(client, await groupUserIds(client, groupId));
  await client.query("update recipes set server_seq = nextval('change_seq') where group_id = $1 and deleted_at is null", [groupId]);
}

/**
 * Ends a group: its recipes return to the people who created them, and plans its admins made stay
 * in each person's kitchen as their own. Everything that changes is sent again through sync.
 */
async function endGroup(client: pg.PoolClient, groupId: string) {
  const affected = await client.query<{ id: string }>(
    `select user_id as id from group_members where group_id = $1 and user_id is not null
     union select owner_user_id from profiles p join group_members m on m.profile_id = p.id where m.group_id = $1
     union select user_id from recipes where group_id = $1`,
    [groupId],
  );
  await lockUsers(client, affected.rows.map((r) => r.id));
  await client.query("update recipes set group_id = null, server_seq = nextval('change_seq') where group_id = $1", [groupId]);
  await client.query("update planned_meals set group_id = null, server_seq = nextval('change_seq') where group_id = $1", [groupId]);
  await client.query("delete from groups where id = $1", [groupId]);
}

/** Ends every group an account owns, before the account is deleted. */
export async function endOwnedGroups(userId: string) {
  const { rows } = await pool.query<{ id: string }>("select id from groups where owner_user_id = $1", [userId]);
  for (const g of rows) await withTransaction((client) => endGroup(client, g.id));
}

/** The person or profile a membership stands for, and the kitchen that holds their meals. */
async function subjectOf(db: Pick<pg.PoolClient, "query">, groupId: string, memberId: string) {
  const m = (await db.query<MemberRow>(
    `select m.id, m.group_id, m.user_id, m.profile_id, m.role, m.display_name, p.owner_user_id
       from group_members m left join profiles p on p.id = m.profile_id where m.id = $1 and m.group_id = $2`,
    [memberId, groupId],
  )).rows[0];
  if (!m) throw new ApiError(404, "not_found", "Member not found");
  return { member: m, feedOwner: (m.user_id ?? m.owner_user_id)!, profileId: m.profile_id };
}

/** True when a plan row belongs to the person or profile a membership stands for. */
const planOf = (row: PlanRow, s: Awaited<ReturnType<typeof subjectOf>>) =>
  s.profileId ? row.profile_id === s.profileId : row.user_id === s.feedOwner && row.profile_id === null;

async function subjectPreferences(db: Pick<pg.PoolClient, "query">, s: Awaited<ReturnType<typeof subjectOf>>): Promise<FoodPreferences | null> {
  const id = s.profileId ?? s.feedOwner;
  const { rows } = await db.query<PreferencesRow>("select * from food_preferences where id = $1", [id]);
  return rows[0] ? toPreferences(rows[0]) : null;
}

/** An alert, never a block: the person's listed allergens that the recipe's foods are tagged with. */
export async function alertFor(prefs: FoodPreferences | null, ingredients: RecipeBody["ingredients"]): Promise<AllergenAlert> {
  const listed = prefs?.allergyAnswer === "listed" ? prefs.allergens : [];
  const foods = await foodsByIds([...new Set(ingredients.map((i) => i.foodId))]);
  const result = allergenAlert(recipeAllergens({ ingredients }, foods), listed);
  return { ...result, rulesVersion: ALLERGEN_RULES_VERSION };
}

async function groupRecipe(db: Pick<pg.PoolClient, "query">, groupId: string, recipeId: string) {
  const { rows } = await db.query("select * from recipes where id = $1 and group_id = $2 and deleted_at is null", [recipeId, groupId]);
  if (!rows[0]) throw new ApiError(422, "recipe_not_in_group", "Plan one of the group's recipes; add yours to the group first");
  return toRecipe(rows[0]);
}

function parseIfMatch(header: string | undefined): number | null {
  if (!header) return null;
  const m = /^(?:W\/)?"?v?(\d+)"?$/.exec(header.trim());
  if (!m) throw new ApiError(400, "invalid_if_match", 'If-Match must be the ETag, e.g. "v3"');
  return Number(m[1]);
}

// ---------- routes ----------

const json = <T extends z.ZodType>(schema: T) => ({ content: { "application/json": { schema } } });
const Err = (description: string) => ({ description, ...json(z.object({ error: z.any() })) });
const GroupParam = z.object({ id: z.uuid() });
const GroupMemberParam = z.object({ id: z.uuid(), memberId: z.uuid() });
const GroupPlanParam = z.object({ id: z.uuid(), planId: z.uuid() });
const PlanWithAlertSchema = z.object({ plan: PlannedMealSchema, alert: AllergenAlertSchema });
const GroupMealsSchema = z.object({
  from: LocalDateSchema,
  to: LocalDateSchema,
  members: z.array(
    z.object({
      memberId: z.uuid(),
      name: z.string(),
      kind: z.enum(["person", "profile"]),
      preferences: FoodPreferencesSchema.nullable(),
      planned: z.array(PlannedMealSchema),
      eaten: z.array(MealLogSchema),
      feedback: z.array(MealFeedbackSchema),
    }),
  ),
});

export const groupRoutes = new OpenAPIHono<AppEnv>();
const groupLimit = rateLimit("group", 300, 60);
for (const path of ["/v1/groups", "/v1/groups/*", "/v1/invites/*", "/v1/profiles", "/v1/profiles/*"]) groupRoutes.use(path, groupLimit);

groupRoutes.openapi(
  createRoute({
    method: "get", path: "/v1/groups", tags: ["groups"], summary: "Groups I belong to, with my role",
    responses: { 200: { description: "Groups", ...json(z.object({ groups: z.array(GroupSummarySchema) })) }, ...ErrorResponses },
  }),
  async (c) => {
    const user = requireUser(c);
    const { rows } = await pool.query<{ id: string; name: string; role: GroupRole; member_count: string }>(
      `select g.id, g.name, m.role, (select count(*) from group_members x where x.group_id = g.id) as member_count
         from groups g join group_members m on m.group_id = g.id and m.user_id = $1 order by g.created_at`,
      [user.id],
    );
    return c.json({ groups: rows.map((r) => ({ id: r.id, name: r.name, role: r.role, memberCount: Number(r.member_count) })) }, 200);
  },
);

groupRoutes.openapi(
  createRoute({
    method: "post", path: "/v1/groups", tags: ["groups"], summary: "Start a group; I become its owner",
    request: { body: { required: true, ...json(GroupCreateSchema) } },
    responses: { 201: { description: "Created", ...json(GroupDetailSchema) }, 409: Err("Too many groups"), ...ErrorResponses },
  }),
  async (c) => {
    const user = requireUser(c);
    const { name, myName } = c.req.valid("json");
    const id = crypto.randomUUID();
    await withTransaction(async (client) => {
      await lockUsers(client, [user.id]);
      const { rows } = await client.query<{ n: string }>("select count(*) as n from group_members where user_id = $1", [user.id]);
      if (Number(rows[0]!.n) >= MAX_GROUPS_PER_PERSON) throw new ApiError(409, "group_limit", `You can be in up to ${MAX_GROUPS_PER_PERSON} groups`);
      await client.query("insert into groups (id, name, owner_user_id) values ($1, $2, $3)", [id, name, user.id]);
      await client.query("insert into group_members (group_id, user_id, role, display_name) values ($1, $2, 'owner', $3)", [id, user.id, myName]);
    });
    return c.json(await groupDetail(id, user.id), 201);
  },
);

groupRoutes.openapi(
  createRoute({
    method: "get", path: "/v1/groups/{id}", tags: ["groups"], summary: "A group's members (and open invites, for admins)",
    request: { params: GroupParam },
    responses: { 200: { description: "Group", ...json(GroupDetailSchema) }, ...ErrorResponses },
  }),
  async (c) => c.json(await groupDetail(c.req.valid("param").id, requireUser(c).id), 200),
);

groupRoutes.openapi(
  createRoute({
    method: "put", path: "/v1/groups/{id}", tags: ["groups"], summary: "Rename a group (owner)",
    request: { params: GroupParam, body: { required: true, ...json(GroupUpdateSchema) } },
    responses: { 200: { description: "Group", ...json(GroupDetailSchema) }, 403: Err("Not the owner"), ...ErrorResponses },
  }),
  async (c) => {
    const user = requireUser(c);
    const { id } = c.req.valid("param");
    await requireRole(pool, id, user.id, ["owner"]);
    await pool.query("update groups set name = $2, updated_at = now() where id = $1", [id, c.req.valid("json").name]);
    return c.json(await groupDetail(id, user.id), 200);
  },
);

groupRoutes.openapi(
  createRoute({
    method: "delete", path: "/v1/groups/{id}", tags: ["groups"], summary: "End a group (owner)",
    description: "Group recipes go back to the people who created them; meals the group planned stay in each person's kitchen as their own.",
    request: { params: GroupParam },
    responses: { 204: { description: "Ended" }, 403: Err("Not the owner"), ...ErrorResponses },
  }),
  async (c) => {
    const user = requireUser(c);
    const { id } = c.req.valid("param");
    await requireRole(pool, id, user.id, ["owner"]);
    await withTransaction((client) => endGroup(client, id));
    return c.body(null, 204);
  },
);

// ----- invites -----

groupRoutes.openapi(
  createRoute({
    method: "post", path: "/v1/groups/{id}/invites", tags: ["groups"], summary: "Create a single-use invite link",
    description: `The owner can invite admins or members; admins can invite members. Links work once and expire after ${INVITE_DAYS} days. Anyone holding a link can use it, so share it privately.`,
    request: { params: GroupParam, body: { required: true, ...json(InviteCreateSchema) } },
    responses: { 201: { description: "Invite", ...json(GroupInviteSchema) }, 403: Err("Not allowed"), 409: Err("Too many open invites"), ...ErrorResponses },
  }),
  async (c) => {
    const user = requireUser(c);
    const { id } = c.req.valid("param");
    const { role } = c.req.valid("json");
    await requireRole(pool, id, user.id, role === "admin" ? ["owner"] : ["owner", "admin"]);
    const open = await pool.query<{ n: string }>("select count(*) as n from group_invites where group_id = $1 and used_at is null and revoked_at is null and expires_at > now()", [id]);
    if (Number(open.rows[0]!.n) >= MAX_OPEN_INVITES) throw new ApiError(409, "invite_limit", "Too many open invite links; revoke some first");
    const { rows } = await pool.query<InviteRow>(
      `insert into group_invites (id, group_id, role, created_by, expires_at) values ($1, $2, $3, $4, now() + make_interval(days => $5)) returning *`,
      [crypto.randomUUID(), id, role, user.id, INVITE_DAYS],
    );
    const i = rows[0]!;
    return c.json({ id: i.id, role: i.role, url: inviteUrl(i.id), createdAt: i.created_at.toISOString(), expiresAt: i.expires_at.toISOString() }, 201);
  },
);

groupRoutes.openapi(
  createRoute({
    method: "delete", path: "/v1/groups/{id}/invites/{inviteId}", tags: ["groups"], summary: "Revoke an invite link",
    request: { params: z.object({ id: z.uuid(), inviteId: z.uuid() }) },
    responses: { 204: { description: "Revoked" }, 403: Err("Not allowed"), ...ErrorResponses },
  }),
  async (c) => {
    const user = requireUser(c);
    const { id, inviteId } = c.req.valid("param");
    await requireRole(pool, id, user.id, ["owner", "admin"]);
    await pool.query("update group_invites set revoked_at = now() where id = $1 and group_id = $2 and revoked_at is null", [inviteId, id]);
    return c.body(null, 204);
  },
);

async function liveInvite(db: Pick<pg.PoolClient, "query">, token: string, lock = false) {
  const { rows } = await db.query<InviteRow & { group_name: string; invited_by: string }>(
    `select i.*, g.name as group_name,
            coalesce((select display_name from group_members where group_id = i.group_id and user_id = i.created_by), 'A group admin') as invited_by
       from group_invites i join groups g on g.id = i.group_id
      where i.id = $1 and i.used_at is null and i.revoked_at is null and i.expires_at > now()${lock ? " for update of i" : ""}`,
    [token],
  );
  if (!rows[0]) throw new ApiError(404, "invite_not_found", "This invite link has been used, revoked or has expired; ask for a new one");
  return rows[0];
}

groupRoutes.openapi(
  createRoute({
    method: "get", path: "/v1/invites/{token}", tags: ["groups"], summary: "What an invite link is for (signed in)",
    request: { params: z.object({ token: z.uuid() }) },
    responses: { 200: { description: "Invite", ...json(InvitePreviewSchema) }, ...ErrorResponses },
  }),
  async (c) => {
    requireUser(c);
    const i = await liveInvite(pool, c.req.valid("param").token);
    return c.json({ groupName: i.group_name, role: i.role, invitedBy: i.invited_by, expiresAt: i.expires_at.toISOString() }, 200);
  },
);

groupRoutes.openapi(
  createRoute({
    method: "post", path: "/v1/invites/{token}/accept", tags: ["groups"], summary: "Join a group with an invite link",
    description: "Members' own plans then wait for an admin's approval, and the group's admins can see and plan their meals.",
    request: { params: z.object({ token: z.uuid() }), body: { required: true, ...json(InviteAcceptSchema) } },
    responses: { 200: { description: "Joined", ...json(GroupDetailSchema) }, 409: Err("Already in the group, or a limit reached"), ...ErrorResponses },
  }),
  async (c) => {
    const user = requireUser(c);
    const { token } = c.req.valid("param");
    const { myName } = c.req.valid("json");
    const groupId = await withTransaction(async (client) => {
      const i = await liveInvite(client, token, true);
      if (await roleIn(client, i.group_id, user.id)) throw new ApiError(409, "already_member", "You are already in this group");
      const counts = await client.query<{ mine: string; members: string }>(
        "select (select count(*) from group_members where user_id = $1) as mine, (select count(*) from group_members where group_id = $2) as members",
        [user.id, i.group_id],
      );
      if (Number(counts.rows[0]!.mine) >= MAX_GROUPS_PER_PERSON) throw new ApiError(409, "group_limit", `You can be in up to ${MAX_GROUPS_PER_PERSON} groups`);
      if (Number(counts.rows[0]!.members) >= MAX_GROUP_MEMBERS) throw new ApiError(409, "member_limit", `A group can have up to ${MAX_GROUP_MEMBERS} members`);
      await client.query("insert into group_members (group_id, user_id, role, display_name) values ($1, $2, $3, $4)", [i.group_id, user.id, i.role, myName]);
      await client.query("update group_invites set used_at = now(), used_by = $2 where id = $1", [token, user.id]);
      await resendGroupRecipes(client, i.group_id);
      return i.group_id;
    });
    return c.json(await groupDetail(groupId, user.id), 200);
  },
);

// ----- members and profiles -----

groupRoutes.openapi(
  createRoute({
    method: "put", path: "/v1/groups/{id}/members/{memberId}", tags: ["groups"], summary: "Make a person an admin or a member (owner)",
    request: { params: GroupMemberParam, body: { required: true, ...json(MemberUpdateSchema) } },
    responses: { 200: { description: "Group", ...json(GroupDetailSchema) }, 403: Err("Not the owner"), 422: Err("Not a person, or the owner"), ...ErrorResponses },
  }),
  async (c) => {
    const user = requireUser(c);
    const { id, memberId } = c.req.valid("param");
    await requireRole(pool, id, user.id, ["owner"]);
    const { member } = await subjectOf(pool, id, memberId);
    if (!member.user_id || member.role === "owner") throw new ApiError(422, "invalid_member", "Only people other than the owner can change role");
    await pool.query("update group_members set role = $2 where id = $1", [memberId, c.req.valid("json").role]);
    return c.json(await groupDetail(id, user.id), 200);
  },
);

groupRoutes.openapi(
  createRoute({
    method: "delete", path: "/v1/groups/{id}/members/{memberId}", tags: ["groups"], summary: "Remove someone, or leave",
    description:
      "The owner can remove anyone else; anyone can remove themselves; a profile's owner can take it out. The owner cannot leave (end the group instead). " +
      "Meals the group planned for a person who leaves stay in their kitchen as their own.",
    request: { params: GroupMemberParam },
    responses: { 204: { description: "Removed" }, 403: Err("Not allowed"), ...ErrorResponses },
  }),
  async (c) => {
    const user = requireUser(c);
    const { id, memberId } = c.req.valid("param");
    const role = await requireRole(pool, id, user.id, ["owner", "admin", "member"]);
    const { member } = await subjectOf(pool, id, memberId);
    const self = member.user_id === user.id;
    if (member.role === "owner") throw new ApiError(403, "forbidden", self ? "The owner can't leave; end the group instead" : "The owner can't be removed");
    if (!(role === "owner" || self || member.owner_user_id === user.id)) throw new ApiError(403, "forbidden", "Only the group's owner can remove people");
    await withTransaction(async (client) => {
      if (member.user_id) {
        await lockUsers(client, [member.user_id]);
        await client.query(
          "update planned_meals set group_id = null, server_seq = nextval('change_seq') where group_id = $1 and user_id = $2 and profile_id is null",
          [id, member.user_id],
        );
      }
      await client.query("delete from group_members where id = $1", [memberId]);
    });
    return c.body(null, 204);
  },
);

async function createProfile(client: pg.PoolClient, ownerId: string, id: string, name: string) {
  await lockUsers(client, [ownerId]);
  const { rows } = await client.query<ProfileRow>(
    `insert into profiles (id, owner_user_id, name, version, server_seq) values ($1, $2, $3, 1, nextval('change_seq'))
     on conflict (id) do nothing returning ${PROFILE_COLUMNS}`,
    [id, ownerId, name],
  );
  if (!rows[0]) throw new ApiError(409, "already_exists", "A profile with this id already exists");
  return rows[0];
}

async function addProfileMember(client: pg.PoolClient, groupId: string, profile: { id: string; name: string }) {
  const n = await client.query<{ n: string }>("select count(*) as n from group_members where group_id = $1", [groupId]);
  if (Number(n.rows[0]!.n) >= MAX_GROUP_MEMBERS) throw new ApiError(409, "member_limit", `A group can have up to ${MAX_GROUP_MEMBERS} members`);
  await client.query(
    "insert into group_members (group_id, profile_id, role, display_name) values ($1, $2, 'member', $3) on conflict (group_id, profile_id) do nothing",
    [groupId, profile.id, profile.name],
  );
}

groupRoutes.openapi(
  createRoute({
    method: "post", path: "/v1/groups/{id}/profiles", tags: ["groups"], summary: "Add a child's profile to a group (owner or admin)",
    description: "Creates a profile owned by your account (no email, password or login, no birthdate) and adds it as a member. Its meals live in your kitchen.",
    request: { params: GroupParam, body: { required: true, ...json(ProfileCreateSchema) } },
    responses: { 201: { description: "Group", ...json(GroupDetailSchema) }, 403: Err("Not an admin"), ...ErrorResponses },
  }),
  async (c) => {
    const user = requireUser(c);
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");
    await requireRole(pool, id, user.id, ["owner", "admin"]);
    await withTransaction(async (client) => addProfileMember(client, id, await createProfile(client, user.id, body.id ?? crypto.randomUUID(), body.name)));
    return c.json(await groupDetail(id, user.id), 201);
  },
);

groupRoutes.openapi(
  createRoute({
    method: "post", path: "/v1/groups/{id}/members", tags: ["groups"], summary: "Add one of my profiles to another group I run",
    request: { params: GroupParam, body: { required: true, ...json(MemberAddSchema) } },
    responses: { 201: { description: "Group", ...json(GroupDetailSchema) }, 403: Err("Not an admin"), ...ErrorResponses },
  }),
  async (c) => {
    const user = requireUser(c);
    const { id } = c.req.valid("param");
    await requireRole(pool, id, user.id, ["owner", "admin"]);
    const profile = (await pool.query<ProfileRow>(`select ${PROFILE_COLUMNS} from profiles where id = $1 and owner_user_id = $2 and deleted_at is null`, [c.req.valid("json").profileId, user.id])).rows[0];
    if (!profile) throw new ApiError(404, "not_found", "Profile not found");
    await withTransaction((client) => addProfileMember(client, id, profile));
    return c.json(await groupDetail(id, user.id), 201);
  },
);

groupRoutes.openapi(
  createRoute({
    method: "get", path: "/v1/profiles", tags: ["groups"], summary: "Profiles my account owns",
    responses: { 200: { description: "Profiles", ...json(z.object({ profiles: z.array(ProfileSchema) })) }, ...ErrorResponses },
  }),
  async (c) => {
    const { rows } = await pool.query<ProfileRow>(`select ${PROFILE_COLUMNS} from profiles where owner_user_id = $1 and deleted_at is null order by created_at`, [requireUser(c).id]);
    return c.json({ profiles: rows.map(toProfile) }, 200);
  },
);

groupRoutes.openapi(
  createRoute({
    method: "put", path: "/v1/profiles/{id}", tags: ["groups"], summary: "Rename a profile I own",
    request: { params: GroupParam, body: { required: true, ...json(ProfileCreateSchema.pick({ name: true })) } },
    responses: { 200: { description: "Profile", ...json(ProfileSchema) }, ...ErrorResponses },
  }),
  async (c) => {
    const user = requireUser(c);
    const { id } = c.req.valid("param");
    const { name } = c.req.valid("json");
    const row = await withTransaction(async (client) => {
      await lockUsers(client, [user.id]);
      const { rows } = await client.query<ProfileRow>(
        `update profiles set name = $3, version = version + 1, server_seq = nextval('change_seq'), updated_at = now()
          where id = $1 and owner_user_id = $2 and deleted_at is null returning ${PROFILE_COLUMNS}`,
        [id, user.id, name],
      );
      if (!rows[0]) throw new ApiError(404, "not_found", "Profile not found");
      await client.query("update group_members set display_name = $2 where profile_id = $1", [id, name]);
      return rows[0];
    });
    return c.json(toProfile(row), 200);
  },
);

groupRoutes.openapi(
  createRoute({
    method: "delete", path: "/v1/profiles/{id}", tags: ["groups"], summary: "Delete a profile I own and everything recorded for it",
    request: { params: GroupParam },
    responses: { 204: { description: "Deleted" }, ...ErrorResponses },
  }),
  async (c) => {
    const user = requireUser(c);
    const { id } = c.req.valid("param");
    await withTransaction(async (client) => {
      await lockUsers(client, [user.id]);
      const { rowCount } = await client.query(
        `update profiles set name = '', version = version + 1, server_seq = nextval('change_seq'), updated_at = now(), deleted_at = now()
          where id = $1 and owner_user_id = $2 and deleted_at is null`,
        [id, user.id],
      );
      if (!rowCount) throw new ApiError(404, "not_found", "Profile not found");
      // Its records are erased; devices drop them when the profile's tombstone arrives.
      await client.query("delete from meal_feedback where profile_id = $1", [id]);
      await client.query("delete from consumption_events where profile_id = $1", [id]);
      await client.query("delete from planned_meals where profile_id = $1", [id]);
      await client.query("delete from food_preferences where profile_id = $1", [id]);
      await client.query("delete from group_members where profile_id = $1", [id]);
    });
    return c.body(null, 204);
  },
);

groupRoutes.openapi(
  createRoute({
    method: "put", path: "/v1/groups/{id}/members/{memberId}/preferences", tags: ["groups"],
    summary: "Record a profile's allergies, likes and dislikes (owner or admin)",
    description:
      "For profiles (children) only: people record their own. Send If-Match with the version you edited, or nothing for a first answer. " +
      "Allergies are what the family tells you; the app never infers them.",
    request: {
      params: GroupMemberParam,
      headers: z.object({ "if-match": z.string().optional() }),
      body: { required: true, ...json(FoodPreferencesBodySchema) },
    },
    responses: {
      200: { description: "Preferences", ...json(FoodPreferencesSchema) },
      403: Err("Not an admin"),
      412: Err("Changed elsewhere; details.server holds the current copy"),
      422: Err("Not a profile, or unknown foods"),
      ...ErrorResponses,
    },
  }),
  async (c) => {
    const user = requireUser(c);
    const { id, memberId } = c.req.valid("param");
    await requireRole(pool, id, user.id, ["owner", "admin"]);
    const s = await subjectOf(pool, id, memberId);
    if (!s.profileId) throw new ApiError(422, "not_a_profile", "People record their own preferences");
    const base = parseIfMatch(c.req.header("if-match"));
    const body = { ...c.req.valid("json"), profileId: s.profileId };
    const outcome = await withTransaction((client) => writePreferences(client, s.feedOwner, s.profileId!, s.profileId, base, body));
    if (outcome.status === "conflict") throw new ApiError(412, "version_conflict", "These preferences changed elsewhere; reload and try again", { server: outcome.server });
    if (outcome.status === "rejected") throw new ApiError(422, outcome.code, outcome.message);
    return c.json((await subjectPreferences(pool, s))!, 200);
  },
);

// ----- meals: admins plan and see; members see their own in their kitchen -----

groupRoutes.openapi(
  createRoute({
    method: "get", path: "/v1/groups/{id}/meals", tags: ["groups"],
    summary: "Every member's plans, eaten meals, feedback and preferences for a date range (owner or admin)",
    description: "At most 31 days. Plans and eaten meals stay separate; a plan never counts as eaten.",
    request: { params: GroupParam, query: z.object({ from: LocalDateSchema, to: LocalDateSchema }) },
    responses: { 200: { description: "Meals", ...json(GroupMealsSchema) }, 403: Err("Not an admin"), ...ErrorResponses },
  }),
  async (c) => {
    const user = requireUser(c);
    const { id } = c.req.valid("param");
    const { from, to } = c.req.valid("query");
    const days = (Date.parse(to) - Date.parse(from)) / 86_400_000;
    if (!(days >= 0 && days <= 30)) throw new ApiError(400, "invalid_range", "Use a range of 1 to 31 days with from ≤ to");
    await requireRole(pool, id, user.id, ["owner", "admin"]);
    const list = await members(pool, id);
    const out = await Promise.all(
      list.map(async (m) => {
        const feedOwner = (m.user_id ?? m.owner_user_id)!;
        const subject = [feedOwner, m.profile_id, from, to];
        const [plans, logs, prefs] = await Promise.all([
          pool.query<PlanRow>(
            `select ${PLAN_COLUMNS} from planned_meals where user_id = $1 and profile_id is not distinct from $2 and deleted_at is null and local_date between $3 and $4 order by local_date, slot`,
            subject,
          ),
          pool.query<LogRow>(
            `select ${LOG_COLUMNS} from consumption_events where user_id = $1 and profile_id is not distinct from $2 and deleted_at is null and local_date between $3 and $4 order by local_date, eaten_at`,
            subject,
          ),
          pool.query<PreferencesRow>("select * from food_preferences where id = $1", [m.profile_id ?? feedOwner]),
        ]);
        const feedback = logs.rows.length
          ? (await pool.query<FeedbackRow>("select * from meal_feedback where id = any($1) and deleted_at is null", [logs.rows.map((l) => l.id)])).rows
          : [];
        return {
          memberId: m.id, name: m.display_name, kind: m.profile_id ? ("profile" as const) : ("person" as const),
          preferences: prefs.rows[0] ? toPreferences(prefs.rows[0]) : null,
          planned: plans.rows.map(toPlan), eaten: logs.rows.map(toLog), feedback: feedback.map(toFeedback),
        };
      }),
    );
    return c.json({ from, to, members: out }, 200);
  },
);

async function writeGroupPlan(groupId: string, actorId: string, planId: string, memberId: string, base: number | null, input: { date: string; slot: "breakfast" | "lunch" | "dinner" | "snack"; recipeId: string; servings: number }) {
  return withTransaction(async (client) => {
    await requireRole(client, groupId, actorId, ["owner", "admin"]);
    const s = await subjectOf(client, groupId, memberId);
    const recipe = await groupRecipe(client, groupId, input.recipeId);
    await lockUsers(client, [s.feedOwner]);
    const row = await loadPlanForWrite(client, planId);
    if (base === null && row) throw new ApiError(409, "already_exists", "A plan with this id already exists");
    if (base !== null) {
      if (!row || row.deleted_at || !planOf(row, s)) throw new ApiError(404, "not_found", "Plan not found");
      if (row.version !== base) throw new ApiError(412, "version_conflict", "This plan changed elsewhere; reload and choose what to keep", { server: toPlan(row) });
    }
    const body = { date: input.date, slot: input.slot, recipeId: recipe.id, title: recipe.title, servings: input.servings, profileId: s.profileId };
    await writePlan(client, { actorId, feedOwner: s.feedOwner, profileId: s.profileId, groupId }, planId, row, body, "planned");
    const saved = (await loadPlanForWrite(client, planId))!;
    return { plan: toPlan(saved), alert: await alertFor(await subjectPreferences(client, s), recipe.ingredients) };
  });
}

/** Finds a plan in a group member's kitchen and checks the caller may act on it as an admin. */
async function planInGroup(client: pg.PoolClient, groupId: string, actorId: string, planId: string) {
  await requireRole(client, groupId, actorId, ["owner", "admin"]);
  const pre = (await client.query<{ user_id: string; profile_id: string | null }>("select user_id, profile_id from planned_meals where id = $1 and deleted_at is null", [planId])).rows[0];
  if (!pre) throw new ApiError(404, "not_found", "Plan not found");
  const m = (await client.query<{ id: string }>(
    pre.profile_id
      ? "select id from group_members where group_id = $1 and profile_id = $2"
      : "select id from group_members where group_id = $1 and user_id = $2",
    [groupId, pre.profile_id ?? pre.user_id],
  )).rows[0];
  if (!m) throw new ApiError(404, "not_found", "Plan not found");
  await lockUsers(client, [pre.user_id]);
  const row = (await loadPlanForWrite(client, planId))!;
  if (row.deleted_at) throw new ApiError(404, "not_found", "Plan not found");
  return row;
}

groupRoutes.openapi(
  createRoute({
    method: "post", path: "/v1/groups/{id}/plans", tags: ["groups"], summary: "Plan a meal for a member (owner or admin)",
    description:
      "The meal reaches the member's kitchen through sync; members can't change it. The answer carries an allergen alert from the member's " +
      "listed allergies and the recipe's foods. It never blocks: the admin decides.",
    request: { params: GroupParam, body: { required: true, ...json(GroupPlanCreateSchema) } },
    responses: { 201: { description: "Planned", ...json(PlanWithAlertSchema) }, 403: Err("Not an admin"), 409: Err("Id in use"), 422: Err("Not a group recipe"), ...ErrorResponses },
  }),
  async (c) => {
    const user = requireUser(c);
    const { id } = c.req.valid("param");
    const { id: planId, memberId, ...input } = c.req.valid("json");
    const result = await writeGroupPlan(id, user.id, planId ?? crypto.randomUUID(), memberId, null, input);
    c.header("ETag", `"v${result.plan.version}"`);
    return c.json(result, 201);
  },
);

groupRoutes.openapi(
  createRoute({
    method: "put", path: "/v1/groups/{id}/plans/{planId}", tags: ["groups"], summary: "Change a member's planned meal (owner or admin; If-Match)",
    request: { params: GroupPlanParam, headers: z.object({ "if-match": z.string().optional() }), body: { required: true, ...json(GroupPlanUpdateSchema) } },
    responses: { 200: { description: "Planned", ...json(PlanWithAlertSchema) }, 403: Err("Not an admin"), 412: Err("Changed elsewhere"), 428: Err("If-Match missing"), ...ErrorResponses },
  }),
  async (c) => {
    const user = requireUser(c);
    const { id, planId } = c.req.valid("param");
    const base = parseIfMatch(c.req.header("if-match"));
    if (base === null) throw new ApiError(428, "precondition_required", "Send If-Match with the plan version you edited");
    const memberId = await withTransaction(async (client) => {
      const row = await planInGroup(client, id, user.id, planId);
      const m = await client.query<{ id: string }>(
        row.profile_id ? "select id from group_members where group_id = $1 and profile_id = $2" : "select id from group_members where group_id = $1 and user_id = $2",
        [id, row.profile_id ?? row.user_id],
      );
      return m.rows[0]!.id;
    });
    const result = await writeGroupPlan(id, user.id, planId, memberId, base, c.req.valid("json"));
    c.header("ETag", `"v${result.plan.version}"`);
    return c.json(result, 200);
  },
);

groupRoutes.openapi(
  createRoute({
    method: "delete", path: "/v1/groups/{id}/plans/{planId}", tags: ["groups"], summary: "Remove a member's planned meal (owner or admin; If-Match)",
    request: { params: GroupPlanParam, headers: z.object({ "if-match": z.string().optional() }) },
    responses: { 204: { description: "Removed" }, 403: Err("Not an admin"), 412: Err("Changed elsewhere"), 428: Err("If-Match missing"), ...ErrorResponses },
  }),
  async (c) => {
    const user = requireUser(c);
    const { id, planId } = c.req.valid("param");
    const base = parseIfMatch(c.req.header("if-match"));
    if (base === null) throw new ApiError(428, "precondition_required", "Send If-Match with the plan version you saw");
    await withTransaction(async (client) => {
      const row = await planInGroup(client, id, user.id, planId);
      if (row.version !== base) throw new ApiError(412, "version_conflict", "This plan changed elsewhere; reload first", { server: toPlan(row) });
      await tombstonePlan(client, row);
    });
    return c.body(null, 204);
  },
);

for (const action of ["approve", "decline"] as const) {
  groupRoutes.openapi(
    createRoute({
      method: "post", path: `/v1/groups/{id}/plans/{planId}/${action}`, tags: ["groups"],
      summary: action === "approve" ? "Approve a meal a member planned for themselves" : "Decline a meal a member planned for themselves",
      request: { params: GroupPlanParam },
      responses: { 200: { description: "Plan", ...json(PlannedMealSchema) }, 403: Err("Not an admin"), 409: Err("Not waiting for approval"), ...ErrorResponses },
    }),
    async (c) => {
      const user = requireUser(c);
      const { id, planId } = c.req.valid("param");
      const plan = await withTransaction(async (client) => {
        const row = await planInGroup(client, id, user.id, planId);
        if (row.status !== "proposed") throw new ApiError(409, "not_proposed", "This plan is not waiting for approval");
        await client.query(
          `update planned_meals set status = $2, group_id = $3, version = version + 1, server_seq = nextval('change_seq'), updated_at = now() where id = $1`,
          [planId, action === "approve" ? "planned" : "declined", id],
        );
        return toPlan((await loadPlanForWrite(client, planId))!);
      });
      return c.json(plan, 200);
    },
  );
}

// ----- group recipes -----

groupRoutes.openapi(
  createRoute({
    method: "get", path: "/v1/groups/{id}/recipes", tags: ["groups"], summary: "The group's recipes (every member can read them)",
    request: { params: GroupParam },
    responses: { 200: { description: "Recipes", ...json(z.object({ recipes: z.array(RecipeSchema) })) }, ...ErrorResponses },
  }),
  async (c) => {
    const user = requireUser(c);
    const { id } = c.req.valid("param");
    await requireRole(pool, id, user.id, ["owner", "admin", "member"]);
    const { rows } = await pool.query("select * from recipes where group_id = $1 and deleted_at is null order by updated_at desc limit 500", [id]);
    return c.json({ recipes: rows.map(toRecipe) }, 200);
  },
);

groupRoutes.openapi(
  createRoute({
    method: "post", path: "/v1/groups/{id}/recipes", tags: ["groups"], summary: "Copy one of my recipes into the group (owner or admin)",
    description: "The copy is a group recipe: every admin can edit it, through sync or PUT /v1/recipes/{id}, and every member receives it. My original stays mine.",
    request: { params: GroupParam, body: { required: true, ...json(GroupRecipeCopySchema) } },
    responses: { 201: { description: "Group recipe", ...json(RecipeSchema) }, 403: Err("Not an admin"), ...ErrorResponses },
  }),
  async (c) => {
    const user = requireUser(c);
    const { id } = c.req.valid("param");
    await requireRole(pool, id, user.id, ["owner", "admin"]);
    const original = await getRecipe(user.id, c.req.valid("json").recipeId);
    if (!original || original.groupId) throw new ApiError(404, "not_found", "Recipe not found");
    const copyId = crypto.randomUUID();
    const recipe = await withTransaction(async (client) => {
      // Every member's kitchen receives the copy: take all their locks first, in order.
      await lockUsers(client, await groupUserIds(client, id));
      const { title, description, servings, ingredients, method, image } = original;
      const outcome = await putRecipe(client, user.id, copyId, null, { title, description, servings, ingredients, method, image });
      if (outcome.status !== "applied") throw new ApiError(422, "copy_failed", "The recipe could not be copied");
      await client.query("update recipes set group_id = $2 where id = $1", [copyId, id]);
      await resendGroupRecipes(client, id);
      return toRecipe((await client.query("select * from recipes where id = $1", [copyId])).rows[0]);
    });
    return c.json(recipe, 201);
  },
);
