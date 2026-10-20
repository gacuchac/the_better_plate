import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import type pg from "pg";
import {
  LocalDateSchema,
  MealLogSchema,
  PlannedMealSchema,
  type MealLog,
  type MealLogBody,
  type PlannedMeal,
  type PlannedMealBody,
  type PlanStatus,
  type RecipeNutritionDto,
} from "@betterplate/contracts";
import { scaleTotals } from "@betterplate/nutrition";
import { pool } from "../db/pool.ts";
import { ApiError, type AppEnv, rateLimit, requireUser } from "../lib/http.ts";
import { ErrorResponses } from "./common.ts";
import { computeNutrition, lockUser } from "./recipes.ts";
import { isAdminRole, isManagedPerson, profileOwner, roleIn } from "./access.ts";

// ---------- service ----------

// Dates are read as text so a server time zone can never shift someone's calendar day.
// planned_by: the name the last planner uses in the group that planned it (never an email).
export const PLAN_COLUMNS = `id, user_id, to_char(local_date, 'YYYY-MM-DD') as local_date, slot, recipe_id, title, servings, version, server_seq, created_at, updated_at, deleted_at,
  profile_id, group_id, author_user_id, status,
  (select gm.display_name from group_members gm where gm.group_id = planned_meals.group_id and gm.user_id = planned_meals.author_user_id) as planned_by`;
export const LOG_COLUMNS = `id, user_id, planned_meal_id, recipe_id, recipe, servings, slot, to_char(local_date, 'YYYY-MM-DD') as local_date, eaten_at, nutrition, catalog_version, server_seq, created_at, deleted_at, profile_id`;

export type PlanRow = {
  id: string; user_id: string; local_date: string; slot: PlannedMealBody["slot"]; recipe_id: string; title: string; servings: string;
  version: number; server_seq: string; created_at: Date; updated_at: Date; deleted_at: Date | null;
  profile_id: string | null; group_id: string | null; author_user_id: string | null; status: PlanStatus; planned_by: string | null;
};
export type LogRow = {
  id: string; user_id: string; planned_meal_id: string | null; recipe_id: string | null; recipe: MealLogBody["recipe"]; servings: string;
  slot: MealLogBody["slot"]; local_date: string; eaten_at: Date; nutrition: RecipeNutritionDto; catalog_version: string;
  server_seq: string; created_at: Date; deleted_at: Date | null; profile_id: string | null;
};

export function toPlan(r: PlanRow): PlannedMeal {
  return {
    id: r.id, date: r.local_date, slot: r.slot, recipeId: r.recipe_id, title: r.title, servings: Number(r.servings), profileId: r.profile_id,
    version: r.version, createdAt: r.created_at.toISOString(), updatedAt: r.updated_at.toISOString(),
    status: r.status, groupId: r.group_id, authorId: r.author_user_id, plannedBy: r.group_id ? r.planned_by : null,
  };
}

export function toLog(r: LogRow): MealLog {
  const servings = Number(r.servings);
  return {
    id: r.id, plannedMealId: r.planned_meal_id, recipeId: r.recipe_id, recipe: r.recipe, servings, slot: r.slot,
    localDate: r.local_date, eatenAt: r.eaten_at.toISOString(), createdAt: r.created_at.toISOString(), profileId: r.profile_id,
    nutrition: r.nutrition, eaten: scaleTotals(r.nutrition.perServing, servings),
  };
}

export type PlanOutcome =
  | { status: "applied"; version: number }
  | { status: "conflict"; server: PlannedMeal | null }
  | { status: "rejected"; code: string; message: string };

const notFound = { status: "rejected" as const, code: "not_found", message: "Not found" };
const managed = {
  status: "rejected" as const,
  code: "managed_by_group",
  message: "Your group planned this meal; ask one of its admins to change it",
};

/** Who writes a plan, into whose kitchen, for which person, on behalf of which group. */
export interface PlanWriter {
  /** The account writing (author). */
  actorId: string;
  /** The account whose kitchen (sync feed) holds the plan: the person, or a profile's owner. */
  feedOwner: string;
  /** The profile the meal is for, or null for the feed owner themselves. */
  profileId: string | null;
  /** Set when an admin plans through a group; null for a person's own plans. */
  groupId: string | null;
}

export async function loadPlanForWrite(client: pg.PoolClient, id: string) {
  return (await client.query<PlanRow>(`select ${PLAN_COLUMNS} from planned_meals where id = $1 for update`, [id])).rows[0];
}

/** A plan an admin made through a group, that a plain member of that group may not change. */
async function managedFor(client: pg.PoolClient, row: PlanRow, userId: string) {
  if (!row.group_id || row.profile_id || row.author_user_id === userId) return false;
  return (await roleIn(client, row.group_id, userId)) === "member";
}

/**
 * Writes a plan whose row (if any) is already locked and checked. Status: a plan a managed person
 * makes for themselves waits for approval; anything an admin writes is on the plan.
 */
export async function writePlan(client: pg.PoolClient, w: PlanWriter, id: string, row: PlanRow | undefined, body: PlannedMealBody, status: PlanStatus): Promise<number> {
  const version = row ? row.version + 1 : 1;
  await client.query(
    row
      ? `update planned_meals set local_date = $3, slot = $4, recipe_id = $5, title = $6, servings = $7, version = $8, profile_id = $9, group_id = $10,
           author_user_id = $11, status = $12, server_seq = nextval('change_seq'), updated_at = now() where id = $1 and user_id = $2`
      : `insert into planned_meals (id, user_id, local_date, slot, recipe_id, title, servings, version, profile_id, group_id, author_user_id, status, server_seq)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, nextval('change_seq'))`,
    [id, w.feedOwner, body.date, body.slot, body.recipeId, body.title, body.servings, version, w.profileId, w.groupId, w.actorId, status],
  );
  return version;
}

/** A person's own write (app sync, connector): for themselves or for a profile they own. */
export async function putPlan(client: pg.PoolClient, userId: string, id: string, baseVersion: number | null, body: PlannedMealBody): Promise<PlanOutcome> {
  const profileId = body.profileId ?? null;
  if (profileId && (await profileOwner(client, profileId)) !== userId) return { status: "rejected", code: "not_found", message: "Profile not found" };
  await lockUser(client, userId);
  const row = await loadPlanForWrite(client, id);
  if (row && row.user_id !== userId) return notFound;
  if (!row && baseVersion !== null) return { status: "conflict", server: null };
  if (row && row.deleted_at) return { status: "conflict", server: null };
  if (row && baseVersion !== row.version) return { status: "conflict", server: toPlan(row) };
  if (row && row.profile_id !== profileId) return { status: "rejected", code: "invalid_plan", message: "A plan cannot move to another person; plan a new meal instead" };
  if (row && (await managedFor(client, row, userId))) return managed;
  // An admin of the planning group keeps it a group plan when editing it from their own kitchen.
  const groupId = row?.group_id && isAdminRole(await roleIn(client, row.group_id, userId)) ? row.group_id : null;
  const status: PlanStatus = profileId === null && !groupId && (await isManagedPerson(client, userId)) ? "proposed" : "planned";
  return { status: "applied", version: await writePlan(client, { actorId: userId, feedOwner: userId, profileId, groupId }, id, row, body, status) };
}

export async function deletePlan(client: pg.PoolClient, userId: string, id: string, baseVersion: number | null): Promise<PlanOutcome> {
  await lockUser(client, userId);
  const row = await loadPlanForWrite(client, id);
  if (row && row.user_id !== userId) return notFound;
  if (!row) return { status: "applied", version: 0 };
  if (row.deleted_at) return { status: "applied", version: row.version };
  if (baseVersion !== row.version) return { status: "conflict", server: toPlan(row) };
  if (await managedFor(client, row, userId)) return managed;
  return { status: "applied", version: await tombstonePlan(client, row) };
}

export async function tombstonePlan(client: pg.PoolClient, row: PlanRow): Promise<number> {
  const version = row.version + 1;
  await client.query(
    `update planned_meals set title = '', recipe_id = null, version = $2, server_seq = nextval('change_seq'), updated_at = now(), deleted_at = now() where id = $1`,
    [row.id, version],
  );
  return version;
}

export type LogOutcome = { status: "applied" } | { status: "rejected"; code: string; message: string };

/**
 * Records food eaten exactly once per id. Nutrition is recomputed here from catalog records and
 * frozen with the catalog version, so later catalog or recipe edits never rewrite history.
 */
export async function createLog(client: pg.PoolClient, userId: string, id: string, body: MealLogBody): Promise<LogOutcome> {
  const profileId = body.profileId ?? null;
  if (profileId && (await profileOwner(client, profileId)) !== userId) return { status: "rejected", code: "not_found", message: "Profile not found" };
  await lockUser(client, userId);
  const existing = (await client.query<{ user_id: string }>("select user_id from consumption_events where id = $1", [id])).rows[0];
  if (existing) return existing.user_id === userId ? { status: "applied" } : notFound;
  const calc = await computeNutrition(body.recipe);
  if (!calc.ok) return { status: "rejected", code: "unknown_food", message: `Foods not in catalog: ${calc.unknown.join(", ")}` };
  await client.query(
    `insert into consumption_events (id, user_id, planned_meal_id, recipe_id, recipe, servings, slot, local_date, eaten_at, nutrition, catalog_version, profile_id, server_seq)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, nextval('change_seq'))`,
    [id, userId, body.plannedMealId, body.recipeId, JSON.stringify(body.recipe), body.servings, body.slot, body.localDate, body.eatenAt, JSON.stringify(calc.nutrition), calc.nutrition.catalogVersion, profileId],
  );
  return { status: "applied" };
}

/** Retracts a log ("I didn't eat this"): content is cleared, a tombstone stays for sync; its feedback goes with it. */
export async function deleteLog(client: pg.PoolClient, userId: string, id: string): Promise<LogOutcome> {
  await lockUser(client, userId);
  const row = (await client.query<{ user_id: string; deleted_at: Date | null }>("select user_id, deleted_at from consumption_events where id = $1 for update", [id])).rows[0];
  if (row && row.user_id !== userId) return notFound;
  if (!row || row.deleted_at) return { status: "applied" };
  await client.query(
    `update consumption_events set recipe = '{}'::jsonb, nutrition = '{}'::jsonb, planned_meal_id = null, recipe_id = null, server_seq = nextval('change_seq'), deleted_at = now() where id = $1`,
    [id],
  );
  await client.query(
    `update meal_feedback set rating = null, comment = '', disliked_food_ids = '[]'::jsonb, version = version + 1, server_seq = nextval('change_seq'), updated_at = now(), deleted_at = now()
      where id = $1 and deleted_at is null`,
    [id],
  );
  return { status: "applied" };
}

// ---------- routes ----------

const MealsResponseSchema = z.object({
  from: LocalDateSchema,
  to: LocalDateSchema,
  planned: z.array(PlannedMealSchema),
  eaten: z.array(MealLogSchema),
});

export const mealRoutes = new OpenAPIHono<AppEnv>();
mealRoutes.use("/v1/meals", rateLimit("meals", 300, 60));

mealRoutes.openapi(
  createRoute({
    method: "get", path: "/v1/meals", tags: ["meals"],
    summary: "My planned and eaten meals for a date range (at most 31 days), or one of my profiles'",
    description:
      "Plans and logs are returned separately and must never be added together. Each log carries its own " +
      "immutable nutrition snapshot; `eaten` is per-serving nutrition × servings eaten. Writes go through POST /v1/sync/batch.",
    request: { query: z.object({ from: LocalDateSchema, to: LocalDateSchema, profileId: z.uuid().optional() }) },
    responses: { 200: { description: "Meals", content: { "application/json": { schema: MealsResponseSchema } } }, ...ErrorResponses },
  }),
  async (c) => {
    const user = requireUser(c);
    const { from, to, profileId = null } = c.req.valid("query");
    const days = (Date.parse(to) - Date.parse(from)) / 86_400_000;
    if (!(days >= 0 && days <= 30)) throw new ApiError(400, "invalid_range", "Use a range of 1 to 31 days with from ≤ to");
    if (profileId && (await profileOwner(pool, profileId)) !== user.id) throw new ApiError(404, "not_found", "Profile not found");
    const [plans, logs] = await Promise.all([
      pool.query<PlanRow>(
        `select ${PLAN_COLUMNS} from planned_meals where user_id = $1 and profile_id is not distinct from $4 and deleted_at is null and local_date between $2 and $3 order by local_date, slot`,
        [user.id, from, to, profileId],
      ),
      pool.query<LogRow>(
        `select ${LOG_COLUMNS} from consumption_events where user_id = $1 and profile_id is not distinct from $4 and deleted_at is null and local_date between $2 and $3 order by local_date, eaten_at`,
        [user.id, from, to, profileId],
      ),
    ]);
    return c.json({ from, to, planned: plans.rows.map(toPlan), eaten: logs.rows.map(toLog) }, 200);
  },
);
