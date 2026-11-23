import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import type pg from "pg";
import {
  LINK_REQUEST_DAYS,
  LINK_REQUESTS_PER_DAY,
  LinkActivityPageSchema,
  LinkCreateSchema,
  LinkedAccountsSchema,
  LinkSchema,
  LinkUpdateSchema,
  MAX_LINKS,
  PRIVACY_NOTICE,
  type Link,
  type LinkActivity,
  type LinkStatus,
} from "@betterplate/contracts";
import { config } from "../../config.ts";
import { pool, withTransaction } from "../../db/pool.ts";
import { ApiError, type AppEnv, type AuthUser, rateLimit, requireUser } from "../../lib/http.ts";
import { sendEmail } from "../../lib/mailer.ts";
import { ErrorResponses, IdParam } from "../common.ts";
import { actorName, readPermissions, recordActivity } from "./acting.ts";

/**
 * Linked accounts (ADR-015). The owner sends a request to another person's email with each area
 * off, view or change; that person, signed in with that verified email, accepts or declines. The
 * owner can change the areas or end the link at any time; the other person can leave. None of these
 * routes work while acting in a linked account (policy owner), so a link can't be chained or widened
 * by the person it was given to.
 */

type Db = Pick<pg.PoolClient, "query">;

type LinkRow = {
  id: string; owner_user_id: string; email: string; delegate_user_id: string | null; status: LinkStatus; permissions: unknown;
  created_at: Date; expires_at: Date; accepted_at: Date | null; updated_at: Date;
  owner_name: string | null; owner_email: string; delegate_name: string | null; delegate_email: string | null;
};

const LINK_SELECT = `select l.*, o.name as owner_name, o.email as owner_email, d.name as delegate_name, d.email as delegate_email
  from account_links l join "users" o on o.id = l.owner_user_id left join "users" d on d.id = l.delegate_user_id`;

function toLink(r: LinkRow, me: string): Link {
  const given = r.owner_user_id === me;
  // Until a request is accepted the owner sees only the email they typed, so a request never tells
  // them whether that email has an account.
  const person = given
    ? r.status === "active" && r.delegate_user_id
      ? { id: r.delegate_user_id, name: r.delegate_name || null, email: r.delegate_email ?? r.email }
      : { id: null, name: null, email: r.email }
    : { id: r.owner_user_id, name: r.owner_name || null, email: r.owner_email };
  return {
    id: r.id,
    direction: given ? "given" : "received",
    status: r.status,
    person,
    permissions: readPermissions(r.permissions),
    createdAt: r.created_at.toISOString(),
    expiresAt: r.expires_at.toISOString(),
    acceptedAt: r.accepted_at?.toISOString() ?? null,
    updatedAt: r.updated_at.toISOString(),
  };
}

function requireEnabled() {
  if (!config.features.linkedAccounts) throw new ApiError(404, "feature_disabled", "Linked accounts are not available");
}

async function expireStale(db: Db) {
  await db.query("update account_links set status = 'expired', updated_at = now(), ended_at = now() where status = 'requested' and expires_at <= now()");
}

async function requireConsent(userId: string) {
  const { rows } = await pool.query<{ notice_version: string }>("select notice_version from consent_events where user_id = $1 order by created_at desc limit 1", [userId]);
  if (rows[0]?.notice_version !== PRIVACY_NOTICE.version) {
    throw new ApiError(409, "notice_outdated", "Read and agree to the current privacy notice first");
  }
}

/** Links that reach me: accepted ones by my account, requests by my verified email (null if unverified). */
const receivedBy = (me: string, email: string) =>
  `((l.delegate_user_id = ${me}) or (l.status = 'requested' and l.delegate_user_id is null and ${email}::text is not null and l.email = lower(${email}::text)))`;

const oneLine = (s: string) => s.replace(/[\p{Cc}\p{Zl}\p{Zp}]+/gu, " ").replace(/\s+/g, " ").trim();

export function linkRequestEmail(input: { to: string; owner: string; appUrl: string }) {
  const owner = oneLine(input.owner) || "Someone";
  return {
    to: input.to,
    subject: `${owner} wants to give you access to their account on The Better Plate`,
    text:
      `${owner} wants to let you see or help with parts of their account on The Better Plate, an app for cooking at home.\n\n` +
      `Open ${input.appUrl} and sign in with this email address (${input.to}) to see exactly what they're sharing, then accept or decline. Nothing is shared until you accept.\n\n` +
      `If you don't know ${owner}, you can ignore this email.`,
  };
}

async function linkById(db: Db, id: string): Promise<LinkRow | null> {
  return (await db.query<LinkRow>(`${LINK_SELECT} where l.id = $1`, [id])).rows[0] ?? null;
}

async function listFor(user: AuthUser) {
  await expireStale(pool);
  const email = user.emailVerified ? user.email : null;
  const [given, received] = await Promise.all([
    pool.query<LinkRow>(`${LINK_SELECT} where l.owner_user_id = $1 and l.status in ('requested', 'active') order by l.created_at`, [user.id]),
    pool.query<LinkRow>(`${LINK_SELECT} where ${receivedBy("$1", "$2")} and l.status in ('requested', 'active') and l.owner_user_id <> $1 order by l.created_at`, [user.id, email]),
  ]);
  return { given: given.rows.map((r) => toLink(r, user.id)), received: received.rows.map((r) => toLink(r, user.id)) };
}

export const linkedRoutes = new OpenAPIHono<AppEnv>();
linkedRoutes.use("/v1/linked-accounts", rateLimit("linked accounts", 60, 60));
linkedRoutes.use("/v1/linked-accounts/*", rateLimit("linked accounts", 60, 60));

linkedRoutes.openapi(
  createRoute({
    method: "get", path: "/v1/linked-accounts", tags: ["linked accounts"], summary: "Accounts I share mine with, and accounts shared with me",
    description: "Live links only: requests waiting for an answer and active links. A request I sent shows only the email I typed until it's accepted.",
    responses: { 200: { description: "Links", content: { "application/json": { schema: LinkedAccountsSchema } } }, ...ErrorResponses },
  }),
  async (c) => {
    requireEnabled();
    return c.json(await listFor(requireUser(c)), 200);
  },
);

linkedRoutes.openapi(
  createRoute({
    method: "post", path: "/v1/linked-accounts", tags: ["linked accounts"], summary: "Give someone access to parts of my account (sends a request)",
    description:
      `The person gets an email if the address has an account, and the request waits ${LINK_REQUEST_DAYS} days for them to accept. ` +
      `The answer is the same whether or not the email has an account. Up to ${LINK_REQUESTS_PER_DAY} requests a day and ${MAX_LINKS} live links.`,
    request: { body: { required: true, content: { "application/json": { schema: LinkCreateSchema } } } },
    responses: {
      201: { description: "Request sent", content: { "application/json": { schema: LinkSchema } } },
      409: { description: "Already linked, or the privacy notice must be agreed to first", content: { "application/json": { schema: z.object({ error: z.any() }) } } },
      ...ErrorResponses,
    },
  }),
  async (c) => {
    requireEnabled();
    const user = requireUser(c);
    const { email: typed, permissions } = c.req.valid("json");
    const email = typed.trim().toLowerCase();
    if (email === user.email.toLowerCase()) throw new ApiError(400, "own_account", "That's your own email");
    await requireConsent(user.id);
    const id = crypto.randomUUID();
    const sendTo = await withTransaction(async (client) => {
      await client.query("select pg_advisory_xact_lock(hashtextextended($1, 7))", [user.id]);
      await expireStale(client);
      const counts = (await client.query<{ live: string; sent: string }>(
        `select (select count(*) from account_links where owner_user_id = $1 and status in ('requested', 'active')) as live,
                (select count(*) from account_link_sends where owner_user_id = $1 and sent_at > now() - interval '24 hours') as sent`,
        [user.id],
      )).rows[0]!;
      if (Number(counts.live) >= MAX_LINKS) throw new ApiError(409, "link_limit", `You can share your account with up to ${MAX_LINKS} people`);
      if (Number(counts.sent) >= LINK_REQUESTS_PER_DAY) throw new ApiError(429, "link_request_limit", `You can send up to ${LINK_REQUESTS_PER_DAY} requests a day; try again tomorrow`);
      const exists = await client.query("select 1 from account_links where owner_user_id = $1 and email = $2 and status in ('requested', 'active')", [user.id, email]);
      if (exists.rowCount) throw new ApiError(409, "already_linked", "You already shared your account with this email, or a request is waiting");
      await client.query(
        `insert into account_links (id, owner_user_id, email, status, permissions, expires_at) values ($1, $2, $3, 'requested', $4, now() + make_interval(days => $5))`,
        [id, user.id, email, JSON.stringify(permissions), LINK_REQUEST_DAYS],
      );
      await client.query("insert into account_link_sends (owner_user_id) values ($1)", [user.id]);
      await recordActivity(client, { accountId: user.id, actor: user, linkId: id, via: "app", action: "link.created" });
      const { rows } = await client.query<{ email: string }>(`select email from "users" where lower(email) = $1 and "emailVerified" = true and id <> $2`, [email, user.id]);
      return rows[0]?.email ?? null;
    });
    if (sendTo) {
      try {
        await sendEmail(linkRequestEmail({ to: sendTo, owner: actorName(user), appUrl: config.publicAppUrl.replace(/\/$/, "") }));
      } catch (err) {
        console.error(JSON.stringify({ level: "error", msg: "link request email failed", linkId: id, error: (err as Error).message }));
      }
    }
    return c.json(toLink((await linkById(pool, id))!, user.id), 201);
  },
);

linkedRoutes.openapi(
  createRoute({
    method: "patch", path: "/v1/linked-accounts/{id}", tags: ["linked accounts"], summary: "Change what I share (owner)",
    description: "Takes effect on the other person's next request, in the app and through their AI apps.",
    request: { params: IdParam, body: { required: true, content: { "application/json": { schema: LinkUpdateSchema } } } },
    responses: { 200: { description: "Updated", content: { "application/json": { schema: LinkSchema } } }, ...ErrorResponses },
  }),
  async (c) => {
    requireEnabled();
    const user = requireUser(c);
    const { id } = c.req.valid("param");
    const { permissions } = c.req.valid("json");
    await withTransaction(async (client) => {
      const { rowCount } = await client.query(
        "update account_links set permissions = $3, updated_at = now() where id = $1 and owner_user_id = $2 and status in ('requested', 'active')",
        [id, user.id, JSON.stringify(permissions)],
      );
      if (!rowCount) throw new ApiError(404, "not_found", "Link not found");
      await recordActivity(client, { accountId: user.id, actor: user, linkId: id, via: "app", action: "link.permissions" });
    });
    return c.json(toLink((await linkById(pool, id))!, user.id), 200);
  },
);

linkedRoutes.openapi(
  createRoute({
    method: "delete", path: "/v1/linked-accounts/{id}", tags: ["linked accounts"], summary: "End a link: cancel or remove (owner), decline or leave (the other person)",
    request: { params: IdParam },
    responses: { 204: { description: "Ended" }, ...ErrorResponses },
  }),
  async (c) => {
    requireEnabled();
    const user = requireUser(c);
    const { id } = c.req.valid("param");
    await withTransaction(async (client) => {
      const row = (await client.query<LinkRow>(
        `${LINK_SELECT} where l.id = $1 and l.status in ('requested', 'active') and (l.owner_user_id = $2 or ${receivedBy("$2", "$3")}) for update of l`,
        [id, user.id, user.emailVerified ? user.email : null],
      )).rows[0];
      if (!row) throw new ApiError(404, "not_found", "Link not found");
      const owner = row.owner_user_id === user.id;
      const status: LinkStatus = row.status === "requested" ? (owner ? "cancelled" : "declined") : "removed";
      await client.query("update account_links set status = $2, updated_at = now(), ended_at = now(), ended_by = $3 where id = $1", [id, status, user.id]);
      await recordActivity(client, { accountId: row.owner_user_id, actor: user, linkId: id, via: "app", action: "link.ended" });
    });
    return c.body(null, 204);
  },
);

linkedRoutes.openapi(
  createRoute({
    method: "post", path: "/v1/linked-accounts/{id}/accept", tags: ["linked accounts"], summary: "Accept a request someone sent me",
    description: "Only the person whose verified email the request was sent to. Afterwards they can act in the owner's account through what it shares.",
    request: { params: IdParam },
    responses: {
      200: { description: "Accepted", content: { "application/json": { schema: LinkSchema } } },
      409: { description: "The privacy notice must be agreed to first, or too many links", content: { "application/json": { schema: z.object({ error: z.any() }) } } },
      ...ErrorResponses,
    },
  }),
  async (c) => {
    requireEnabled();
    const user = requireUser(c);
    const { id } = c.req.valid("param");
    if (!user.emailVerified) throw new ApiError(404, "not_found", "Request not found");
    await requireConsent(user.id);
    await withTransaction(async (client) => {
      await expireStale(client);
      const row = (await client.query<{ owner_user_id: string }>(
        "select owner_user_id from account_links where id = $1 and status = 'requested' and email = lower($2) and owner_user_id <> $3 for update",
        [id, user.email, user.id],
      )).rows[0];
      if (!row) throw new ApiError(404, "not_found", "Request not found");
      const live = (await client.query<{ n: string }>("select count(*) as n from account_links where delegate_user_id = $1 and status = 'active'", [user.id])).rows[0]!;
      if (Number(live.n) >= MAX_LINKS) throw new ApiError(409, "link_limit", `You can have up to ${MAX_LINKS} linked accounts`);
      await client.query("update account_links set status = 'active', delegate_user_id = $2, accepted_at = now(), updated_at = now() where id = $1", [id, user.id]);
      await recordActivity(client, { accountId: row.owner_user_id, actor: user, linkId: id, via: "app", action: "link.accepted" });
    });
    return c.json(toLink((await linkById(pool, id))!, user.id), 200);
  },
);

type ActivityRow = { id: string; account_user_id: string; account_name: string | null; actor_user_id: string | null; actor_name: string; via: "app" | "connector"; app_name: string | null; action: LinkActivity["action"]; target_id: string | null; created_at: Date };

linkedRoutes.openapi(
  createRoute({
    method: "get", path: "/v1/linked-accounts/activity", tags: ["linked accounts"], summary: "What was done in my account by people I linked, or what I did in others'",
    description: "who=others (default): changes made in my account by people I shared it with, and changes to my links. who=me: what I did in accounts shared with me. Newest first; kept 12 months.",
    request: {
      query: z.object({
        who: z.enum(["others", "me"]).default("others"),
        before: z.iso.datetime().optional(),
        limit: z.coerce.number().int().min(1).max(100).default(50),
      }),
    },
    responses: { 200: { description: "Entries", content: { "application/json": { schema: LinkActivityPageSchema } } }, ...ErrorResponses },
  }),
  async (c) => {
    requireEnabled();
    const user = requireUser(c);
    const { who, before, limit } = c.req.valid("query");
    const where = who === "others" ? "a.account_user_id = $1" : "a.actor_user_id = $1 and a.account_user_id <> $1";
    const { rows } = await pool.query<ActivityRow>(
      `select a.*, u.name as account_name from linked_activity a join "users" u on u.id = a.account_user_id
        where ${where} and ($2::timestamptz is null or a.created_at < $2) order by a.created_at desc, a.id desc limit $3`,
      [user.id, before ?? null, limit + 1],
    );
    const page = rows.slice(0, limit);
    return c.json(
      {
        entries: page.map((r) => ({
          id: r.id,
          account: { id: r.account_user_id, name: r.account_name || null },
          actor: { id: r.actor_user_id, name: r.actor_name },
          via: r.via,
          appName: r.app_name,
          action: r.action,
          targetId: r.target_id,
          at: r.created_at.toISOString(),
        })),
        before: rows.length > limit ? page[page.length - 1]!.created_at.toISOString() : null,
      },
      200,
    );
  },
);
