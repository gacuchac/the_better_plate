import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { LinkAccess, LinkAction, LinkArea } from "@betterplate/contracts";
import { LINKED_SCOPE } from "../../auth.ts";
import { config } from "../../config.ts";
import { pool } from "../../db/pool.ts";
import { type ActingLink, ApiError, assertLinkAllows, type AuthUser } from "../../lib/http.ts";
import type { ConnectorAuth } from "../connector.ts";
import { activeLink, readPermissions, recordActivity } from "./acting.ts";

/**
 * Every connector tool is registered here, so acting in a linked account works the same for all
 * of them (ADR-015). A tool call may name `account`: an account whose owner linked it to the
 * signed-in person and allowed AI apps. The call then runs in that account, only where the owner
 * shared it, and each change is written to the owner's activity log with the app's name.
 */


/**
 * What a tool may do in a linked account.
 * - public: no account data (food search, photo search).
 * - routes: it calls the app's own REST routes, whose ROUTE_POLICIES decide (cooking tools).
 * - area: like a route policy; action is logged after a successful change.
 * - owner: never in someone else's account.
 */
export type ToolPolicy =
  | { kind: "public" }
  | { kind: "routes" }
  | { kind: "owner" }
  | { kind: "area"; areas: readonly LinkArea[]; access: "view" | "change"; action?: LinkAction };

export const view = (...areas: LinkArea[]): ToolPolicy => ({ kind: "area", areas, access: "view" });
export const change = (action: LinkAction, ...areas: LinkArea[]): ToolPolicy => ({ kind: "area", areas, access: "change", action });

/** Where a call runs: the account it works in, who is calling, and the link when that isn't them. */
export interface ToolContext {
  accountId: string;
  actor: AuthUser;
  link: ActingLink | null;
}

const ACCOUNT_DESCRIPTION =
  "Leave out to use the person's own account. To act in an account linked to theirs, pass its accountId from list_accounts; " +
  "only what that account's owner shared is allowed.";

export async function personFor(userId: string): Promise<AuthUser> {
  const { rows } = await pool.query<{ email: string; name: string; emailVerified: boolean }>(`select email, name, "emailVerified" from "users" where id = $1`, [userId]);
  if (!rows[0]) throw new Error("This account no longer exists");
  return { id: userId, email: rows[0].email, name: rows[0].name, emailVerified: rows[0].emailVerified === true };
}

async function appName(clientId: string): Promise<string | null> {
  const { rows } = await pool.query<{ name: string | null }>(`select name from "oauthClient" where "clientId" = $1`, [clientId]);
  return rows[0]?.name?.trim().slice(0, 100) || null;
}

/** Resolves `account` for this connection, with every check that a request acting in the app gets. */
export async function contextFor(session: ConnectorAuth, account: string | undefined): Promise<ToolContext> {
  const actor = await personFor(session.userId);
  if (!account || account === session.userId) return { accountId: session.userId, actor, link: null };
  if (!config.features.linkedAccounts) throw new Error("Linked accounts aren't available");
  if (!session.scopes.has(LINKED_SCOPE)) {
    throw new Error(`This connection wasn't given permission to use linked accounts (${LINKED_SCOPE}). Reconnect and allow it.`);
  }
  if (!z.uuid().safeParse(account).success) throw new Error("account must be an accountId from list_accounts");
  const link = await activeLink(pool, account, session.userId);
  if (!link) throw new Error("You don't have access to that account any more; call list_accounts");
  const owner = link.owner.name || "Its owner";
  if (!link.permissions.aiApps) throw new Error(`${owner} hasn't allowed AI apps to act in their account. They can turn that on in The Better Plate, under You, Linked accounts.`);
  return { accountId: link.owner.id, actor, link: { ...link, via: "connector", appName: await appName(session.clientId), clientId: session.clientId } };
}

/** The record a change touched, from the tool's answer or its input. */
function targetOf(input: Record<string, unknown>, output: unknown): string | null {
  for (const source of [output, input]) {
    if (!source || typeof source !== "object") continue;
    for (const key of ["recipeId", "planId", "logId", "goalId"]) {
      const v = (source as Record<string, unknown>)[key];
      if (typeof v === "string") return v;
    }
  }
  return null;
}

export interface AccountTool {
  name: string;
  description: string;
  input: z.ZodRawShape;
  annotations: { readOnlyHint: boolean; destructiveHint: boolean; idempotentHint: boolean; openWorldHint: boolean };
  meta?: Record<string, unknown>;
  /** The connection permission it needs, and what that permission lets it do, for the refusal. */
  scope: string;
  scopeText: string;
  policy: ToolPolicy;
  /** list_accounts itself takes no account. */
  noAccount?: boolean;
  run: (input: never, ctx: ToolContext) => Promise<unknown>;
}

const failure = (text: string) => ({ isError: true, content: [{ type: "text", text: text.slice(0, 600) }] });

export function registerAccountTool(server: McpServer, session: ConnectorAuth, t: AccountTool) {
  const withAccount = config.features.linkedAccounts && !t.noAccount;
  const shape = withAccount ? { ...t.input, account: z.uuid().optional().describe(ACCOUNT_DESCRIPTION) } : t.input;
  server.registerTool(
    t.name,
    { description: t.description, inputSchema: z.object(shape), ...(t.meta ? { _meta: t.meta } : {}), annotations: t.annotations },
    (async (raw: Record<string, unknown>) => {
      if (!session.scopes.has(t.scope)) return failure(`This connection wasn't given permission to ${t.scopeText} (${t.scope}). Reconnect and allow it.`);
      try {
        const { account, ...input } = raw as { account?: string } & Record<string, unknown>;
        const ctx = await contextFor(session, withAccount ? account : undefined);
        if (ctx.link && t.policy.kind !== "public" && t.policy.kind !== "routes") assertLinkAllows(ctx.link, t.policy);
        const output = await t.run((withAccount ? input : raw) as never, ctx);
        if (ctx.link && t.policy.kind === "area" && t.policy.action) {
          await recordActivity(pool, {
            accountId: ctx.accountId, actor: ctx.actor, linkId: ctx.link.id, via: "connector", appName: ctx.link.appName, clientId: ctx.link.clientId,
            action: t.policy.action, targetId: targetOf(input, output),
          }).catch((err) => console.error(JSON.stringify({ level: "error", msg: "linked activity not recorded", tool: t.name, error: (err as Error).message })));
        }
        const image = (output as { image?: { bytes: Buffer; type: string } } | null)?.image;
        if (image && Buffer.isBuffer(image.bytes)) return { content: [{ type: "image", data: image.bytes.toString("base64"), mimeType: image.type || "image/webp" }] };
        // In a linked account, every answer says whose account it came from.
        const answer = ctx.link && output && typeof output === "object" && !Array.isArray(output) ? { account: { accountId: ctx.accountId, name: ctx.link.owner.name || null }, ...output } : output;
        return { content: [{ type: "text", text: JSON.stringify(answer) }] };
      } catch (err) {
        return failure(err instanceof ApiError || err instanceof Error ? err.message : "Something went wrong");
      }
    }) as never,
  );
}

/** The accounts this connection can act in: the person's own, and each account linked to them. */
export function registerListAccounts(server: McpServer, session: ConnectorAuth) {
  if (!config.features.linkedAccounts) return;
  registerAccountTool(server, session, {
    name: "list_accounts",
    description:
      "List the accounts you can act in: the person's own, and accounts other people linked to theirs (for example a partner's). " +
      "Pass an accountId as account on another tool to act there. Each linked account shows what its owner shared and whether AI apps may act in it.",
    input: {},
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    scope: LINKED_SCOPE,
    scopeText: "use linked accounts",
    policy: { kind: "public" },
    noAccount: true,
    async run(_input, ctx) {
      const { rows } = await pool.query<{ owner_id: string; name: string; email: string; permissions: unknown }>(
        `select u.id as owner_id, u.name, u.email, l.permissions
           from account_links l join "users" u on u.id = l.owner_user_id
          where l.delegate_user_id = $1 and l.status = 'active' order by l.accepted_at nulls last, l.created_at`,
        [ctx.actor.id],
      );
      return {
        yours: { accountId: ctx.actor.id, name: ctx.actor.name || null },
        linked: rows.map((r) => {
          const p = readPermissions(r.permissions);
          const shared = Object.fromEntries(Object.entries(p.areas).filter(([, level]) => level !== "off")) as Partial<Record<LinkArea, LinkAccess>>;
          return { accountId: r.owner_id, name: r.name || null, email: r.email, aiAppsAllowed: p.aiApps, shared };
        }),
        note: "Only areas listed under shared can be used, at the level shown (view or change). Tell the person whose account you acted in.",
      };
    },
  });
}
