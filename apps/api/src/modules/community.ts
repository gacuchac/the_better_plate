import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import {
  CommunityHomeSchema,
  CommunityRecipeSchema,
  CommunityReportSchema,
  CommunityShareSchema,
  CommunityStatusSchema,
  type CommunityCard,
  type CommunityRecipe,
  type CommunityStatus,
} from "@betterplate/contracts";
import { createHash } from "node:crypto";
import { config } from "../config.ts";
import { pool, withTransaction } from "../db/pool.ts";
import { ApiError, type AppEnv, rateLimit, requireUser } from "../lib/http.ts";
import { ErrorResponses, IdParam } from "./common.ts";
import { getRecipe, lockUser, putRecipe } from "./recipes.ts";
import { buildSnapshot, type ShareRow } from "./shares.ts";

// ---------- service ----------
// Opt-in community recipes (owner decision 2026-11-11). An author shares a reviewed snapshot with
// everyone signed in; nobody sees who wrote it, who saved it or who reported it. Trending counts
// distinct people who saved a copy recently. Moderation is light: anyone can report, the author can
// unshare, and a listing hides itself once HIDE_AFTER_REPORTS different people report it.

export const TRENDING_WINDOW_DAYS = 14;
export const TRENDING_LIMIT = 8;
export const HIDE_AFTER_REPORTS = 3;
/** How far back "what you've been eating" reaches for the adventure pick. */
export const ADVENTURE_LOOKBACK_DAYS = 30;

type CommunityRow = {
  id: string;
  user_id: string;
  recipe_id: string;
  recipe_version: number;
  include_method: boolean;
  snapshot: ShareRow["snapshot"];
  food_ids: string[];
  created_at: Date;
  updated_at: Date;
  unshared_at: Date | null;
  hidden_at: Date | null;
};

export function communityEnabled(): boolean {
  return config.features.community;
}

function requireCommunity() {
  if (!communityEnabled()) throw new ApiError(404, "feature_disabled", "Community recipes are not available");
}

const apiBase = () => config.publicApiUrl.replace(/\/$/, "");
const imageUrl = (id: string) => `${apiBase()}/v1/community/${id}/image`;

function toStatus(r: CommunityRow): CommunityStatus {
  return {
    communityId: r.id,
    recipeId: r.recipe_id,
    recipeVersion: r.recipe_version,
    includeMethod: r.include_method,
    includeImage: !!r.snapshot.image,
    sharedAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
    hidden: r.hidden_at !== null,
  };
}

export function toCard(r: CommunityRow, userId: string): CommunityCard {
  const kcal = r.snapshot.nutrition.perServing.find((n) => n.key === "energy_kcal")?.amount ?? null;
  return {
    communityId: r.id,
    title: r.snapshot.title,
    servings: r.snapshot.servings,
    kcalPerServing: kcal,
    image: r.snapshot.image ? { url: imageUrl(r.id), alt: r.snapshot.image.alt } : null,
    mine: r.user_id === userId,
  };
}

/** Live listings everyone may see; the author also sees their own hidden one. */
const VISIBLE = "unshared_at is null and (hidden_at is null or user_id = $1)";

async function liveOwn(userId: string, recipeId: string): Promise<CommunityRow | null> {
  const { rows } = await pool.query<CommunityRow>("select * from community_recipes where recipe_id = $1 and user_id = $2 and unshared_at is null", [recipeId, userId]);
  return rows[0] ?? null;
}

/** Shares (or refreshes) the author's current saved version. Group recipes stay in their group. */
export async function shareWithCommunity(userId: string, recipeId: string, includeMethod: boolean, includeImage: boolean): Promise<CommunityStatus> {
  const recipe = await getRecipe(userId, recipeId);
  if (!recipe || recipe.groupId) throw new ApiError(404, "not_found", "Recipe not found");
  const snapshot = await buildSnapshot(userId, recipe, includeMethod, includeImage);
  const foodIds = [...new Set(recipe.ingredients.map((i) => i.foodId))];
  const row = await withTransaction(async (client) => {
    await lockUser(client, userId);
    const { rows } = await client.query<CommunityRow>(
      `update community_recipes set recipe_version = $3, include_method = $4, snapshot = $5, food_ids = $6, updated_at = now()
        where recipe_id = $1 and user_id = $2 and unshared_at is null returning *`,
      [recipeId, userId, recipe.version, includeMethod, JSON.stringify(snapshot), foodIds],
    );
    if (rows[0]) return rows[0];
    const inserted = await client.query<CommunityRow>(
      `insert into community_recipes (id, user_id, recipe_id, recipe_version, include_method, snapshot, food_ids)
       values (gen_random_uuid(), $1, $2, $3, $4, $5, $6) returning *`,
      [userId, recipeId, recipe.version, includeMethod, JSON.stringify(snapshot), foodIds],
    );
    return inserted.rows[0]!;
  });
  return toStatus(row);
}

/** Stops sharing; the snapshot is erased. Returns false when nothing was shared. */
export async function unshareFromCommunity(userId: string, recipeId: string): Promise<boolean> {
  const { rowCount } = await pool.query(
    `update community_recipes set unshared_at = now(), snapshot = '{}'::jsonb, food_ids = '{}' where recipe_id = $1 and user_id = $2 and unshared_at is null`,
    [recipeId, userId],
  );
  return (rowCount ?? 0) > 0;
}

export async function readCommunity(userId: string, communityId: string): Promise<CommunityRecipe | null> {
  const { rows } = await pool.query<CommunityRow>(`select * from community_recipes where id = $2 and ${VISIBLE}`, [userId, communityId]);
  const r = rows[0];
  if (!r) return null;
  const saved = await pool.query<{ recipe_id: string }>(
    "select s.recipe_id from community_saves s join recipes x on x.id = s.recipe_id and x.deleted_at is null and x.user_id = $1 where s.community_id = $2 and s.user_id = $1",
    [userId, communityId],
  );
  const { image, ...snapshot } = r.snapshot;
  return {
    ...snapshot,
    description: snapshot.description ?? "",
    image: image ? { alt: image.alt, kind: image.kind, credit: image.credit, generator: image.generator, url: imageUrl(r.id) } : null,
    communityId: r.id,
    mine: r.user_id === userId,
    savedRecipeId: saved.rows[0]?.recipe_id ?? null,
    sharedAt: r.updated_at.toISOString(),
  };
}

/** Most saved by different people (not the author) in the window; newest listings fill the rest. */
export async function trending(userId: string): Promise<CommunityCard[]> {
  const { rows } = await pool.query<CommunityRow & { saves: string }>(
    `select c.*, count(s.user_id) filter (where s.created_at > now() - make_interval(days => $1) and s.user_id <> c.user_id) as saves
       from community_recipes c left join community_saves s on s.community_id = c.id
      where c.unshared_at is null and c.hidden_at is null
      group by c.id
      order by saves desc, c.created_at desc
      limit $2`,
    [TRENDING_WINDOW_DAYS, TRENDING_LIMIT],
  );
  return rows.map((r) => toCard(r, userId));
}

/** Overlap of a recipe's foods and food categories with what someone has eaten lately; 0 is completely different. */
export function similarity(candidate: { foods: string[]; categories: string[] }, recent: { foods: Set<string>; categories: Set<string> }): number {
  if (candidate.foods.length === 0) return 1;
  const foodShare = candidate.foods.filter((f) => recent.foods.has(f)).length / candidate.foods.length;
  const cats = [...new Set(candidate.categories)];
  const categoryShare = cats.length ? cats.filter((c) => recent.categories.has(c)).length / cats.length : 1;
  return (foodShare + categoryShare) / 2;
}

/**
 * Something completely different: among community recipes someone else wrote and this person has
 * not saved, the one whose foods and food categories overlap least with what they ate (or, with no
 * meals logged, cooked into their own recipes) lately. Ties change daily but not between reloads.
 */
export async function adventure(userId: string, today: string): Promise<CommunityCard | null> {
  const [recentLogged, candidates] = await Promise.all([
    pool.query<{ food_id: string }>(
      `select distinct i->>'foodId' as food_id
         from consumption_events e, jsonb_array_elements(e.recipe->'ingredients') i
        where e.user_id = $1 and e.deleted_at is null and e.local_date > current_date - make_interval(days => $2)`,
      [userId, ADVENTURE_LOOKBACK_DAYS],
    ),
    pool.query<CommunityRow>(
      `select c.* from community_recipes c
        where c.unshared_at is null and c.hidden_at is null and c.user_id <> $1
          and not exists (select 1 from community_saves s where s.community_id = c.id and s.user_id = $1)
        order by c.created_at desc limit 200`,
      [userId],
    ),
  ]);
  if (candidates.rows.length === 0) return null;
  let recentFoods = recentLogged.rows.map((r) => r.food_id).filter(Boolean);
  if (recentFoods.length === 0) {
    const own = await pool.query<{ food_id: string }>(
      `select distinct i->>'foodId' as food_id from recipes r, jsonb_array_elements(r.body->'ingredients') i where r.user_id = $1 and r.deleted_at is null`,
      [userId],
    );
    recentFoods = own.rows.map((r) => r.food_id).filter(Boolean);
  }
  const allFoods = [...new Set([...recentFoods, ...candidates.rows.flatMap((c) => c.food_ids)])];
  const cats = new Map(
    (await pool.query<{ id: string; category: string | null }>("select id, category from food_items where id = any($1)", [allFoods])).rows.map((r) => [r.id, r.category ?? ""]),
  );
  const recent = { foods: new Set(recentFoods), categories: new Set(recentFoods.map((f) => cats.get(f) ?? "").filter(Boolean)) };
  const tie = (id: string) => createHash("sha256").update(`${userId}:${today}:${id}`).digest().readUInt32BE(0);
  let best: { row: CommunityRow; score: number; tie: number } | null = null;
  for (const row of candidates.rows) {
    const score = similarity({ foods: row.food_ids, categories: row.food_ids.map((f) => cats.get(f) ?? "").filter(Boolean) }, recent);
    const t = tie(row.id);
    if (!best || score < best.score || (score === best.score && t < best.tie)) best = { row, score, tie: t };
  }
  return best ? toCard(best.row, userId) : null;
}

/** Copies a community recipe into the reader's own kitchen and counts the save once per person. */
export async function saveCopy(userId: string, communityId: string): Promise<string> {
  return withTransaction(async (client) => {
    await lockUser(client, userId);
    const { rows } = await client.query<CommunityRow>(`select * from community_recipes where id = $2 and ${VISIBLE}`, [userId, communityId]);
    const r = rows[0];
    if (!r) throw new ApiError(404, "not_found", "This recipe is no longer shared");
    const existing = await client.query<{ recipe_id: string }>(
      "select s.recipe_id from community_saves s join recipes x on x.id = s.recipe_id and x.deleted_at is null and x.user_id = $1 where s.community_id = $2 and s.user_id = $1",
      [userId, communityId],
    );
    if (existing.rows[0]) return existing.rows[0].recipe_id;
    const copyId = crypto.randomUUID();
    const s = r.snapshot;
    // The photo stays the author's; the copy starts without one.
    const outcome = await putRecipe(client, userId, copyId, null, {
      title: s.title,
      description: s.description ?? "",
      servings: s.servings,
      ingredients: s.ingredients.map((i) => ({
        id: i.id, foodId: i.foodId, quantity: i.quantity, unit: i.unit, portionIndex: i.portionIndex, role: i.role, oilDiscardedGrams: i.oilDiscardedGrams,
      })),
      method: s.method ?? "",
      image: null,
    });
    if (outcome.status !== "applied") throw new ApiError(422, "copy_failed", "The recipe could not be copied");
    await client.query(
      `insert into community_saves (community_id, user_id, recipe_id) values ($1, $2, $3)
       on conflict (community_id, user_id) do update set recipe_id = excluded.recipe_id, created_at = now()`,
      [communityId, userId, copyId],
    );
    return copyId;
  });
}

/** One report per person; the listing hides once enough different people (not the author) report it. */
export async function report(userId: string, communityId: string, reason: string): Promise<void> {
  await withTransaction(async (client) => {
    const { rows } = await client.query<{ user_id: string }>("select user_id from community_recipes where id = $1 and unshared_at is null and hidden_at is null for update", [communityId]);
    if (!rows[0] || rows[0].user_id === userId) throw new ApiError(404, "not_found", "This recipe is no longer shared");
    await client.query(
      "insert into community_reports (community_id, user_id, reason) values ($1, $2, $3) on conflict (community_id, user_id) do update set reason = excluded.reason",
      [communityId, userId, reason],
    );
    await client.query(
      `update community_recipes set hidden_at = now() where id = $1 and hidden_at is null
         and (select count(*) from community_reports where community_id = $1) >= $2`,
      [communityId, HIDE_AFTER_REPORTS],
    );
  });
}

// ---------- routes ----------

const json = <T extends z.ZodType>(schema: T) => ({ content: { "application/json": { schema } } });
const CommunityParam = z.object({ communityId: z.uuid() });

export const communityRoutes = new OpenAPIHono<AppEnv>();
communityRoutes.use("/v1/community/*", rateLimit("community", 120, 60));
communityRoutes.use("/v1/recipes/:id/community", rateLimit("community-share", 30, 3600));

communityRoutes.openapi(
  createRoute({
    method: "get", path: "/v1/recipes/{id}/community", tags: ["community"], summary: "Whether I shared this recipe with the community",
    request: { params: IdParam },
    responses: { 200: { description: "Shared", ...json(CommunityStatusSchema) }, ...ErrorResponses },
  }),
  async (c) => {
    requireCommunity();
    const row = await liveOwn(requireUser(c).id, c.req.valid("param").id);
    if (!row) throw new ApiError(404, "not_shared", "Not shared with the community");
    return c.json(toStatus(row), 200);
  },
);

communityRoutes.openapi(
  createRoute({
    method: "put", path: "/v1/recipes/{id}/community", tags: ["community"],
    summary: "Share my recipe's current saved version with the community, or refresh what is shared",
    description:
      "Online only, my own recipes only (not group recipes). Everyone signed in can read the snapshot: title, description, servings, ingredients, " +
      "the USDA-based estimate and, if chosen, the method and the photo. Never my name, email, meals or other recipes.",
    request: { params: IdParam, body: { required: true, ...json(CommunityShareSchema) } },
    responses: { 200: { description: "Shared", ...json(CommunityStatusSchema) }, 409: { description: "Recipe not ready to share", ...json(z.object({ error: z.any() })) }, ...ErrorResponses },
  }),
  async (c) => {
    requireCommunity();
    const { includeMethod, includeImage } = c.req.valid("json");
    return c.json(await shareWithCommunity(requireUser(c).id, c.req.valid("param").id, includeMethod, includeImage), 200);
  },
);

communityRoutes.openapi(
  createRoute({
    method: "delete", path: "/v1/recipes/{id}/community", tags: ["community"], summary: "Stop sharing with the community; the snapshot is erased",
    description: "Copies other people already saved stay in their kitchens.",
    request: { params: IdParam },
    responses: { 204: { description: "Not shared any more (also when it was not shared)" }, ...ErrorResponses },
  }),
  async (c) => {
    requireCommunity();
    await unshareFromCommunity(requireUser(c).id, c.req.valid("param").id);
    return c.body(null, 204);
  },
);

communityRoutes.openapi(
  createRoute({
    method: "get", path: "/v1/community/home", tags: ["community"], summary: "Trending community recipes and something completely different, for the home page",
    request: { query: z.object({ today: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }) },
    responses: { 200: { description: "Picks", ...json(CommunityHomeSchema) }, ...ErrorResponses },
  }),
  async (c) => {
    requireCommunity();
    const user = requireUser(c);
    const today = c.req.valid("query").today ?? new Date().toISOString().slice(0, 10);
    const [list, pick] = await Promise.all([trending(user.id), adventure(user.id, today)]);
    c.header("Cache-Control", "no-store");
    return c.json({ trending: list, windowDays: TRENDING_WINDOW_DAYS, adventure: pick }, 200);
  },
);

communityRoutes.openapi(
  createRoute({
    method: "get", path: "/v1/community/{communityId}", tags: ["community"], summary: "Read a community recipe",
    request: { params: CommunityParam },
    responses: { 200: { description: "Recipe", ...json(CommunityRecipeSchema) }, ...ErrorResponses },
  }),
  async (c) => {
    requireCommunity();
    const recipe = await readCommunity(requireUser(c).id, c.req.valid("param").communityId);
    c.header("Cache-Control", "no-store");
    if (!recipe) throw new ApiError(404, "not_found", "This recipe is no longer shared");
    return c.json(recipe, 200);
  },
);

communityRoutes.openapi(
  createRoute({
    method: "get", path: "/v1/community/{communityId}/image", tags: ["community"], summary: "The photo of a community recipe",
    description: "Only when the author shared the photo; stops working when the recipe is unshared or hidden.",
    request: { params: CommunityParam },
    responses: { 200: { description: "Image bytes", content: { "image/webp": { schema: z.any() }, "image/jpeg": { schema: z.any() }, "image/png": { schema: z.any() } } }, ...ErrorResponses },
  }),
  async (c) => {
    requireCommunity();
    const user = requireUser(c);
    const { rows: listings } = await pool.query<CommunityRow>(`select * from community_recipes where id = $2 and ${VISIBLE}`, [user.id, c.req.valid("param").communityId]);
    const listing = listings[0];
    const imageId = listing?.snapshot.image?.id;
    const { rows } = imageId
      ? await pool.query<{ mime: string; bytes: Buffer }>("select mime, bytes from recipe_images where id = $1 and user_id = $2", [imageId, listing.user_id])
      : { rows: [] };
    c.header("Cache-Control", "private, no-store");
    if (!rows[0]) throw new ApiError(404, "not_found", "No photo");
    return c.body(new Uint8Array(rows[0].bytes), 200, { "content-type": rows[0].mime, "x-content-type-options": "nosniff" });
  },
);

communityRoutes.openapi(
  createRoute({
    method: "post", path: "/v1/community/{communityId}/save", tags: ["community"], summary: "Save a copy of a community recipe into my kitchen",
    description: "The copy is my own recipe from then on (without the author's photo). Saving again returns the copy I already have.",
    request: { params: CommunityParam },
    responses: { 201: { description: "Saved", ...json(z.object({ recipeId: z.uuid() })) }, ...ErrorResponses },
  }),
  async (c) => {
    requireCommunity();
    return c.json({ recipeId: await saveCopy(requireUser(c).id, c.req.valid("param").communityId) }, 201);
  },
);

communityRoutes.openapi(
  createRoute({
    method: "post", path: "/v1/community/{communityId}/report", tags: ["community"], summary: "Report a community recipe",
    description: `One report per person. After ${HIDE_AFTER_REPORTS} different people report it, it is hidden from everyone but its author.`,
    request: { params: CommunityParam, body: { required: true, ...json(CommunityReportSchema) } },
    responses: { 204: { description: "Reported" }, ...ErrorResponses },
  }),
  async (c) => {
    requireCommunity();
    await report(requireUser(c).id, c.req.valid("param").communityId, c.req.valid("json").reason);
    return c.body(null, 204);
  },
);
