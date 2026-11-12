import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import {
  CheerBodySchema,
  MilestoneShareSchema,
  MilestonesSchema,
  MyMilestoneSchema,
  type Cheer,
  type MilestoneKind,
  type MilestonePost,
  type Milestones,
  type MyMilestone,
} from "@betterplate/contracts";
import { addDays, foodBaseName, isoWeek, isPlantFood } from "@betterplate/nutrition";
import { config } from "../config.ts";
import { pool } from "../db/pool.ts";
import { ApiError, type AppEnv, rateLimit, requireUser } from "../lib/http.ts";
import { ErrorResponses } from "./common.ts";

// ---------- service ----------
// Shared milestones (owner decision 2026-11-12): small steps the app suggests, shared one at a time
// by the person's choice, cheered by others with preset reactions. There is no free text, so nothing
// hurtful can be posted and no report flow is needed; the flag is the kill switch. Nobody sees who
// shared or cheered, and only the author sees how many cheers a milestone got.

/** How long a milestone stays in others' feeds. */
export const FEED_WINDOW_DAYS = 14;
export const FEED_LIMIT = 30;
/** How recent a recipe must be to count as new for the new_recipe suggestion. */
export const NEW_RECIPE_DAYS = 8;

export function milestonesEnabled(): boolean {
  return config.features.milestones;
}

function requireMilestones() {
  if (!milestonesEnabled()) throw new ApiError(404, "feature_disabled", "Milestones are not available");
}

/**
 * Weeks a new milestone may name: this week or last week on the person's own calendar. Allowing a
 * day on either side of the server's UTC date covers every time zone.
 */
export function acceptedWeeks(now = new Date()): Set<string> {
  const today = now.toISOString().slice(0, 10);
  return new Set([addDays(today, 1), today, addDays(today, -1), addDays(today, -7), addDays(today, -8)].map(isoWeek));
}

type PostRow = { id: string; user_id: string; kind: MilestoneKind; week: string; food_id: string | null; description: string | null; created_at: Date };

const foodName = (description: string | null) => (description ? foodBaseName(description) : null);

export async function shareMilestone(userId: string, kind: MilestoneKind, week: string, foodId: string | null | undefined, now = new Date()): Promise<MyMilestone> {
  if (!acceptedWeeks(now).has(week)) throw new ApiError(422, "invalid_week", "Milestones can be shared for this week or last week");
  let food: { id: string; description: string } | null = null;
  if (kind === "new_plant") {
    if (!foodId) throw new ApiError(422, "food_required", "Say which food was new");
    const { rows } = await pool.query<{ id: string; description: string; category: string | null }>("select id, description, category from food_items where id = $1", [foodId]);
    if (!rows[0] || !isPlantFood(rows[0])) throw new ApiError(422, "invalid_food", "That food can't be shared as something new");
    food = rows[0];
  } else if (foodId) {
    throw new ApiError(422, "invalid_food", "Only a new food milestone names a food");
  }
  // Sharing the same kind again in the same week returns the milestone already shared.
  await pool.query(
    `insert into milestone_posts (id, user_id, kind, week, food_id) values (gen_random_uuid(), $1, $2, $3, $4)
     on conflict (user_id, kind, week) do nothing`,
    [userId, kind, week, food?.id ?? null],
  );
  const mine = await myMilestones(userId);
  return mine.find((m) => m.kind === kind && m.week === week)!;
}

/** Stops sharing: the milestone and its cheers are deleted. False when there was nothing to delete. */
export async function unshareMilestone(userId: string, id: string): Promise<boolean> {
  const { rowCount } = await pool.query("delete from milestone_posts where id = $1 and user_id = $2", [id, userId]);
  return (rowCount ?? 0) > 0;
}

export async function myMilestones(userId: string): Promise<MyMilestone[]> {
  const { rows } = await pool.query<PostRow & { well_done: string; keep_going: string; love_this: string }>(
    `select p.*, f.description,
            count(*) filter (where c.cheer = 'well_done') as well_done,
            count(*) filter (where c.cheer = 'keep_going') as keep_going,
            count(*) filter (where c.cheer = 'love_this') as love_this
       from milestone_posts p
       left join food_items f on f.id = p.food_id
       left join milestone_cheers c on c.post_id = p.id
      where p.user_id = $1
      group by p.id, f.description
      order by p.created_at desc`,
    [userId],
  );
  return rows.map((r) => ({
    milestoneId: r.id,
    kind: r.kind,
    week: r.week,
    foodId: r.food_id,
    foodName: foodName(r.description),
    sharedAt: r.created_at.toISOString(),
    cheers: { well_done: Number(r.well_done), keep_going: Number(r.keep_going), love_this: Number(r.love_this) },
  }));
}

/** Others' recent milestones, the least cheered first so every one gets seen. No counts, no authors. */
export async function feed(userId: string): Promise<MilestonePost[]> {
  const { rows } = await pool.query<PostRow & { my_cheer: Cheer | null }>(
    `select p.id, p.kind, p.week, p.food_id, p.created_at, f.description,
            (select cheer from milestone_cheers m where m.post_id = p.id and m.user_id = $1) as my_cheer
       from milestone_posts p
       left join food_items f on f.id = p.food_id
      where p.user_id <> $1 and p.created_at > now() - make_interval(days => $2)
      order by (select count(*) from milestone_cheers c where c.post_id = p.id) asc, p.created_at desc
      limit $3`,
    [userId, FEED_WINDOW_DAYS, FEED_LIMIT],
  );
  return rows.map((r) => ({ milestoneId: r.id, kind: r.kind, week: r.week, foodName: foodName(r.description), sharedAt: r.created_at.toISOString(), myCheer: r.my_cheer }));
}

/** What the app needs to suggest the two milestones it can't work out on the device alone. */
async function suggestionHints(userId: string): Promise<{ communityCopyIds: string[]; newRecipeIds: string[] }> {
  const [copies, fresh] = await Promise.all([
    pool.query<{ recipe_id: string }>(
      "select s.recipe_id from community_saves s join recipes r on r.id = s.recipe_id and r.user_id = $1 and r.deleted_at is null where s.user_id = $1",
      [userId],
    ),
    pool.query<{ id: string }>(
      `select r.id from recipes r
        where r.user_id = $1 and r.deleted_at is null and r.group_id is null and r.created_at > now() - make_interval(days => $2)
          and not exists (select 1 from community_saves s where s.recipe_id = r.id)`,
      [userId, NEW_RECIPE_DAYS],
    ),
  ]);
  return { communityCopyIds: copies.rows.map((r) => r.recipe_id), newRecipeIds: fresh.rows.map((r) => r.id) };
}

export async function milestones(userId: string): Promise<Milestones> {
  const [mine, others, hints] = await Promise.all([myMilestones(userId), feed(userId), suggestionHints(userId)]);
  return { mine, feed: others, windowDays: FEED_WINDOW_DAYS, ...hints };
}

/** One cheer per person per milestone, never on your own. Cheering again replaces the cheer. */
export async function cheer(userId: string, id: string, value: Cheer): Promise<void> {
  const { rows } = await pool.query<{ user_id: string }>("select user_id from milestone_posts where id = $1", [id]);
  if (!rows[0] || rows[0].user_id === userId) throw new ApiError(404, "not_found", "This milestone isn't shared any more");
  await pool.query(
    `insert into milestone_cheers (post_id, user_id, cheer) values ($1, $2, $3)
     on conflict (post_id, user_id) do update set cheer = excluded.cheer, created_at = now()`,
    [id, userId, value],
  );
}

export async function uncheer(userId: string, id: string): Promise<void> {
  await pool.query("delete from milestone_cheers where post_id = $1 and user_id = $2", [id, userId]);
}

// ---------- routes ----------

const json = <T extends z.ZodType>(schema: T) => ({ content: { "application/json": { schema } } });
const MilestoneParam = z.object({ milestoneId: z.uuid() });

export const milestoneRoutes = new OpenAPIHono<AppEnv>();
milestoneRoutes.use("/v1/milestones", rateLimit("milestones", 120, 60));
milestoneRoutes.use("/v1/milestones/*", rateLimit("milestones", 120, 60));

milestoneRoutes.openapi(
  createRoute({
    method: "get", path: "/v1/milestones", tags: ["milestones"], summary: "My shared milestones with their cheers, and others' recent milestones to cheer",
    description: `Others' milestones from the last ${FEED_WINDOW_DAYS} days, least cheered first, without who shared them or how many cheers they have. Only I see my own counts.`,
    responses: { 200: { description: "Milestones", ...json(MilestonesSchema) }, ...ErrorResponses },
  }),
  async (c) => {
    requireMilestones();
    c.header("Cache-Control", "no-store");
    return c.json(await milestones(requireUser(c).id), 200);
  },
);

milestoneRoutes.openapi(
  createRoute({
    method: "post", path: "/v1/milestones", tags: ["milestones"], summary: "Share a milestone with everyone signed in",
    description:
      "One of a fixed list of kinds, for this week or last week; one per kind per week (sharing it again returns the one already shared). " +
      "Everyone signed in sees only the kind and, for new_plant, the food's name. Never my name, email, meals, goals or amounts.",
    request: { body: { required: true, ...json(MilestoneShareSchema) } },
    responses: { 201: { description: "Shared", ...json(MyMilestoneSchema) }, ...ErrorResponses },
  }),
  async (c) => {
    requireMilestones();
    const { kind, week, foodId } = c.req.valid("json");
    return c.json(await shareMilestone(requireUser(c).id, kind, week, foodId), 201);
  },
);

milestoneRoutes.openapi(
  createRoute({
    method: "delete", path: "/v1/milestones/{milestoneId}", tags: ["milestones"], summary: "Stop sharing a milestone; it and its cheers are deleted",
    request: { params: MilestoneParam },
    responses: { 204: { description: "Not shared any more (also when it was not shared)" }, ...ErrorResponses },
  }),
  async (c) => {
    requireMilestones();
    await unshareMilestone(requireUser(c).id, c.req.valid("param").milestoneId);
    return c.body(null, 204);
  },
);

milestoneRoutes.openapi(
  createRoute({
    method: "put", path: "/v1/milestones/{milestoneId}/cheer", tags: ["milestones"], summary: "Cheer someone's milestone with a preset reaction",
    description: "One cheer per person per milestone; cheering again replaces it. Not on my own milestones. Anonymous.",
    request: { params: MilestoneParam, body: { required: true, ...json(CheerBodySchema) } },
    responses: { 204: { description: "Cheered" }, ...ErrorResponses },
  }),
  async (c) => {
    requireMilestones();
    await cheer(requireUser(c).id, c.req.valid("param").milestoneId, c.req.valid("json").cheer);
    return c.body(null, 204);
  },
);

milestoneRoutes.openapi(
  createRoute({
    method: "delete", path: "/v1/milestones/{milestoneId}/cheer", tags: ["milestones"], summary: "Take back my cheer",
    request: { params: MilestoneParam },
    responses: { 204: { description: "No cheer from me any more" }, ...ErrorResponses },
  }),
  async (c) => {
    requireMilestones();
    await uncheer(requireUser(c).id, c.req.valid("param").milestoneId);
    return c.body(null, 204);
  },
);
