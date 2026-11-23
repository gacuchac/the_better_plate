import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import {
  allows,
  type LinkAction,
  type LinkArea,
  type LinkPermissions,
  SyncBatchRequestSchema,
  SyncBatchResponseSchema,
  SyncChangesResponseSchema,
  type SyncChange,
  type SyncOperation,
  type SyncResult,
} from "@betterplate/contracts";
import { pool, withTransaction } from "../db/pool.ts";
import { type ActingLink, type AppEnv, type AuthUser, rateLimit, requireUser, signedInUser } from "../lib/http.ts";
import { recordActivity } from "./linked/acting.ts";
import { ErrorResponses } from "./common.ts";
import { createLog, deleteLog, deletePlan, LOG_COLUMNS, PLAN_COLUMNS, putPlan, toLog, toPlan } from "./meals.ts";
import { deleteRecipe, putRecipe, toRecipe } from "./recipes.ts";
import { deleteGoal, GOAL_COLUMNS, putGoal, toGoal } from "./goals.ts";
import { putFeedback, putPreferences, toFeedback, toPreferences } from "./preferences.ts";
import { READABLE_RECIPES } from "./access.ts";
import { PROFILE_COLUMNS, toProfile } from "./groups.ts";
import { createWater, deleteWater, toWater, WATER_COLUMNS } from "./water.ts";
import { createFavorite, deleteFavorite, FAVORITE_COLUMNS, toFavorite } from "./favorites.ts";

async function runOperation(client: Parameters<typeof putRecipe>[0], userId: string, op: SyncOperation): Promise<SyncResult> {
  const base = { opId: op.opId, entityId: op.entityId, replayed: false };
  switch (op.type) {
    case "recipe.put":
    case "recipe.delete": {
      const outcome =
        op.type === "recipe.put"
          ? await putRecipe(client, userId, op.entityId, op.baseVersion, op.body)
          : await deleteRecipe(client, userId, op.entityId, op.baseVersion);
      if (outcome.status === "applied") return { ...base, status: "applied", version: outcome.version };
      if (outcome.status === "conflict") return { ...base, status: "conflict", version: outcome.server?.version ?? null, server: outcome.server };
      return { ...base, status: "rejected", version: null, error: { code: outcome.code, message: outcome.message } };
    }
    case "plan.put":
    case "plan.delete": {
      const outcome =
        op.type === "plan.put"
          ? await putPlan(client, userId, op.entityId, op.baseVersion, op.body)
          : await deletePlan(client, userId, op.entityId, op.baseVersion);
      if (outcome.status === "applied") return { ...base, status: "applied", version: outcome.version };
      if (outcome.status === "conflict") return { ...base, status: "conflict", version: outcome.server?.version ?? null, serverPlannedMeal: outcome.server };
      return { ...base, status: "rejected", version: null, error: { code: outcome.code, message: outcome.message } };
    }
    case "log.create":
    case "log.delete": {
      const outcome = op.type === "log.create" ? await createLog(client, userId, op.entityId, op.body) : await deleteLog(client, userId, op.entityId);
      if (outcome.status === "applied") return { ...base, status: "applied", version: null };
      return { ...base, status: "rejected", version: null, error: { code: outcome.code, message: outcome.message } };
    }
    case "goal.put":
    case "goal.delete": {
      const outcome =
        op.type === "goal.put"
          ? await putGoal(client, userId, op.entityId, op.baseVersion, op.body)
          : await deleteGoal(client, userId, op.entityId, op.baseVersion);
      if (outcome.status === "applied") return { ...base, status: "applied", version: outcome.version };
      if (outcome.status === "conflict") return { ...base, status: "conflict", version: outcome.server?.version ?? null, serverGoal: outcome.server };
      return { ...base, status: "rejected", version: null, error: { code: outcome.code, message: outcome.message } };
    }
    case "water.create":
    case "water.delete": {
      const outcome = op.type === "water.create" ? await createWater(client, userId, op.entityId, op.body) : await deleteWater(client, userId, op.entityId);
      if (outcome.status === "applied") return { ...base, status: "applied", version: null };
      return { ...base, status: "rejected", version: null, error: { code: outcome.code, message: outcome.message } };
    }
    case "favorite.create":
    case "favorite.delete": {
      const outcome = op.type === "favorite.create" ? await createFavorite(client, userId, op.entityId, op.body) : await deleteFavorite(client, userId, op.entityId);
      if (outcome.status === "applied") return { ...base, status: "applied", version: null };
      return { ...base, status: "rejected", version: null, error: { code: outcome.code, message: outcome.message } };
    }
    case "prefs.put": {
      const outcome = await putPreferences(client, userId, op.entityId, op.baseVersion, op.body);
      if (outcome.status === "applied") return { ...base, status: "applied", version: outcome.version };
      if (outcome.status === "conflict") return { ...base, status: "conflict", version: outcome.server?.version ?? null, serverPreferences: outcome.server };
      return { ...base, status: "rejected", version: null, error: { code: outcome.code, message: outcome.message } };
    }
    case "feedback.put": {
      const outcome = await putFeedback(client, userId, op.entityId, op.baseVersion, op.body);
      if (outcome.status === "applied") return { ...base, status: "applied", version: outcome.version };
      if (outcome.status === "conflict") return { ...base, status: "conflict", version: outcome.server?.version ?? null, serverFeedback: outcome.server };
      return { ...base, status: "rejected", version: null, error: { code: outcome.code, message: outcome.message } };
    }
  }
}

type Client = Parameters<typeof putRecipe>[0];

const OP_ACTIONS: Record<SyncOperation["type"], LinkAction> = {
  "recipe.put": "recipe.save", "recipe.delete": "recipe.delete",
  "plan.put": "plan.save", "plan.delete": "plan.delete",
  "log.create": "meal.log", "log.delete": "meal.remove",
  "goal.put": "goal.save", "goal.delete": "goal.delete",
  "water.create": "water.log", "water.delete": "water.remove",
  "favorite.create": "favorite.add", "favorite.delete": "favorite.remove",
  "prefs.put": "prefs.save", "feedback.put": "feedback.save",
};

const logProfile = async (client: Client, id: string, ownerId: string) =>
  (await client.query<{ profile_id: string | null }>("select profile_id from consumption_events where id = $1 and user_id = $2", [id, ownerId])).rows[0]?.profile_id ?? null;

/**
 * The areas an operation touches while acting in a linked account (ADR-015); it needs change on
 * every one. Anything for a child profile is the children area, whichever record it is.
 */
async function opAreas(client: Client, ownerId: string, op: SyncOperation): Promise<LinkArea[]> {
  switch (op.type) {
    case "recipe.put":
    case "recipe.delete": {
      const { rows } = await client.query<{ user_id: string; group_id: string | null }>("select user_id, group_id from recipes where id = $1", [op.entityId]);
      // A group's recipe someone else wrote is reached through the groups the owner is in.
      return rows[0] && rows[0].user_id !== ownerId && rows[0].group_id ? ["groups"] : ["recipes"];
    }
    case "favorite.create":
    case "favorite.delete":
      return ["recipes"];
    case "plan.put":
    case "plan.delete": {
      // Both sides count: moving a plan from the owner to a child touches plans and children.
      const existing = (await client.query<{ profile_id: string | null }>("select profile_id from planned_meals where id = $1 and user_id = $2", [op.entityId, ownerId])).rows[0];
      const sides = [...(existing ? [existing.profile_id] : []), ...(op.type === "plan.put" ? [op.body.profileId ?? null] : [])];
      const areas = new Set<LinkArea>(sides.map((p) => (p ? "children" : "plans")));
      return areas.size ? [...areas] : ["plans"];
    }
    case "log.create":
      return [op.body.profileId ? "children" : "eaten"];
    case "log.delete":
      return [(await logProfile(client, op.entityId, ownerId)) ? "children" : "eaten"];
    case "feedback.put":
      return [(await logProfile(client, op.entityId, ownerId)) ? "children" : "eaten"];
    case "water.create":
    case "water.delete":
      return ["eaten"];
    case "goal.put":
    case "goal.delete":
      return ["goals"];
    case "prefs.put":
      return [op.entityId === ownerId ? "preferences" : "children"];
  }
}

function linkRefusal(permissions: LinkPermissions, areas: LinkArea[]): { code: string; message: string } | null {
  const missing = areas.filter((a) => !allows(permissions.areas[a], "change"));
  if (!missing.length) return null;
  return missing.every((a) => allows(permissions.areas[a], "view"))
    ? { code: "view_only", message: "This is shared with you to view only" }
    : { code: "not_shared", message: "This isn't shared with you" };
}

/**
 * Applies one client operation exactly once. The (user, opId) row is inserted first in the
 * same transaction as the write, so a retried or concurrent duplicate waits, then gets the
 * stored result back with replayed=true instead of applying twice.
 */
async function applyOperation(userId: string, op: SyncOperation, acting?: { link: ActingLink; actor: AuthUser }): Promise<SyncResult> {
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

    let result: SyncResult;
    try {
      const refusal = acting ? linkRefusal(acting.link.permissions, await opAreas(client, userId, op)) : null;
      result = refusal
        ? { opId: op.opId, entityId: op.entityId, replayed: false, status: "rejected", version: null, error: refusal }
        : await runOperation(client, userId, op);
      if (acting && result.status === "applied") {
        const { link, actor } = acting;
        await recordActivity(client, { accountId: userId, actor, linkId: link.id, via: link.via, appName: link.appName, clientId: link.clientId, action: OP_ACTIONS[op.type], targetId: op.entityId });
      }
    } catch (err) {
      console.error(JSON.stringify({ level: "error", msg: "sync operation failed", opId: op.opId, type: op.type, error: (err as Error).message }));
      throw err;
    }

    // Every answer is stored, conflicts included: replaying an opId returns the same answer,
    // and a resolved conflict is sent as a new operation with a new opId.
    await client.query("update sync_operations set result = $3 where user_id = $1 and op_id = $2", [userId, op.opId, JSON.stringify(result)]);
    return result;
  });
}

/** SQL conditions (no parameters but $1, the account) that keep a pull to what a link shares. */
function pullFilters(permissions: LinkPermissions | null, _ownerId: string) {
  const can = (a: LinkArea) => !permissions || allows(permissions.areas[a], "view");
  const sql = (b: boolean) => (b ? "true" : "false");
  // Rows for a child profile need children; the owner's own rows need their own area.
  const split = (own: LinkArea) => (can(own) && can("children") ? "true" : can(own) ? "profile_id is null" : can("children") ? "profile_id is not null" : "false");
  const recipes = can("recipes") && can("groups") ? "true" : can("recipes") ? "user_id = $1" : can("groups") ? "user_id <> $1" : "false";
  return {
    recipes,
    plans: split("plans"),
    eaten: split("eaten"),
    goals: sql(can("goals")),
    prefs: can("preferences") && can("children") ? "true" : can("preferences") ? "id = $1" : can("children") ? "id <> $1" : "false",
    children: sql(can("children")),
    water: sql(can("eaten")),
    favorites: sql(can("recipes")),
  };
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
    const link = c.get("link");
    const acting = link ? { link, actor: signedInUser(c) } : undefined;
    const { operations } = c.req.valid("json");
    const results: SyncResult[] = [];
    for (const op of operations) {
      try {
        results.push(await applyOperation(user.id, op, acting));
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
    description:
      "Recipes (mine and my groups'), planned meals (including those my groups' admins planned for me), eaten logs, goals, food preferences, " +
      "meal feedback, water I logged, my favorite recipes and the profiles I own. When I join a group its recipes are sent again; when I leave one, clients drop its recipes.",
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
    const f = pullFilters(c.get("link")?.permissions ?? null, user.id);
    // One global sequence orders every entity; merge the per-user feeds by it. While acting in a
    // linked account, rows of areas it doesn't share are left out in SQL, so paging stays right.
    const [recipes, plans, logs, goals, prefs, feedback, profiles, water, favorites] = await Promise.all([
      pool.query(`select * from recipes where ${READABLE_RECIPES} and ${f.recipes} and server_seq > $2 order by server_seq limit $3`, [user.id, cursor, limit + 1]),
      pool.query(`select ${PLAN_COLUMNS} from planned_meals where user_id = $1 and ${f.plans} and server_seq > $2 order by server_seq limit $3`, [user.id, cursor, limit + 1]),
      pool.query(`select ${LOG_COLUMNS} from consumption_events where user_id = $1 and ${f.eaten} and server_seq > $2 order by server_seq limit $3`, [user.id, cursor, limit + 1]),
      pool.query(`select ${GOAL_COLUMNS} from goals where user_id = $1 and ${f.goals} and server_seq > $2 order by server_seq limit $3`, [user.id, cursor, limit + 1]),
      pool.query(`select * from food_preferences where user_id = $1 and ${f.prefs} and server_seq > $2 order by server_seq limit $3`, [user.id, cursor, limit + 1]),
      pool.query(`select * from meal_feedback where user_id = $1 and ${f.eaten} and server_seq > $2 order by server_seq limit $3`, [user.id, cursor, limit + 1]),
      pool.query(`select ${PROFILE_COLUMNS} from profiles where owner_user_id = $1 and ${f.children} and server_seq > $2 order by server_seq limit $3`, [user.id, cursor, limit + 1]),
      pool.query(`select ${WATER_COLUMNS} from water_logs where user_id = $1 and ${f.water} and server_seq > $2 order by server_seq limit $3`, [user.id, cursor, limit + 1]),
      pool.query(`select ${FAVORITE_COLUMNS} from recipe_favorites where user_id = $1 and ${f.favorites} and server_seq > $2 order by server_seq limit $3`, [user.id, cursor, limit + 1]),
    ]);
    const all: SyncChange[] = [
      ...recipes.rows.map((r) => ({ entity: "recipe" as const, entityId: r.id, seq: String(r.server_seq), deleted: r.deleted_at !== null, recipe: r.deleted_at ? null : toRecipe(r) })),
      ...plans.rows.map((r) => ({ entity: "planned_meal" as const, entityId: r.id, seq: String(r.server_seq), deleted: r.deleted_at !== null, recipe: null, plannedMeal: r.deleted_at ? null : toPlan(r) })),
      ...logs.rows.map((r) => ({ entity: "meal_log" as const, entityId: r.id, seq: String(r.server_seq), deleted: r.deleted_at !== null, recipe: null, mealLog: r.deleted_at ? null : toLog(r) })),
      ...goals.rows.map((r) => ({ entity: "goal" as const, entityId: r.id, seq: String(r.server_seq), deleted: r.deleted_at !== null, recipe: null, goal: r.deleted_at ? null : toGoal(r) })),
      ...prefs.rows.map((r) => ({ entity: "preferences" as const, entityId: r.id, seq: String(r.server_seq), deleted: false, recipe: null, preferences: toPreferences(r) })),
      ...feedback.rows.map((r) => ({ entity: "meal_feedback" as const, entityId: r.id, seq: String(r.server_seq), deleted: r.deleted_at !== null, recipe: null, feedback: r.deleted_at ? null : toFeedback(r) })),
      ...profiles.rows.map((r) => ({ entity: "profile" as const, entityId: r.id, seq: String(r.server_seq), deleted: r.deleted_at !== null, recipe: null, profile: r.deleted_at ? null : toProfile(r) })),
      ...water.rows.map((r) => ({ entity: "water_log" as const, entityId: r.id, seq: String(r.server_seq), deleted: r.deleted_at !== null, recipe: null, waterLog: r.deleted_at ? null : toWater(r) })),
      ...favorites.rows.map((r) => ({ entity: "recipe_favorite" as const, entityId: r.id, seq: String(r.server_seq), deleted: r.deleted_at !== null, recipe: null, favorite: r.deleted_at ? null : toFavorite(r) })),
    ].sort((a, b) => (BigInt(a.seq) < BigInt(b.seq) ? -1 : 1));
    const page = all.slice(0, limit);
    return c.json(
      {
        changes: page,
        cursor: page.length ? page[page.length - 1]!.seq : cursor,
        hasMore: all.length > limit,
      },
      200,
    );
  },
);
