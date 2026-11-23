import type { Context, MiddlewareHandler } from "hono";
import type pg from "pg";
import { LinkPermissionsSchema, type LinkAction, type LinkPermissions } from "@betterplate/contracts";
import { config } from "../../config.ts";
import { pool } from "../../db/pool.ts";
import { type ActingLink, ApiError, type AppEnv, type AuthUser } from "../../lib/http.ts";

type Db = Pick<pg.PoolClient, "query">;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Stored permissions, read leniently: anything unknown or missing is off. */
export function readPermissions(value: unknown): LinkPermissions {
  const parsed = LinkPermissionsSchema.safeParse(value ?? {});
  return parsed.success ? parsed.data : LinkPermissionsSchema.parse({ areas: {}, aiApps: false });
}

/** The live link letting delegateId act in ownerId's account, with the owner's account, or null. */
export async function activeLink(db: Db, ownerId: string, delegateId: string): Promise<Omit<ActingLink, "via" | "appName" | "clientId"> | null> {
  const { rows } = await db.query<{ id: string; permissions: unknown; updated_at: Date; owner_id: string; email: string; name: string; emailVerified: boolean }>(
    `select l.id, l.permissions, l.updated_at, u.id as owner_id, u.email, u.name, u."emailVerified"
       from account_links l join "users" u on u.id = l.owner_user_id
      where l.owner_user_id = $1 and l.delegate_user_id = $2 and l.status = 'active'`,
    [ownerId, delegateId],
  );
  const r = rows[0];
  if (!r) return null;
  return {
    id: r.id,
    owner: { id: r.owner_id, email: r.email, name: r.name, emailVerified: r.emailVerified === true },
    permissions: readPermissions(r.permissions),
    updatedAt: r.updated_at,
  };
}

/** What the app shows as who acted: their display name, or their email when they have none. */
export const actorName = (u: AuthUser) => u.name?.trim() || u.email || "Someone";

export async function recordActivity(
  db: Db,
  entry: { accountId: string; actor: AuthUser; linkId: string | null; via: "app" | "connector"; appName?: string | null; clientId?: string | null; action: LinkAction; targetId?: string | null },
) {
  await db.query(
    `insert into linked_activity (account_user_id, actor_user_id, actor_name, link_id, via, app_name, client_id, action, target_id)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [entry.accountId, entry.actor.id, actorName(entry.actor), entry.linkId, entry.via, entry.appName ?? null, entry.clientId ?? null, entry.action, entry.targetId ?? null],
  );
}

/** Records a change made while acting in a linked account. A failure is logged, never shown to the person. */
export async function recordDelegated(c: Context<AppEnv>, action: LinkAction, targetId: string | null, db: Db = pool) {
  const link = c.get("link");
  const actor = c.get("user");
  if (!link || !actor) return;
  await recordActivity(db, { accountId: link.owner.id, actor, linkId: link.id, via: link.via, appName: link.appName, clientId: link.clientId, action, targetId });
}

/** The first id in a request path, which is the record a route changes. */
const targetOf = (path: string) => path.split("/").find((s) => UUID.test(s)) ?? null;

/**
 * X-Act-As: <account id> (or ?as= on a GET) makes this request act in that account, if it is linked to the signed-in
 * person and still active (checked on every request, so ending a link takes effect at once). What a
 * route may do there is decided in requireUser by the route's policy. Changes that succeed are
 * written to the owner's activity log.
 */
export const actingMiddleware: MiddlewareHandler<AppEnv> = async (c, next) => {
  // A GET may name the account in ?as= instead, for what the browser loads itself (recipe photos).
  const header = (c.req.header("x-act-as") ?? (c.req.method === "GET" ? c.req.query("as") : undefined))?.trim();
  if (!header) return next();
  if (!config.features.linkedAccounts) throw new ApiError(404, "feature_disabled", "Linked accounts are not available");
  const user = c.get("user");
  if (!user) throw new ApiError(401, "unauthenticated", "Sign in to continue");
  if (header === user.id) return next();
  if (!UUID.test(header)) throw new ApiError(400, "invalid_request", "X-Act-As must be an account id");
  const link = await activeLink(pool, header, user.id);
  if (!link) throw new ApiError(403, "no_access", "You don't have access to this account any more");
  c.set("link", { ...link, via: "app", appName: null, clientId: null });
  await next();
  const policy = c.get("linkPolicy");
  if (policy?.kind === "area" && policy.action && c.req.method !== "GET" && c.res.status < 400) {
    await recordDelegated(c, policy.action, targetOf(c.req.path)).catch((err) =>
      console.error(JSON.stringify({ level: "error", msg: "linked activity not recorded", requestId: c.get("requestId"), error: (err as Error).message })),
    );
  }
};
