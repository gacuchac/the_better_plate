import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import type pg from "pg";
import { GoalSchema, LocalDateSchema, MAX_GOALS, NutritionSummarySchema, type Goal, type GoalBody } from "@betterplate/contracts";
import { dayCount, goalProblem, goalProgress, shiftDate, summarizePeriod, sumMeals, type DayIntake } from "@betterplate/nutrition";
import { pool } from "../db/pool.ts";
import { ApiError, type AppEnv, rateLimit, requireUser } from "../lib/http.ts";
import { currentCatalog } from "./catalog.ts";
import { ErrorResponses } from "./common.ts";
import { LOG_COLUMNS, toLog } from "./meals.ts";
import { lockUser } from "./recipes.ts";

// ---------- service ----------

// Dates as text so a server time zone can never shift someone's calendar day.
export const GOAL_COLUMNS = `id, user_id, nutrient_key, unit, kind, min_amount, max_amount, period, to_char(start_date, 'YYYY-MM-DD') as start_date,
  to_char(end_date, 'YYYY-MM-DD') as end_date, version, server_seq, created_at, updated_at, deleted_at`;

type GoalRow = {
  id: string; user_id: string; nutrient_key: string; unit: string; kind: GoalBody["kind"]; min_amount: string | null; max_amount: string | null;
  period: GoalBody["period"]; start_date: string; end_date: string | null; version: number; server_seq: string;
  created_at: Date; updated_at: Date; deleted_at: Date | null;
};

export function toGoal(r: GoalRow): Goal {
  return {
    id: r.id, nutrientKey: r.nutrient_key, unit: r.unit, kind: r.kind,
    min: r.min_amount === null ? null : Number(r.min_amount), max: r.max_amount === null ? null : Number(r.max_amount),
    period: r.period, startDate: r.start_date, endDate: r.end_date,
    version: r.version, createdAt: r.created_at.toISOString(), updatedAt: r.updated_at.toISOString(),
  };
}

export type GoalOutcome =
  | { status: "applied"; version: number }
  | { status: "conflict"; server: Goal | null }
  | { status: "rejected"; code: string; message: string };

const notFound = { status: "rejected" as const, code: "not_found", message: "Not found" };

/** The goal's own numbers and dates must fit, and the nutrient must exist in the catalog in that unit. */
export async function checkGoal(body: GoalBody): Promise<string | null> {
  const problem = goalProblem(body);
  if (problem) return problem;
  const def = (await currentCatalog()).nutrients.find((n) => n.key === body.nutrientKey);
  if (!def) return `Unknown nutrient ${body.nutrientKey}`;
  if (def.unit !== body.unit) return `${def.name} is measured in ${def.unit}`;
  return null;
}

export async function putGoal(client: pg.PoolClient, userId: string, id: string, baseVersion: number | null, body: GoalBody): Promise<GoalOutcome> {
  const problem = await checkGoal(body);
  if (problem) return { status: "rejected", code: "invalid_goal", message: problem };
  await lockUser(client, userId);
  const row = (await client.query<GoalRow>(`select ${GOAL_COLUMNS} from goals where id = $1 for update`, [id])).rows[0];
  if (row && row.user_id !== userId) return notFound;
  if (!row && baseVersion !== null) return { status: "conflict", server: null };
  if (row && row.deleted_at) return { status: "conflict", server: null };
  if (row && baseVersion !== row.version) return { status: "conflict", server: toGoal(row) };
  if (!row) {
    const { rows } = await client.query<{ n: string }>("select count(*) as n from goals where user_id = $1 and deleted_at is null", [userId]);
    if (Number(rows[0]!.n) >= MAX_GOALS) return { status: "rejected", code: "goal_limit", message: `You can have up to ${MAX_GOALS} goals; remove one first` };
  }
  const version = row ? row.version + 1 : 1;
  await client.query(
    row
      ? `update goals set nutrient_key = $3, unit = $4, kind = $5, min_amount = $6, max_amount = $7, period = $8, start_date = $9, end_date = $10,
           version = $11, server_seq = nextval('change_seq'), updated_at = now() where id = $1 and user_id = $2`
      : `insert into goals (id, user_id, nutrient_key, unit, kind, min_amount, max_amount, period, start_date, end_date, version, server_seq)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, nextval('change_seq'))`,
    [id, userId, body.nutrientKey, body.unit, body.kind, body.min, body.max, body.period, body.startDate, body.endDate, version],
  );
  return { status: "applied", version };
}

export async function deleteGoal(client: pg.PoolClient, userId: string, id: string, baseVersion: number | null): Promise<GoalOutcome> {
  await lockUser(client, userId);
  const row = (await client.query<GoalRow>(`select ${GOAL_COLUMNS} from goals where id = $1 for update`, [id])).rows[0];
  if (row && row.user_id !== userId) return notFound;
  if (!row) return { status: "applied", version: 0 };
  if (row.deleted_at) return { status: "applied", version: row.version };
  if (baseVersion !== row.version) return { status: "conflict", server: toGoal(row) };
  const version = row.version + 1;
  await client.query(`update goals set version = $2, server_seq = nextval('change_seq'), updated_at = now(), deleted_at = now() where id = $1`, [id, version]);
  return { status: "applied", version };
}

export async function listGoals(userId: string): Promise<Goal[]> {
  const { rows } = await pool.query<GoalRow>(`select ${GOAL_COLUMNS} from goals where user_id = $1 and deleted_at is null order by created_at`, [userId]);
  return rows.map(toGoal);
}

/** Totals of what was eaten on each day with logged meals between two dates. */
export async function intakeBetween(userId: string, from: string, to: string): Promise<DayIntake[]> {
  const { rows } = await pool.query(
    `select ${LOG_COLUMNS} from consumption_events where user_id = $1 and deleted_at is null and local_date between $2 and $3 order by local_date`,
    [userId, from, to],
  );
  const byDate = new Map<string, ReturnType<typeof toLog>[]>();
  for (const r of rows) {
    const log = toLog(r as never);
    byDate.set(log.localDate, [...(byDate.get(log.localDate) ?? []), log]);
  }
  return [...byDate].map(([date, logs]) => ({ date, totals: sumMeals(logs.map((l) => l.eaten)) }));
}

export const MAX_SUMMARY_DAYS = 366;

export async function nutritionSummary(userId: string, from: string, to: string) {
  const days = dayCount(from, to);
  if (days < 1 || days > MAX_SUMMARY_DAYS) throw new ApiError(400, "invalid_range", `Use a range of 1 to ${MAX_SUMMARY_DAYS} days with from ≤ to`);
  return summarizePeriod(await intakeBetween(userId, from, to), from, to);
}

/** Each goal with its progress as of a day, for assistants; loads at most about a year of meals. */
export async function goalsWithProgress(userId: string, asOf: string) {
  const goals = await listGoals(userId);
  if (!goals.length) return [];
  const earliest = goals.reduce((m, g) => (g.startDate < m ? g.startDate : m), asOf);
  const from = earliest < shiftDate(asOf, -400) ? shiftDate(asOf, -400) : earliest;
  const intake = await intakeBetween(userId, from, goals.reduce((m, g) => (g.endDate && g.endDate > m ? g.endDate : m), asOf));
  return goals.map((goal) => ({ goal, progress: goalProgress(goal, intake, asOf) }));
}

// ---------- routes ----------

export const goalRoutes = new OpenAPIHono<AppEnv>();
goalRoutes.use("/v1/goals", rateLimit("goals", 120, 60));
goalRoutes.use("/v1/nutrition/summary", rateLimit("nutrition summary", 120, 60));

goalRoutes.openapi(
  createRoute({
    method: "get", path: "/v1/goals", tags: ["goals"],
    summary: "My consumption goals",
    description: "Goals the person set on what they eat. Writes go through POST /v1/sync/batch (goal.put, goal.delete).",
    responses: { 200: { description: "Goals", content: { "application/json": { schema: z.object({ goals: z.array(GoalSchema) }) } } }, ...ErrorResponses },
  }),
  async (c) => c.json({ goals: await listGoals(requireUser(c).id) }, 200),
);

goalRoutes.openapi(
  createRoute({
    method: "get", path: "/v1/nutrition/summary", tags: ["goals"],
    summary: "Estimated totals of what I ate over a range of days (at most 366)",
    description:
      "Logged meals only; plans never count. Averages are per day with something logged, and `incomplete` says when some days have nothing logged. " +
      "Nutrients no logged meal reports are unknown, never zero.",
    request: { query: z.object({ from: LocalDateSchema, to: LocalDateSchema }) },
    responses: { 200: { description: "Summary", content: { "application/json": { schema: NutritionSummarySchema } } }, ...ErrorResponses },
  }),
  async (c) => {
    const { from, to } = c.req.valid("query");
    return c.json(await nutritionSummary(requireUser(c).id, from, to), 200);
  },
);
