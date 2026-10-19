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
  type RecipeNutritionDto,
} from "@betterplate/contracts";
import { scaleTotals } from "@betterplate/nutrition";
import { pool } from "../db/pool.ts";
import { ApiError, type AppEnv, rateLimit, requireUser } from "../lib/http.ts";
import { ErrorResponses } from "./common.ts";
import { computeNutrition, lockUser } from "./recipes.ts";

// ---------- service ----------

// Dates are read as text so a server time zone can never shift someone's calendar day.
export const PLAN_COLUMNS = `id, user_id, to_char(local_date, 'YYYY-MM-DD') as local_date, slot, recipe_id, title, servings, version, server_seq, created_at, updated_at, deleted_at`;
export const LOG_COLUMNS = `id, user_id, planned_meal_id, recipe_id, recipe, servings, slot, to_char(local_date, 'YYYY-MM-DD') as local_date, eaten_at, nutrition, catalog_version, server_seq, created_at, deleted_at`;

type PlanRow = {
  id: string; user_id: string; local_date: string; slot: PlannedMealBody["slot"]; recipe_id: string; title: string; servings: string;
  version: number; server_seq: string; created_at: Date; updated_at: Date; deleted_at: Date | null;
};
type LogRow = {
  id: string; user_id: string; planned_meal_id: string | null; recipe_id: string | null; recipe: MealLogBody["recipe"]; servings: string;
  slot: MealLogBody["slot"]; local_date: string; eaten_at: Date; nutrition: RecipeNutritionDto; catalog_version: string;
  server_seq: string; created_at: Date; deleted_at: Date | null;
};

export function toPlan(r: PlanRow): PlannedMeal {
  return {
    id: r.id, date: r.local_date, slot: r.slot, recipeId: r.recipe_id, title: r.title, servings: Number(r.servings),
    version: r.version, createdAt: r.created_at.toISOString(), updatedAt: r.updated_at.toISOString(),
  };
}

export function toLog(r: LogRow): MealLog {
  const servings = Number(r.servings);
  return {
    id: r.id, plannedMealId: r.planned_meal_id, recipeId: r.recipe_id, recipe: r.recipe, servings, slot: r.slot,
    localDate: r.local_date, eatenAt: r.eaten_at.toISOString(), createdAt: r.created_at.toISOString(),
    nutrition: r.nutrition, eaten: scaleTotals(r.nutrition.perServing, servings),
  };
}

export type PlanOutcome =
  | { status: "applied"; version: number }
  | { status: "conflict"; server: PlannedMeal | null }
  | { status: "rejected"; code: string; message: string };

const notFound = { status: "rejected" as const, code: "not_found", message: "Not found" };

export async function putPlan(client: pg.PoolClient, userId: string, id: string, baseVersion: number | null, body: PlannedMealBody): Promise<PlanOutcome> {
  await lockUser(client, userId);
  const row = (await client.query<PlanRow>(`select ${PLAN_COLUMNS} from planned_meals where id = $1 for update`, [id])).rows[0];
  if (row && row.user_id !== userId) return notFound;
  if (!row && baseVersion !== null) return { status: "conflict", server: null };
  if (row && row.deleted_at) return { status: "conflict", server: null };
  if (row && baseVersion !== row.version) return { status: "conflict", server: toPlan(row) };
  const version = row ? row.version + 1 : 1;
  await client.query(
    row
      ? `update planned_meals set local_date = $3, slot = $4, recipe_id = $5, title = $6, servings = $7, version = $8, server_seq = nextval('change_seq'), updated_at = now() where id = $1 and user_id = $2`
      : `insert into planned_meals (id, user_id, local_date, slot, recipe_id, title, servings, version, server_seq) values ($1, $2, $3, $4, $5, $6, $7, $8, nextval('change_seq'))`,
    [id, userId, body.date, body.slot, body.recipeId, body.title, body.servings, version],
  );
  return { status: "applied", version };
}

export async function deletePlan(client: pg.PoolClient, userId: string, id: string, baseVersion: number | null): Promise<PlanOutcome> {
  await lockUser(client, userId);
  const row = (await client.query<PlanRow>(`select ${PLAN_COLUMNS} from planned_meals where id = $1 for update`, [id])).rows[0];
  if (row && row.user_id !== userId) return notFound;
  if (!row) return { status: "applied", version: 0 };
  if (row.deleted_at) return { status: "applied", version: row.version };
  if (baseVersion !== row.version) return { status: "conflict", server: toPlan(row) };
  const version = row.version + 1;
  await client.query(
    `update planned_meals set title = '', recipe_id = null, version = $2, server_seq = nextval('change_seq'), updated_at = now(), deleted_at = now() where id = $1`,
    [id, version],
  );
  return { status: "applied", version };
}

export type LogOutcome = { status: "applied" } | { status: "rejected"; code: string; message: string };

/**
 * Records food eaten exactly once per id. Nutrition is recomputed here from catalog records and
 * frozen with the catalog version, so later catalog or recipe edits never rewrite history.
 */
export async function createLog(client: pg.PoolClient, userId: string, id: string, body: MealLogBody): Promise<LogOutcome> {
  await lockUser(client, userId);
  const existing = (await client.query<{ user_id: string }>("select user_id from consumption_events where id = $1", [id])).rows[0];
  if (existing) return existing.user_id === userId ? { status: "applied" } : notFound;
  const calc = await computeNutrition(body.recipe);
  if (!calc.ok) return { status: "rejected", code: "unknown_food", message: `Foods not in catalog: ${calc.unknown.join(", ")}` };
  await client.query(
    `insert into consumption_events (id, user_id, planned_meal_id, recipe_id, recipe, servings, slot, local_date, eaten_at, nutrition, catalog_version, server_seq)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, nextval('change_seq'))`,
    [id, userId, body.plannedMealId, body.recipeId, JSON.stringify(body.recipe), body.servings, body.slot, body.localDate, body.eatenAt, JSON.stringify(calc.nutrition), calc.nutrition.catalogVersion],
  );
  return { status: "applied" };
}

/** Retracts a log ("I didn't eat this"): content is cleared, a tombstone stays for sync. */
export async function deleteLog(client: pg.PoolClient, userId: string, id: string): Promise<LogOutcome> {
  await lockUser(client, userId);
  const row = (await client.query<{ user_id: string; deleted_at: Date | null }>("select user_id, deleted_at from consumption_events where id = $1 for update", [id])).rows[0];
  if (row && row.user_id !== userId) return notFound;
  if (!row || row.deleted_at) return { status: "applied" };
  await client.query(
    `update consumption_events set recipe = '{}'::jsonb, nutrition = '{}'::jsonb, planned_meal_id = null, recipe_id = null, server_seq = nextval('change_seq'), deleted_at = now() where id = $1`,
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
    summary: "My planned and eaten meals for a date range (at most 31 days)",
    description:
      "Plans and logs are returned separately and must never be added together. Each log carries its own " +
      "immutable nutrition snapshot; `eaten` is per-serving nutrition × servings eaten. Writes go through POST /v1/sync/batch.",
    request: { query: z.object({ from: LocalDateSchema, to: LocalDateSchema }) },
    responses: { 200: { description: "Meals", content: { "application/json": { schema: MealsResponseSchema } } }, ...ErrorResponses },
  }),
  async (c) => {
    const user = requireUser(c);
    const { from, to } = c.req.valid("query");
    const days = (Date.parse(to) - Date.parse(from)) / 86_400_000;
    if (!(days >= 0 && days <= 30)) throw new ApiError(400, "invalid_range", "Use a range of 1 to 31 days with from ≤ to");
    const [plans, logs] = await Promise.all([
      pool.query<PlanRow>(`select ${PLAN_COLUMNS} from planned_meals where user_id = $1 and deleted_at is null and local_date between $2 and $3 order by local_date, slot`, [user.id, from, to]),
      pool.query<LogRow>(`select ${LOG_COLUMNS} from consumption_events where user_id = $1 and deleted_at is null and local_date between $2 and $3 order by local_date, eaten_at`, [user.id, from, to]),
    ]);
    return c.json({ from, to, planned: plans.rows.map(toPlan), eaten: logs.rows.map(toLog) }, 200);
  },
);
