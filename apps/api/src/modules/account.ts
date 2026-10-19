import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { config } from "../config.ts";
import { pool } from "../db/pool.ts";
import { devOutbox } from "../lib/mailer.ts";
import { ApiError, type AppEnv, rateLimit, requireUser } from "../lib/http.ts";
import { ErrorResponses } from "./common.ts";

const MeSchema = z.object({ id: z.uuid(), email: z.string(), displayName: z.string().nullable() }).openapi("Me");

export const accountRoutes = new OpenAPIHono<AppEnv>();
accountRoutes.use("/v1/me", rateLimit("account", 120, 60));

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
