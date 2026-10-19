import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import {
  SyncBatchRequestSchema,
  SyncBatchResponseSchema,
  SyncChangesResponseSchema,
  type SyncOperation,
  type SyncResult,
} from "@betterplate/contracts";
import { pool, withTransaction } from "../db/pool.ts";
import { type AppEnv, rateLimit, requireUser } from "../lib/http.ts";
import { ErrorResponses } from "./common.ts";
import { deleteRecipe, putRecipe, toRecipe, type WriteOutcome } from "./recipes.ts";

/**
 * Applies one client operation exactly once. The (user, opId) row is inserted first in the
 * same transaction as the write, so a retried or concurrent duplicate waits, then gets the
 * stored result back with replayed=true instead of applying twice.
 */
async function applyOperation(userId: string, op: SyncOperation): Promise<SyncResult> {
  return withTransaction(async (client) => {
    const claim = await client.query(
      `insert into sync_operations (user_id, op_id, op_type, entity_id) values ($1, $2, $3, $4)
       on conflict (user_id, op_id) do nothing returning op_id`,
      [userId, op.opId, op.type, op.entityId],
    );
    if (claim.rowCount === 0) {
      const { rows } = await client.query<{ result: SyncResult }>(
        "select result from sync_operations where user_id = $1 and op_id = $2",
        [userId, op.opId],
      );
      return { ...rows[0]!.result, replayed: true };
    }

    let outcome: WriteOutcome;
    try {
      outcome =
        op.type === "recipe.put"
          ? await putRecipe(client, userId, op.entityId, op.baseVersion, op.body)
          : await deleteRecipe(client, userId, op.entityId, op.baseVersion);
    } catch (err) {
      console.error(JSON.stringify({ level: "error", msg: "sync operation failed", opId: op.opId, type: op.type, error: (err as Error).message }));
      throw err;
    }

    const result: SyncResult =
      outcome.status === "applied"
        ? { opId: op.opId, entityId: op.entityId, status: "applied", replayed: false, version: outcome.version }
        : outcome.status === "conflict"
          ? { opId: op.opId, entityId: op.entityId, status: "conflict", replayed: false, version: outcome.server?.version ?? null, server: outcome.server }
          : { opId: op.opId, entityId: op.entityId, status: "rejected", replayed: false, version: null, error: { code: outcome.code, message: outcome.message } };

    // Every answer is stored, conflicts included: replaying an opId returns the same answer,
    // and a resolved conflict is sent as a new operation with a new opId.
    await client.query("update sync_operations set result = $3 where user_id = $1 and op_id = $2", [userId, op.opId, JSON.stringify(result)]);
    return result;
  });
}

export const syncRoutes = new OpenAPIHono<AppEnv>();
syncRoutes.use("/v1/sync/*", rateLimit("sync", 120, 60));

syncRoutes.openapi(
  createRoute({
    method: "post",
    path: "/v1/sync/batch",
    tags: ["sync"],
    summary: "Apply a batch of offline changes (protocol 1)",
    description:
      "Operations apply in order, each in its own transaction, so a batch can partially succeed. " +
      "Each opId is idempotent per user. A stale baseVersion returns status=conflict with the server copy; nothing is overwritten.",
    request: { body: { required: true, content: { "application/json": { schema: SyncBatchRequestSchema } } } },
    responses: {
      200: { description: "Per-operation results", content: { "application/json": { schema: SyncBatchResponseSchema } } },
      ...ErrorResponses,
    },
  }),
  async (c) => {
    const user = requireUser(c);
    const { operations } = c.req.valid("json");
    const results: SyncResult[] = [];
    for (const op of operations) {
      try {
        results.push(await applyOperation(user.id, op));
      } catch {
        // Rolled back, nothing stored: the client keeps the op queued and retries the same opId.
        results.push({ opId: op.opId, entityId: op.entityId, status: "retry", replayed: false, version: null, error: { code: "retry_later", message: "Temporary problem; will retry" } });
      }
    }
    return c.json({ protocol: 1 as const, results }, 200);
  },
);

syncRoutes.openapi(
  createRoute({
    method: "get",
    path: "/v1/sync/changes",
    tags: ["sync"],
    summary: "Pull changes after a cursor, including deletion tombstones",
    request: {
      query: z.object({
        cursor: z.string().regex(/^\d{1,19}$/).default("0"),
        limit: z.coerce.number().int().min(1).max(500).default(200),
      }),
    },
    responses: {
      200: { description: "Changes in commit order", content: { "application/json": { schema: SyncChangesResponseSchema } } },
      ...ErrorResponses,
    },
  }),
  async (c) => {
    const user = requireUser(c);
    const { cursor, limit } = c.req.valid("query");
    const { rows } = await pool.query(
      "select * from recipes where user_id = $1 and server_seq > $2 order by server_seq limit $3",
      [user.id, cursor, limit + 1],
    );
    const page = rows.slice(0, limit);
    return c.json(
      {
        changes: page.map((r) => ({
          entity: "recipe" as const,
          entityId: r.id,
          seq: String(r.server_seq),
          deleted: r.deleted_at !== null,
          recipe: r.deleted_at ? null : toRecipe(r),
        })),
        cursor: page.length ? String(page[page.length - 1].server_seq) : cursor,
        hasMore: rows.length > limit,
      },
      200,
    );
  },
);
