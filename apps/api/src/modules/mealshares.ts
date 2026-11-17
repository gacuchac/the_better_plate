import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import type pg from "pg";
import {
  MealReactionBodySchema,
  MealShareCreateSchema,
  MealShareUpdateSchema,
  MealsToReviewSchema,
  SHARED_MEAL_NUTRIENTS,
  SHARED_MEAL_SUMMARY_MAX,
  SharedMealListSchema,
  SharedMealSchema,
  type GroupRole,
  type MealReactionKind,
  type Recipe,
  type SharedMeal,
} from "@betterplate/contracts";
import { config } from "../config.ts";
import { pool, withTransaction } from "../db/pool.ts";
import { ApiError, type AppEnv, rateLimit, requireUser } from "../lib/http.ts";
import { isAdminRole } from "./access.ts";
import { currentCatalog } from "./catalog.ts";
import { ErrorResponses } from "./common.ts";
import { requireRole } from "./groups.ts";
import { toRecipe } from "./recipes.ts";

/**
 * Meals a group's owner or admins share with the group: a simplified card (title, short
 * description, photo, estimated nutrients per serving), never the ingredients or the method.
 * Each person can like it or pass, with an optional comment that only they and the admins see.
 */

export const MAX_SHARED_MEALS_PER_GROUP = 500;
const PAGE = 20;
/** Shares older than this don't count as waiting for a reaction. */
const REVIEW_DAYS = 30;

const enabled = () => config.features.groupMealShares;
function requireEnabled() {
  if (!enabled()) throw new ApiError(404, "feature_disabled", "Shared meals are not available");
}

type ImageRef = { id: string; ownerId: string; alt: string; kind: "photo" | "generated" | "upload"; credit: unknown; generator: { provider: "openai"; model: string } | null };
export type MealSnapshot = {
  title: string;
  summary: string;
  nutrients: { key: string; name: string; amount: number | null; unit: string; status: "known" | "partial" | "unknown" }[];
  image: ImageRef | null;
};
type ShareRow = { id: string; group_id: string; created_by: string; recipe_id: string | null; snapshot: MealSnapshot; created_at: Date; updated_at: Date; shared_by: string | null };
type ReactionRow = { share_id: string; member_id: string; name: string; reaction: MealReactionKind; comment: string; updated_at: Date };

const apiBase = () => config.publicApiUrl.replace(/\/$/, "");
const imageUrl = (groupId: string, shareId: string) => `${apiBase()}/v1/groups/${groupId}/meal-shares/${shareId}/image`;
const notFound = () => new ApiError(404, "not_found", "Shared meal not found");

/** The caller's membership in a group (people only), or 404. */
async function membership(db: Pick<pg.PoolClient, "query">, groupId: string, userId: string): Promise<{ memberId: string; role: GroupRole }> {
  const { rows } = await db.query<{ id: string; role: GroupRole }>("select id, role from group_members where group_id = $1 and user_id = $2", [groupId, userId]);
  if (!rows[0]) throw new ApiError(404, "not_found", "Group not found");
  return { memberId: rows[0].id, role: rows[0].role };
}

/** A recipe of mine or of this group, with a nutrition estimate. */
async function sourceRecipe(db: Pick<pg.PoolClient, "query">, groupId: string, userId: string, recipeId: string): Promise<Recipe> {
  const { rows } = await db.query("select * from recipes where id = $1 and deleted_at is null and (user_id = $2 or group_id = $3)", [recipeId, userId, groupId]);
  if (!rows[0]) throw new ApiError(404, "recipe_not_found", "Recipe not found");
  const recipe = toRecipe(rows[0]);
  if (!recipe.nutrition) throw new ApiError(409, "not_ready", "This recipe has no nutrition estimate yet; save it again and retry");
  return recipe;
}

/**
 * The photo for a share: one already on it, the recipe's own photo (which may be another admin's on
 * a group recipe), or one of the caller's images. Credit and generator come from the server's record.
 */
async function resolveImage(
  db: Pick<pg.PoolClient, "query">,
  userId: string,
  imageId: string,
  allowed: { id: string; alt: string }[],
  fallbackAlt: string,
): Promise<ImageRef> {
  const { rows } = await db.query<{ id: string; user_id: string; kind: ImageRef["kind"]; credit: unknown; generator: ImageRef["generator"] }>(
    "select id, user_id, kind, credit, generator from recipe_images where id = $1",
    [imageId],
  );
  const row = rows[0];
  const known = allowed.find((a) => a.id === imageId);
  if (!row || (!known && row.user_id !== userId)) throw new ApiError(422, "image_not_allowed", "Use the recipe's photo or one of your own");
  return { id: row.id, ownerId: row.user_id, alt: known?.alt || fallbackAlt, kind: row.kind, credit: row.credit, generator: row.generator };
}

async function snapshotOf(db: Pick<pg.PoolClient, "query">, userId: string, recipe: Recipe, summary: string | undefined, imageId: string | null | undefined): Promise<MealSnapshot> {
  const catalog = await currentCatalog();
  const names = new Map(catalog.nutrients.map((n) => [n.key, n.name]));
  const nutrients = SHARED_MEAL_NUTRIENTS.flatMap((key) => {
    const n = recipe.nutrition!.perServing.find((x) => x.key === key);
    return n ? [{ key, name: names.get(key) ?? key, amount: n.amount, unit: n.unit, status: n.status }] : [];
  });
  const chosen = imageId === undefined ? (recipe.image?.id ?? null) : imageId;
  const image = chosen
    ? await resolveImage(db, userId, chosen, recipe.image ? [{ id: recipe.image.id, alt: recipe.image.alt }] : [], recipe.title)
    : null;
  return { title: recipe.title, summary: (summary ?? recipe.description).trim().slice(0, SHARED_MEAL_SUMMARY_MAX), nutrients, image };
}

const SHARE_SELECT = `select s.*, (select display_name from group_members m where m.group_id = s.group_id and m.user_id = s.created_by) as shared_by
                        from group_meal_shares s`;

function toSharedMeal(row: ShareRow, me: { memberId: string; role: GroupRole }, reactions: ReactionRow[]): SharedMeal {
  const mine = reactions.find((r) => r.member_id === me.memberId);
  const img = row.snapshot.image;
  return {
    id: row.id,
    title: row.snapshot.title,
    summary: row.snapshot.summary,
    nutrients: row.snapshot.nutrients,
    image: img ? { url: imageUrl(row.group_id, row.id), alt: img.alt, kind: img.kind, credit: img.credit ?? null, generator: img.generator } : null,
    sharedBy: row.shared_by ?? "A group admin",
    sharedAt: row.created_at.toISOString(),
    myReaction: mine ? { reaction: mine.reaction, comment: mine.comment } : null,
    reactions: isAdminRole(me.role)
      ? reactions.map((r) => ({ memberId: r.member_id, name: r.name, reaction: r.reaction, comment: r.comment, updatedAt: r.updated_at.toISOString() }))
      : null,
  };
}

/** Reactions to these shares the caller may see: everyone's for admins, their own otherwise. */
async function reactionsFor(db: Pick<pg.PoolClient, "query">, shareIds: string[], me: { memberId: string; role: GroupRole }): Promise<ReactionRow[]> {
  if (shareIds.length === 0) return [];
  const { rows } = await db.query<ReactionRow>(
    `select r.share_id, r.member_id, m.display_name as name, r.reaction, r.comment, r.updated_at
       from group_meal_reactions r join group_members m on m.id = r.member_id
      where r.share_id = any($1) and ($2 or r.member_id = $3) order by r.updated_at`,
    [shareIds, isAdminRole(me.role), me.memberId],
  );
  return rows;
}

async function loadShare(db: Pick<pg.PoolClient, "query">, groupId: string, shareId: string): Promise<ShareRow> {
  const { rows } = await db.query<ShareRow>(`${SHARE_SELECT} where s.id = $1 and s.group_id = $2`, [shareId, groupId]);
  if (!rows[0]) throw notFound();
  return rows[0];
}

async function oneMeal(groupId: string, shareId: string, me: { memberId: string; role: GroupRole }): Promise<SharedMeal> {
  const row = await loadShare(pool, groupId, shareId);
  return toSharedMeal(row, me, await reactionsFor(pool, [row.id], me));
}

const encodeCursor = (r: ShareRow) => Buffer.from(`${r.created_at.toISOString()}|${r.id}`).toString("base64url");
function decodeCursor(cursor: string): [string, string] {
  const [at, id] = Buffer.from(cursor, "base64url").toString().split("|");
  if (!at || !id || Number.isNaN(Date.parse(at)) || !/^[0-9a-f-]{36}$/.test(id)) throw new ApiError(400, "invalid_cursor", "Invalid cursor");
  return [at, id];
}

// ---------- routes ----------

const json = <T extends z.ZodType>(schema: T) => ({ content: { "application/json": { schema } } });
const Err = (description: string) => ({ description, ...json(z.object({ error: z.any() })) });
const GroupParam = z.object({ id: z.uuid() });
const ShareParam = z.object({ id: z.uuid(), shareId: z.uuid() });

export const mealShareRoutes = new OpenAPIHono<AppEnv>();
mealShareRoutes.use("/v1/me/meals-to-review", rateLimit("group", 300, 60));
mealShareRoutes.on("POST", "/v1/groups/:id/meal-shares", rateLimit("meal-share-create", 60, 3600));

mealShareRoutes.openapi(
  createRoute({
    method: "post", path: "/v1/groups/{id}/meal-shares", tags: ["groups"], summary: "Share a meal with the group (owner or admin)",
    description:
      "Shares a simplified card made from one of your recipes or one of the group's: its title, a short description, a photo and the estimated nutrients per serving. " +
      "Never the ingredients or the method, though members can already open the group's own recipes. Later recipe edits don't change it.",
    request: { params: GroupParam, body: { required: true, ...json(MealShareCreateSchema) } },
    responses: { 201: { description: "Shared", ...json(SharedMealSchema) }, 403: Err("Not an admin"), 409: Err("No nutrition estimate, or too many shares"), 422: Err("Image not allowed"), ...ErrorResponses },
  }),
  async (c) => {
    requireEnabled();
    const user = requireUser(c);
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");
    const shareId = crypto.randomUUID();
    await withTransaction(async (client) => {
      await requireRole(client, id, user.id, ["owner", "admin"]);
      const n = (await client.query<{ n: string }>("select count(*) as n from group_meal_shares where group_id = $1", [id])).rows[0]!;
      if (Number(n.n) >= MAX_SHARED_MEALS_PER_GROUP) throw new ApiError(409, "share_limit", `A group can have up to ${MAX_SHARED_MEALS_PER_GROUP} shared meals; withdraw some first`);
      const recipe = await sourceRecipe(client, id, user.id, body.recipeId);
      const snapshot = await snapshotOf(client, user.id, recipe, body.summary, body.imageId);
      await client.query("insert into group_meal_shares (id, group_id, created_by, recipe_id, snapshot) values ($1, $2, $3, $4, $5)", [shareId, id, user.id, recipe.id, snapshot]);
    });
    return c.json(await oneMeal(id, shareId, await membership(pool, id, user.id)), 201);
  },
);

mealShareRoutes.openapi(
  createRoute({
    method: "get", path: "/v1/groups/{id}/meal-shares", tags: ["groups"], summary: "Meals shared with the group, newest first",
    description: "Everyone in the group sees the meals and their own reaction; the owner and admins also see everyone's reactions and comments.",
    request: { params: GroupParam, query: z.object({ cursor: z.string().max(200).optional() }) },
    responses: { 200: { description: "Shared meals", ...json(SharedMealListSchema) }, ...ErrorResponses },
  }),
  async (c) => {
    requireEnabled();
    const user = requireUser(c);
    const { id } = c.req.valid("param");
    const { cursor } = c.req.valid("query");
    const me = await membership(pool, id, user.id);
    const after = cursor ? decodeCursor(cursor) : null;
    const { rows } = await pool.query<ShareRow>(
      `${SHARE_SELECT} where s.group_id = $1 ${after ? "and (s.created_at, s.id) < ($3::timestamptz, $4::uuid)" : ""}
        order by s.created_at desc, s.id desc limit $2`,
      after ? [id, PAGE + 1, after[0], after[1]] : [id, PAGE + 1],
    );
    const page = rows.slice(0, PAGE);
    const reactions = await reactionsFor(pool, page.map((r) => r.id), me);
    return c.json(
      { meals: page.map((r) => toSharedMeal(r, me, reactions.filter((x) => x.share_id === r.id))), nextCursor: rows.length > PAGE ? encodeCursor(page[PAGE - 1]!) : null },
      200,
    );
  },
);

mealShareRoutes.openapi(
  createRoute({
    method: "put", path: "/v1/groups/{id}/meal-shares/{shareId}", tags: ["groups"], summary: "Change a shared meal's description or photo (owner or admin)",
    request: { params: ShareParam, body: { required: true, ...json(MealShareUpdateSchema) } },
    responses: { 200: { description: "Shared meal", ...json(SharedMealSchema) }, 403: Err("Not an admin"), 422: Err("Image not allowed"), ...ErrorResponses },
  }),
  async (c) => {
    requireEnabled();
    const user = requireUser(c);
    const { id, shareId } = c.req.valid("param");
    const { summary, imageId } = c.req.valid("json");
    await withTransaction(async (client) => {
      await requireRole(client, id, user.id, ["owner", "admin"]);
      const row = await loadShare(client, id, shareId);
      const next = { ...row.snapshot };
      if (summary !== undefined) next.summary = summary;
      if (imageId !== undefined) {
        if (imageId === null) next.image = null;
        else if (imageId !== row.snapshot.image?.id) {
          const recipeImage = row.recipe_id
            ? ((await client.query<{ body: { image?: { id: string; alt: string } } }>("select body from recipes where id = $1 and deleted_at is null", [row.recipe_id])).rows[0]?.body.image ?? null)
            : null;
          next.image = await resolveImage(client, user.id, imageId, recipeImage ? [recipeImage] : [], row.snapshot.title);
        }
      }
      await client.query("update group_meal_shares set snapshot = $2, updated_at = now() where id = $1", [shareId, next]);
    });
    return c.json(await oneMeal(id, shareId, await membership(pool, id, user.id)), 200);
  },
);

mealShareRoutes.openapi(
  createRoute({
    method: "delete", path: "/v1/groups/{id}/meal-shares/{shareId}", tags: ["groups"], summary: "Withdraw a shared meal and its reactions (owner or admin)",
    request: { params: ShareParam },
    responses: { 204: { description: "Withdrawn" }, 403: Err("Not an admin"), ...ErrorResponses },
  }),
  async (c) => {
    requireEnabled();
    const user = requireUser(c);
    const { id, shareId } = c.req.valid("param");
    await requireRole(pool, id, user.id, ["owner", "admin"]);
    await pool.query("delete from group_meal_shares where id = $1 and group_id = $2", [shareId, id]);
    return c.body(null, 204);
  },
);

mealShareRoutes.openapi(
  createRoute({
    method: "get", path: "/v1/groups/{id}/meal-shares/{shareId}/image", tags: ["groups"], summary: "The photo of a shared meal (people in the group)",
    request: { params: ShareParam },
    responses: { 200: { description: "Image bytes", content: { "image/webp": { schema: z.any() }, "image/jpeg": { schema: z.any() }, "image/png": { schema: z.any() } } }, ...ErrorResponses },
  }),
  async (c) => {
    requireEnabled();
    const user = requireUser(c);
    const { id, shareId } = c.req.valid("param");
    await membership(pool, id, user.id);
    const img = (await loadShare(pool, id, shareId)).snapshot.image;
    const { rows } = img
      ? await pool.query<{ mime: string; bytes: Buffer }>("select mime, bytes from recipe_images where id = $1 and user_id = $2", [img.id, img.ownerId])
      : { rows: [] };
    if (!rows[0]) throw new ApiError(404, "not_found", "Image not found");
    return c.body(new Uint8Array(rows[0].bytes), 200, {
      "content-type": rows[0].mime,
      // A share's photo can change, so revalidate; private so shared caches never keep it.
      "cache-control": "private, no-cache",
      "x-content-type-options": "nosniff",
    });
  },
);

mealShareRoutes.openapi(
  createRoute({
    method: "put", path: "/v1/groups/{id}/meal-shares/{shareId}/reaction", tags: ["groups"], summary: "Like a shared meal or pass on it, with an optional comment",
    description: "One reaction per person; sending again replaces it. Only you and the group's owner and admins see it.",
    request: { params: ShareParam, body: { required: true, ...json(MealReactionBodySchema) } },
    responses: { 200: { description: "Shared meal", ...json(SharedMealSchema) }, ...ErrorResponses },
  }),
  async (c) => {
    requireEnabled();
    const user = requireUser(c);
    const { id, shareId } = c.req.valid("param");
    const { reaction, comment } = c.req.valid("json");
    const me = await membership(pool, id, user.id);
    await loadShare(pool, id, shareId);
    await pool.query(
      `insert into group_meal_reactions (share_id, member_id, reaction, comment) values ($1, $2, $3, $4)
       on conflict (share_id, member_id) do update set reaction = excluded.reaction, comment = excluded.comment, updated_at = now()`,
      [shareId, me.memberId, reaction, comment],
    );
    return c.json(await oneMeal(id, shareId, me), 200);
  },
);

mealShareRoutes.openapi(
  createRoute({
    method: "delete", path: "/v1/groups/{id}/meal-shares/{shareId}/reaction", tags: ["groups"], summary: "Take back my reaction",
    request: { params: ShareParam },
    responses: { 204: { description: "Removed" }, ...ErrorResponses },
  }),
  async (c) => {
    requireEnabled();
    const user = requireUser(c);
    const { id, shareId } = c.req.valid("param");
    const me = await membership(pool, id, user.id);
    await pool.query("delete from group_meal_reactions where share_id = $1 and member_id = $2", [shareId, me.memberId]);
    return c.body(null, 204);
  },
);

mealShareRoutes.openapi(
  createRoute({
    method: "delete", path: "/v1/groups/{id}/meal-shares/{shareId}/reactions/{memberId}/comment", tags: ["groups"], summary: "Remove someone's comment (owner or admin)",
    description: "Their like or pass stays; only the comment is cleared.",
    request: { params: ShareParam.extend({ memberId: z.uuid() }) },
    responses: { 204: { description: "Removed" }, 403: Err("Not an admin"), ...ErrorResponses },
  }),
  async (c) => {
    requireEnabled();
    const user = requireUser(c);
    const { id, shareId, memberId } = c.req.valid("param");
    await requireRole(pool, id, user.id, ["owner", "admin"]);
    await pool.query(
      `update group_meal_reactions r set comment = '', updated_at = now() from group_meal_shares s
        where r.share_id = s.id and s.group_id = $1 and r.share_id = $2 and r.member_id = $3`,
      [id, shareId, memberId],
    );
    return c.body(null, 204);
  },
);

mealShareRoutes.openapi(
  createRoute({
    method: "get", path: "/v1/me/meals-to-review", tags: ["groups"], summary: "Groups with shared meals I haven't reacted to",
    description: `Counts meals others shared in the last ${REVIEW_DAYS} days.`,
    responses: { 200: { description: "Groups", ...json(MealsToReviewSchema) }, ...ErrorResponses },
  }),
  async (c) => {
    requireEnabled();
    const user = requireUser(c);
    const { rows } = await pool.query<{ group_id: string; group_name: string; n: string }>(
      `select g.id as group_id, g.name as group_name, count(*) as n
         from group_members m join groups g on g.id = m.group_id
         join group_meal_shares s on s.group_id = m.group_id and s.created_by <> $1 and s.created_at > now() - make_interval(days => $2)
        where m.user_id = $1 and not exists (select 1 from group_meal_reactions r where r.share_id = s.id and r.member_id = m.id)
        group by g.id, g.name order by g.name`,
      [user.id, REVIEW_DAYS],
    );
    return c.json({ groups: rows.map((r) => ({ groupId: r.group_id, groupName: r.group_name, count: Number(r.n) })) }, 200);
  },
);
