import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { config } from "../config.ts";
import { pool } from "../db/pool.ts";
import { devOutbox } from "../lib/mailer.ts";
import { ApiError, type AppEnv, rateLimit, requireUser } from "../lib/http.ts";
import { ErrorResponses } from "./common.ts";
import { LOG_COLUMNS, PLAN_COLUMNS, toLog, toPlan } from "./meals.ts";
import { toRecipe } from "./recipes.ts";
import { shareUrl } from "./shares.ts";

const MeSchema = z.object({ id: z.uuid(), email: z.string(), displayName: z.string().nullable() }).openapi("Me");

export const accountRoutes = new OpenAPIHono<AppEnv>();
accountRoutes.use("/v1/me", rateLimit("account", 120, 60));
accountRoutes.use("/v1/me/export", rateLimit("export", 10, 3600));

accountRoutes.openapi(
  createRoute({
    method: "get", path: "/v1/me", tags: ["account"], summary: "The signed-in account",
    responses: { 200: { description: "Account", content: { "application/json": { schema: MeSchema } } }, ...ErrorResponses },
  }),
  (c) => {
    const user = requireUser(c);
    return c.json({ id: user.id, email: user.email, displayName: user.name || null }, 200);
  },
);

accountRoutes.openapi(
  createRoute({
    method: "delete", path: "/v1/me", tags: ["account"], summary: "Delete my account and all my data",
    responses: { 204: { description: "Deleted; sessions revoked" }, ...ErrorResponses },
  }),
  async (c) => {
    const user = requireUser(c);
    // Recipes, revisions, sync ledger, sessions and accounts cascade from users.
    await pool.query('delete from "users" where id = $1', [user.id]);
    return c.body(null, 204);
  },
);

export const EXPORT_FORMAT = "betterplate.export/1" as const;

/** Everything stored about one account, as data the person can keep or take elsewhere. */
export async function exportAccount(userId: string) {
  const q = <T extends object>(sql: string) => pool.query<T & Record<string, never>>(sql, [userId]).then((r) => r.rows as T[]);
  const [users, logins, sessions, recipes, revisions, plans, logs, shares, reports] = await Promise.all([
    q<{ id: string; email: string; name: string; emailVerified: boolean; createdAt: Date }>(`select id, email, name, "emailVerified", "createdAt" from "users" where id = $1`),
    q<{ providerId: string; createdAt: Date }>(`select "providerId", "createdAt" from "accounts" where "userId" = $1 order by "createdAt"`),
    q<{ createdAt: Date; expiresAt: Date; ipAddress: string | null; userAgent: string | null }>(`select "createdAt", "expiresAt", "ipAddress", "userAgent" from "sessions" where "userId" = $1 order by "createdAt"`),
    q<Parameters<typeof toRecipe>[0]>("select * from recipes where user_id = $1 and deleted_at is null order by created_at"),
    q<{ recipe_id: string; version: number; body: unknown; nutrition: unknown; catalog_version: string | null; deleted: boolean; created_at: Date }>(
      "select recipe_id, version, body, nutrition, catalog_version, deleted, created_at from recipe_revisions where user_id = $1 order by created_at, version",
    ),
    q<Parameters<typeof toPlan>[0]>(`select ${PLAN_COLUMNS} from planned_meals where user_id = $1 and deleted_at is null order by local_date, created_at`),
    q<Parameters<typeof toLog>[0]>(`select ${LOG_COLUMNS} from consumption_events where user_id = $1 and deleted_at is null order by local_date, eaten_at`),
    q<{ id: string; recipe_id: string; recipe_version: number; include_method: boolean; snapshot: unknown; created_at: Date; expires_at: Date | null; revoked_at: Date | null }>(
      "select id, recipe_id, recipe_version, include_method, snapshot, created_at, expires_at, revoked_at from share_snapshots where user_id = $1 order by created_at",
    ),
    q<{ id: string; kind: string; message: string; activity: unknown; context: unknown; status: string; created_at: Date; screenshot: Buffer | null; screenshot_type: string | null }>(
      "select id, kind, message, activity, context, status, created_at, screenshot, screenshot_type from feedback_reports where user_id = $1 order by created_at",
    ),
  ]);
  const user = users[0]!;
  return {
    format: EXPORT_FORMAT,
    exportedAt: new Date().toISOString(),
    account: { id: user.id, email: user.email, displayName: user.name || null, emailVerified: user.emailVerified, createdAt: user.createdAt.toISOString() },
    // Email codes need no stored link; this lists linked providers such as Google.
    linkedSignIns: logins.map((l) => ({ provider: l.providerId, linkedAt: l.createdAt.toISOString() })),
    sessions: sessions.map((s) => ({ createdAt: s.createdAt.toISOString(), expiresAt: s.expiresAt.toISOString(), ipAddress: s.ipAddress, userAgent: s.userAgent })),
    recipes: recipes.map(toRecipe),
    recipeRevisions: revisions.map((r) => ({ recipeId: r.recipe_id, version: r.version, deleted: r.deleted, body: r.body, nutrition: r.nutrition, catalogVersion: r.catalog_version, createdAt: r.created_at.toISOString() })),
    plannedMeals: plans.map(toPlan),
    mealsEaten: logs.map(toLog),
    shareLinks: shares.map((s) => ({
      shareId: s.id, url: shareUrl(s.id), recipeId: s.recipe_id, recipeVersion: s.recipe_version, includeMethod: s.include_method,
      createdAt: s.created_at.toISOString(), expiresAt: s.expires_at?.toISOString() ?? null, revokedAt: s.revoked_at?.toISOString() ?? null,
      snapshot: s.revoked_at ? null : s.snapshot,
    })),
    issueReports: reports.map((r) => ({
      id: r.id, kind: r.kind, message: r.message, activity: r.activity, context: r.context, status: r.status, createdAt: r.created_at.toISOString(),
      screenshot: r.screenshot ? `data:${r.screenshot_type};base64,${r.screenshot.toString("base64")}` : null,
    })),
  };
}

accountRoutes.openapi(
  createRoute({
    method: "get", path: "/v1/me/export", tags: ["account"], summary: "Download all my data as JSON",
    description: "Account, sign-in methods, sessions, recipes with every revision, planned and eaten meals, share links and issue reports. Rate limited to 10 per hour.",
    responses: { 200: { description: "Export (betterplate.export/1)", content: { "application/json": { schema: z.object({ format: z.literal(EXPORT_FORMAT) }).passthrough() } } }, ...ErrorResponses },
  }),
  async (c) => {
    const user = requireUser(c);
    const data = await exportAccount(user.id);
    c.header("Cache-Control", "no-store");
    c.header("Content-Disposition", `attachment; filename="better-plate-export-${data.exportedAt.slice(0, 10)}.json"`);
    return c.json(data, 200);
  },
);

const SignInMethodsSchema = z
  .object({ methods: z.array(z.enum(["email_code", "google"])) })
  .openapi("SignInMethods");

accountRoutes.openapi(
  createRoute({
    method: "get", path: "/v1/sign-in-methods", tags: ["account"], summary: "Sign-in methods enabled on this server",
    responses: { 200: { description: "Methods", content: { "application/json": { schema: SignInMethodsSchema } } } },
  }),
  (c) => {
    const methods: ("google" | "email_code")[] = config.google ? ["google", "email_code"] : ["email_code"];
    return c.json({ methods }, 200);
  },
);

export const healthRoutes = new OpenAPIHono<AppEnv>();
const HealthSchema = z.object({ status: z.string(), checks: z.record(z.string(), z.string()).optional() });

healthRoutes.openapi(
  createRoute({
    method: "get", path: "/v1/health/live", tags: ["health"], summary: "Process is up",
    responses: { 200: { description: "Live", content: { "application/json": { schema: HealthSchema } } } },
  }),
  (c) => c.json({ status: "ok" }, 200),
);

healthRoutes.openapi(
  createRoute({
    method: "get", path: "/v1/health/ready", tags: ["health"], summary: "Database reachable and catalog loaded",
    responses: {
      200: { description: "Ready", content: { "application/json": { schema: HealthSchema } } },
      503: { description: "Not ready", content: { "application/json": { schema: HealthSchema } } },
    },
  }),
  async (c) => {
    try {
      await pool.query("select 1");
    } catch (err) {
      console.error(JSON.stringify({ level: "error", msg: "readiness: database unreachable", error: (err as Error).message }));
      return c.json({ status: "not_ready", checks: { database: "unreachable" } }, 503);
    }
    try {
      const { rows } = await pool.query("select version from catalog_versions where is_current");
      if (!rows[0]) return c.json({ status: "not_ready", checks: { database: "ok", catalog: "missing" } }, 503);
      return c.json({ status: "ok", checks: { database: "ok", catalog: rows[0].version as string } }, 200);
    } catch (err) {
      // Usually means migrations have not run against this database yet.
      console.error(JSON.stringify({ level: "error", msg: "readiness: schema not ready", error: (err as Error).message }));
      return c.json({ status: "not_ready", checks: { database: "ok", catalog: "schema_missing" } }, 503);
    }
  },
);

/** Local/test only: read the in-memory mailbox (sign-in codes). Returns 404 in every deployed environment. */
export const devRoutes = new OpenAPIHono<AppEnv>();
devRoutes.get("/v1/dev/mailbox", (c) => {
  if (!config.isLocal) throw new ApiError(404, "not_found", "Not found");
  return c.json({ messages: devOutbox(c.req.query("email")).slice(0, 20) });
});
