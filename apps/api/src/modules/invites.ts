import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import type pg from "pg";
import {
  GroupDetailSchema,
  InviteAcceptSchema,
  MyGroupInviteSchema,
  PENDING_INVITE_DAYS,
  PendingMemberCreatedSchema,
  PendingMemberCreateSchema,
  type MyGroupInvite,
} from "@betterplate/contracts";
import { config } from "../config.ts";
import { pool, withTransaction } from "../db/pool.ts";
import { ApiError, type AppEnv, type AuthUser, rateLimit, requireUser } from "../lib/http.ts";
import { sendEmail } from "../lib/mailer.ts";
import { lockUsers, roleIn } from "./access.ts";
import { ErrorResponses } from "./common.ts";
import { groupDetail, MAX_GROUP_MEMBERS, MAX_GROUPS_PER_PERSON, MAX_OPEN_INVITES, requireRole, resendGroupRecipes } from "./groups.ts";

/**
 * People a group admin adds by email before they have an account. They show in the group as
 * invited; after they sign in with that (verified) email they see the invite and join with a tap.
 * Joining is never automatic: admins see members' eaten meals, so the person decides.
 */

/** Invite emails one person can send in 24 hours, new and repeated together. */
export const INVITE_EMAILS_PER_DAY = 20;
/** Hours before the same person can be emailed again. */
export const RESEND_AFTER_HOURS = 24;

const enabled = () => config.features.groupEmailInvites;
function requireEnabled() {
  if (!enabled()) throw new ApiError(404, "feature_disabled", "Adding people by email is not available");
}

type PendingRow = { id: string; group_id: string; email: string; display_name: string; role: "admin" | "member"; invited_by: string | null; emailed_at: Date | null; expires_at: Date };

/** One line of plain text: names people typed must not add lines or headers to an email. */
const oneLine = (s: string) => s.replace(/[\p{Cc}\p{Zl}\p{Zp}]+/gu, " ").replace(/\s+/g, " ").trim();

export function inviteEmail(input: { to: string; inviter: string; group: string; appUrl: string }) {
  const inviter = oneLine(input.inviter) || "Someone";
  const group = oneLine(input.group);
  return {
    to: input.to,
    subject: `${inviter} added you to ${group} on The Better Plate`,
    text:
      `${inviter} added you to the group "${group}" on The Better Plate, an app for cooking at home.\n\n` +
      `To join, open ${input.appUrl} and sign in with this email address (${input.to}). You'll see the invitation after you sign in, and you choose whether to join.\n\n` +
      `If you don't know ${inviter}, you can ignore this email. We won't email you again unless someone invites you again.`,
  };
}

/** Counts invite emails this person sent in the last day; throws when the daily cap is reached. */
async function checkSendCap(db: Pick<pg.PoolClient, "query">, userId: string) {
  const { rows } = await db.query<{ n: string }>("select count(*) as n from group_invite_sends where user_id = $1 and sent_at > now() - interval '24 hours'", [userId]);
  if (Number(rows[0]!.n) >= INVITE_EMAILS_PER_DAY) {
    throw new ApiError(429, "invite_email_limit", `You can send up to ${INVITE_EMAILS_PER_DAY} invite emails a day; try again tomorrow`);
  }
}

/** Sends the invite email and records when; false if the provider failed (the admin can resend). */
async function emailInvite(pendingId: string): Promise<boolean> {
  const { rows } = await pool.query<{ email: string; group_name: string; inviter: string | null }>(
    `select p.email, g.name as group_name,
            (select display_name from group_members m where m.group_id = p.group_id and m.user_id = p.invited_by) as inviter
       from group_pending_members p join groups g on g.id = p.group_id where p.id = $1`,
    [pendingId],
  );
  const row = rows[0];
  if (!row) return false;
  try {
    await sendEmail(inviteEmail({ to: row.email, inviter: row.inviter ?? "A group admin", group: row.group_name, appUrl: config.publicAppUrl.replace(/\/$/, "") }));
  } catch (err) {
    // The provider's message never holds the address (see providerReason); log the id only.
    console.error(JSON.stringify({ level: "error", msg: "invite email failed", pendingId, error: (err as Error).message }));
    return false;
  }
  await pool.query("update group_pending_members set emailed_at = now() where id = $1", [pendingId]);
  return true;
}

/** Invites waiting for the signed-in person: only for an email they proved they own. */
export async function invitesFor(user: AuthUser): Promise<MyGroupInvite[]> {
  if (!user.emailVerified || !user.email) return [];
  const { rows } = await pool.query<PendingRow & { group_name: string; inviter: string | null }>(
    `select p.*, g.name as group_name,
            (select display_name from group_members m where m.group_id = p.group_id and m.user_id = p.invited_by) as inviter
       from group_pending_members p join groups g on g.id = p.group_id
      where p.email = lower($1) and p.expires_at > now()
        and not exists (select 1 from group_members m where m.group_id = p.group_id and m.user_id = $2)
      order by p.created_at`,
    [user.email, user.id],
  );
  return rows.map((r) => ({
    id: r.id, groupName: r.group_name, role: r.role, invitedBy: r.inviter ?? "A group admin",
    suggestedName: r.display_name, expiresAt: r.expires_at.toISOString(),
  }));
}

/** Removes invites addressed to an account's email (on account deletion). */
export async function forgetInvitesTo(email: string) {
  await pool.query("delete from group_pending_members where email = lower($1)", [email]);
}

// ---------- routes ----------

const json = <T extends z.ZodType>(schema: T) => ({ content: { "application/json": { schema } } });
const Err = (description: string) => ({ description, ...json(z.object({ error: z.any() })) });
const PendingParam = z.object({ id: z.uuid(), pendingId: z.uuid() });
const MyInviteParam = z.object({ inviteId: z.uuid() });

export const inviteRoutes = new OpenAPIHono<AppEnv>();
inviteRoutes.use("/v1/me/group-invites", rateLimit("group", 300, 60));
inviteRoutes.use("/v1/me/group-invites/*", rateLimit("group", 300, 60));

inviteRoutes.openapi(
  createRoute({
    method: "post", path: "/v1/groups/{id}/pending", tags: ["groups"], summary: "Add someone by email before they have an account",
    description:
      `They appear as invited and get one email. When they sign in with that email they see the invite and choose to join. ` +
      `The owner can add admins or members; admins can add members. Invites expire after ${PENDING_INVITE_DAYS} days. ` +
      `The answer is the same whether or not the email already has an account.`,
    request: { params: z.object({ id: z.uuid() }), body: { required: true, ...json(PendingMemberCreateSchema) } },
    responses: {
      201: { description: "Added", ...json(PendingMemberCreatedSchema) },
      403: Err("Not allowed"),
      409: Err("Already invited, or a limit reached"),
      ...ErrorResponses,
    },
  }),
  async (c) => {
    requireEnabled();
    const user = requireUser(c);
    const { id } = c.req.valid("param");
    const { email, name, role } = c.req.valid("json");
    const pendingId = crypto.randomUUID();
    await withTransaction(async (client) => {
      await requireRole(client, id, user.id, role === "admin" ? ["owner"] : ["owner", "admin"]);
      // Serializes concurrent adds to one group so the limits hold.
      await client.query("select 1 from groups where id = $1 for update", [id]);
      await client.query("delete from group_pending_members where group_id = $1 and email = $2 and expires_at <= now()", [id, email]);
      const counts = (await client.query<{ pending: string; members: string; same: string }>(
        `select (select count(*) from group_pending_members where group_id = $1) as pending,
                (select count(*) from group_members where group_id = $1) as members,
                (select count(*) from group_pending_members where group_id = $1 and email = $2) as same`,
        [id, email],
      )).rows[0]!;
      if (Number(counts.same) > 0) throw new ApiError(409, "already_invited", "This email is already invited; send the invite again instead");
      if (Number(counts.pending) >= MAX_OPEN_INVITES) throw new ApiError(409, "invite_limit", `A group can have up to ${MAX_OPEN_INVITES} people waiting to join`);
      if (Number(counts.pending) + Number(counts.members) >= MAX_GROUP_MEMBERS) throw new ApiError(409, "member_limit", `A group can have up to ${MAX_GROUP_MEMBERS} members`);
      await checkSendCap(client, user.id);
      await client.query(
        `insert into group_pending_members (id, group_id, email, display_name, role, invited_by, expires_at)
         values ($1, $2, $3, $4, $5, $6, now() + make_interval(days => $7))`,
        [pendingId, id, email, name, role, user.id, PENDING_INVITE_DAYS],
      );
      await client.query("insert into group_invite_sends (user_id, group_id) values ($1, $2)", [user.id, id]);
    });
    const emailed = await emailInvite(pendingId);
    return c.json({ group: await groupDetail(id, user.id), emailed }, 201);
  },
);

inviteRoutes.openapi(
  createRoute({
    method: "post", path: "/v1/groups/{id}/pending/{pendingId}/resend", tags: ["groups"], summary: "Email an invite again (owner or admin)",
    description: `At most once every ${RESEND_AFTER_HOURS} hours per person; the invite then lasts ${PENDING_INVITE_DAYS} more days.`,
    request: { params: PendingParam },
    responses: { 200: { description: "Sent", ...json(PendingMemberCreatedSchema) }, 403: Err("Not allowed"), ...ErrorResponses },
  }),
  async (c) => {
    requireEnabled();
    const user = requireUser(c);
    const { id, pendingId } = c.req.valid("param");
    await withTransaction(async (client) => {
      await requireRole(client, id, user.id, ["owner", "admin"]);
      const row = (await client.query<PendingRow>("select * from group_pending_members where id = $1 and group_id = $2 and expires_at > now() for update", [pendingId, id])).rows[0];
      if (!row) throw new ApiError(404, "not_found", "Invite not found");
      if (row.emailed_at && Date.now() - row.emailed_at.getTime() < RESEND_AFTER_HOURS * 3_600_000) {
        throw new ApiError(429, "resend_too_soon", `You can email this invite again ${RESEND_AFTER_HOURS} hours after the last one`);
      }
      await checkSendCap(client, user.id);
      await client.query("update group_pending_members set expires_at = now() + make_interval(days => $2) where id = $1", [pendingId, PENDING_INVITE_DAYS]);
      await client.query("insert into group_invite_sends (user_id, group_id) values ($1, $2)", [user.id, id]);
    });
    const emailed = await emailInvite(pendingId);
    return c.json({ group: await groupDetail(id, user.id), emailed }, 200);
  },
);

inviteRoutes.openapi(
  createRoute({
    method: "delete", path: "/v1/groups/{id}/pending/{pendingId}", tags: ["groups"], summary: "Take back an email invite (owner or admin)",
    request: { params: PendingParam },
    responses: { 204: { description: "Removed" }, 403: Err("Not allowed"), ...ErrorResponses },
  }),
  async (c) => {
    requireEnabled();
    const user = requireUser(c);
    const { id, pendingId } = c.req.valid("param");
    await requireRole(pool, id, user.id, ["owner", "admin"]);
    await pool.query("delete from group_pending_members where id = $1 and group_id = $2", [pendingId, id]);
    return c.body(null, 204);
  },
);

inviteRoutes.openapi(
  createRoute({
    method: "get", path: "/v1/me/group-invites", tags: ["groups"], summary: "Groups that added me by email, waiting for me to join",
    description: "Only for the email this account signed in with and proved it owns.",
    responses: { 200: { description: "Invites", ...json(z.object({ invites: z.array(MyGroupInviteSchema) })) }, ...ErrorResponses },
  }),
  async (c) => {
    requireEnabled();
    return c.json({ invites: await invitesFor(requireUser(c)) }, 200);
  },
);

async function myInvite(client: pg.PoolClient, user: AuthUser, inviteId: string) {
  if (!user.emailVerified || !user.email) throw new ApiError(404, "invite_not_found", "This invite has expired or was taken back");
  const row = (await client.query<PendingRow>(
    "select * from group_pending_members where id = $1 and email = lower($2) and expires_at > now() for update",
    [inviteId, user.email],
  )).rows[0];
  if (!row) throw new ApiError(404, "invite_not_found", "This invite has expired or was taken back");
  return row;
}

inviteRoutes.openapi(
  createRoute({
    method: "post", path: "/v1/me/group-invites/{inviteId}/join", tags: ["groups"], summary: "Join a group that added me by email",
    description: "The group's admins can then see and plan your meals, and your own plans wait for their approval (as with invite links).",
    request: { params: MyInviteParam, body: { required: true, ...json(InviteAcceptSchema) } },
    responses: { 200: { description: "Joined", ...json(GroupDetailSchema) }, 409: Err("Already in the group, or a limit reached"), ...ErrorResponses },
  }),
  async (c) => {
    requireEnabled();
    const user = requireUser(c);
    const { inviteId } = c.req.valid("param");
    const { myName } = c.req.valid("json");
    const groupId = await withTransaction(async (client) => {
      const p = await myInvite(client, user, inviteId);
      if (await roleIn(client, p.group_id, user.id)) {
        await client.query("delete from group_pending_members where id = $1", [p.id]);
        throw new ApiError(409, "already_member", "You are already in this group");
      }
      const counts = (await client.query<{ mine: string; members: string }>(
        "select (select count(*) from group_members where user_id = $1) as mine, (select count(*) from group_members where group_id = $2) as members",
        [user.id, p.group_id],
      )).rows[0]!;
      if (Number(counts.mine) >= MAX_GROUPS_PER_PERSON) throw new ApiError(409, "group_limit", `You can be in up to ${MAX_GROUPS_PER_PERSON} groups`);
      if (Number(counts.members) >= MAX_GROUP_MEMBERS) throw new ApiError(409, "member_limit", `A group can have up to ${MAX_GROUP_MEMBERS} members`);
      await lockUsers(client, [user.id]);
      await client.query("insert into group_members (group_id, user_id, role, display_name) values ($1, $2, $3, $4)", [p.group_id, user.id, p.role, myName]);
      await client.query("delete from group_pending_members where id = $1", [p.id]);
      await resendGroupRecipes(client, p.group_id);
      return p.group_id;
    });
    return c.json(await groupDetail(groupId, user.id), 200);
  },
);

inviteRoutes.openapi(
  createRoute({
    method: "post", path: "/v1/me/group-invites/{inviteId}/decline", tags: ["groups"], summary: "Turn down a group that added me by email",
    request: { params: MyInviteParam },
    responses: { 204: { description: "Declined" }, ...ErrorResponses },
  }),
  async (c) => {
    requireEnabled();
    const user = requireUser(c);
    const { inviteId } = c.req.valid("param");
    await withTransaction(async (client) => {
      const p = await myInvite(client, user, inviteId);
      await client.query("delete from group_pending_members where id = $1", [p.id]);
    });
    return c.body(null, 204);
  },
);
