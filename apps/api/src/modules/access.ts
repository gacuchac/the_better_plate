import type pg from "pg";
import type { GroupRole } from "@betterplate/contracts";
import { pool } from "../db/pool.ts";

type Db = Pick<pg.PoolClient, "query">;

/**
 * Serializes writes to the change feeds of several accounts at once, in a fixed order so two
 * transactions never wait on each other. A write that shows up in someone's feed takes that
 * someone's lock, so their feed's sequence order stays equal to commit order.
 */
export async function lockUsers(client: Db, userIds: Iterable<string>) {
  for (const id of [...new Set(userIds)].sort()) {
    await client.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [id]);
  }
}

/** The caller's role in a group, or null when they are not a person in it. */
export async function roleIn(db: Db, groupId: string, userId: string): Promise<GroupRole | null> {
  const { rows } = await db.query<{ role: GroupRole }>("select role from group_members where group_id = $1 and user_id = $2", [groupId, userId]);
  return rows[0]?.role ?? null;
}

export const isAdminRole = (role: GroupRole | null) => role === "owner" || role === "admin";

/** People (accounts) in a group; their kitchens receive the group's recipes. */
export async function groupUserIds(db: Db, groupId: string): Promise<string[]> {
  const { rows } = await db.query<{ user_id: string }>("select user_id from group_members where group_id = $1 and user_id is not null", [groupId]);
  return rows.map((r) => r.user_id);
}

/**
 * A person whose own meals a group plans: they are a plain member (not owner or admin) of at least
 * one group. Plans they make for themselves wait for an admin's approval.
 */
export async function isManagedPerson(db: Db, userId: string): Promise<boolean> {
  const { rows } = await db.query("select 1 from group_members where user_id = $1 and role = 'member' limit 1", [userId]);
  return rows.length > 0;
}

/** True when the actor is an owner or admin of a group the person (as a plain member) belongs to. */
export async function adminsPerson(db: Db, actorId: string, personId: string): Promise<boolean> {
  const { rows } = await db.query(
    `select 1 from group_members a join group_members p on p.group_id = a.group_id
      where a.user_id = $1 and a.role in ('owner', 'admin') and p.user_id = $2 limit 1`,
    [actorId, personId],
  );
  return rows.length > 0;
}

/** True when the actor is an owner or admin of a group the profile belongs to. */
export async function adminsProfile(db: Db, actorId: string, profileId: string): Promise<boolean> {
  const { rows } = await db.query(
    `select 1 from group_members a join group_members p on p.group_id = a.group_id
      where a.user_id = $1 and a.role in ('owner', 'admin') and p.profile_id = $2 limit 1`,
    [actorId, profileId],
  );
  return rows.length > 0;
}

/** The account that owns a live profile, or null. */
export async function profileOwner(db: Db, profileId: string): Promise<string | null> {
  const { rows } = await db.query<{ owner_user_id: string }>("select owner_user_id from profiles where id = $1 and deleted_at is null", [profileId]);
  return rows[0]?.owner_user_id ?? null;
}

/** Recipes a person can read: their own and those of every group they belong to. */
export const READABLE_RECIPES = `(user_id = $1 or group_id in (select group_id from group_members where user_id = $1))`;

export async function groupsOf(userId: string): Promise<string[]> {
  const { rows } = await pool.query<{ group_id: string }>("select group_id from group_members where user_id = $1", [userId]);
  return rows.map((r) => r.group_id);
}
