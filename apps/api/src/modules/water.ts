import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import type pg from "pg";
import { LocalDateSchema, WaterLogSchema, type WaterLog, type WaterLogBody } from "@betterplate/contracts";
import { pool } from "../db/pool.ts";
import { ApiError, type AppEnv, rateLimit, requireUser } from "../lib/http.ts";
import { ErrorResponses } from "./common.ts";
import { lockUser } from "./recipes.ts";

// ---------- service ----------

// Dates as text so a server time zone can never shift someone's calendar day.
export const WATER_COLUMNS = `id, user_id, amount_ml, to_char(local_date, 'YYYY-MM-DD') as local_date, drank_at, server_seq, created_at, deleted_at`;

type WaterRow = { id: string; user_id: string; amount_ml: number; local_date: string; drank_at: Date; server_seq: string; created_at: Date; deleted_at: Date | null };

export function toWater(r: WaterRow): WaterLog {
  return { id: r.id, amountMl: r.amount_ml, localDate: r.local_date, drankAt: r.drank_at.toISOString(), createdAt: r.created_at.toISOString() };
}

export type WaterOutcome = { status: "applied" } | { status: "rejected"; code: string; message: string };

const notFound = { status: "rejected" as const, code: "not_found", message: "Not found" };

/** Records one drink. Replaying the same id is a no-op; drinks are never edited. */
export async function createWater(client: pg.PoolClient, userId: string, id: string, body: WaterLogBody): Promise<WaterOutcome> {
  await lockUser(client, userId);
  const existing = (await client.query<{ user_id: string }>("select user_id from water_logs where id = $1", [id])).rows[0];
  if (existing) return existing.user_id === userId ? { status: "applied" } : notFound;
  await client.query(
    `insert into water_logs (id, user_id, amount_ml, local_date, drank_at, server_seq) values ($1, $2, $3, $4, $5, nextval('change_seq'))`,
    [id, userId, body.amountMl, body.localDate, body.drankAt],
  );
  return { status: "applied" };
}

/** Removes a drink; a tombstone stays for sync. */
export async function deleteWater(client: pg.PoolClient, userId: string, id: string): Promise<WaterOutcome> {
  await lockUser(client, userId);
  const row = (await client.query<{ user_id: string; deleted_at: Date | null }>("select user_id, deleted_at from water_logs where id = $1 for update", [id])).rows[0];
  if (row && row.user_id !== userId) return notFound;
  if (!row || row.deleted_at) return { status: "applied" };
  await client.query("update water_logs set server_seq = nextval('change_seq'), deleted_at = now() where id = $1", [id]);
  return { status: "applied" };
}

export async function listWater(userId: string, from: string, to: string): Promise<WaterLog[]> {
  const { rows } = await pool.query<WaterRow>(
    `select ${WATER_COLUMNS} from water_logs where user_id = $1 and deleted_at is null and local_date between $2 and $3 order by local_date, drank_at`,
    [userId, from, to],
  );
  return rows.map(toWater);
}

// ---------- routes ----------

export const waterRoutes = new OpenAPIHono<AppEnv>();
waterRoutes.use("/v1/water", rateLimit("water", 300, 60));

waterRoutes.openapi(
  createRoute({
    method: "get", path: "/v1/water", tags: ["water"],
    summary: "Water I logged drinking over a date range (at most 31 days)",
    description: "Drinks only; water inside foods comes with each eaten meal's nutrition. Writes go through POST /v1/sync/batch (water.create, water.delete).",
    request: { query: z.object({ from: LocalDateSchema, to: LocalDateSchema }) },
    responses: {
      200: { description: "Drinks", content: { "application/json": { schema: z.object({ from: LocalDateSchema, to: LocalDateSchema, drinks: z.array(WaterLogSchema) }) } } },
      ...ErrorResponses,
    },
  }),
  async (c) => {
    const { from, to } = c.req.valid("query");
    const days = (Date.parse(to) - Date.parse(from)) / 86_400_000;
    if (!(days >= 0 && days <= 30)) throw new ApiError(400, "invalid_range", "Use a range of 1 to 31 days with from ≤ to");
    return c.json({ from, to, drinks: await listWater(requireUser(c).id, from, to) }, 200);
  },
);
