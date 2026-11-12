import type pg from "pg";
import type { RecipeFavorite, RecipeFavoriteBody } from "@betterplate/contracts";
import { READABLE_RECIPES } from "./access.ts";
import { lockUser } from "./recipes.ts";

// ---------- service ----------
// Favorites are personal, even for a group recipe, and sync like water: create-only records with
// tombstones. Writes go through POST /v1/sync/batch (favorite.create, favorite.delete).

export const FAVORITE_COLUMNS = "id, user_id, recipe_id, server_seq, created_at, deleted_at";

type FavoriteRow = { id: string; user_id: string; recipe_id: string; server_seq: string; created_at: Date; deleted_at: Date | null };

export function toFavorite(r: FavoriteRow): RecipeFavorite {
  return { id: r.id, recipeId: r.recipe_id, createdAt: r.created_at.toISOString() };
}

export type FavoriteOutcome = { status: "applied" } | { status: "rejected"; code: string; message: string };

const notFound = { status: "rejected" as const, code: "not_found", message: "Not found" };

/**
 * Marks a recipe the person can open as a favorite. Replaying the same id is a no-op. If another
 * device already favorited the same recipe under another id, that record is retired so the newest
 * tap's id is the one both devices keep.
 */
export async function createFavorite(client: pg.PoolClient, userId: string, id: string, body: RecipeFavoriteBody): Promise<FavoriteOutcome> {
  await lockUser(client, userId);
  const existing = (await client.query<{ user_id: string }>("select user_id from recipe_favorites where id = $1", [id])).rows[0];
  if (existing) return existing.user_id === userId ? { status: "applied" } : notFound;
  const readable = await client.query(`select 1 from recipes where id = $2 and deleted_at is null and ${READABLE_RECIPES}`, [userId, body.recipeId]);
  if (readable.rowCount === 0) return notFound;
  await client.query(
    "update recipe_favorites set server_seq = nextval('change_seq'), deleted_at = now() where user_id = $1 and recipe_id = $2 and deleted_at is null",
    [userId, body.recipeId],
  );
  await client.query("insert into recipe_favorites (id, user_id, recipe_id, server_seq) values ($1, $2, $3, nextval('change_seq'))", [id, userId, body.recipeId]);
  return { status: "applied" };
}

/** Removes a favorite; a tombstone stays for sync. */
export async function deleteFavorite(client: pg.PoolClient, userId: string, id: string): Promise<FavoriteOutcome> {
  await lockUser(client, userId);
  const row = (await client.query<{ user_id: string; deleted_at: Date | null }>("select user_id, deleted_at from recipe_favorites where id = $1 for update", [id])).rows[0];
  if (row && row.user_id !== userId) return notFound;
  if (!row || row.deleted_at) return { status: "applied" };
  await client.query("update recipe_favorites set server_seq = nextval('change_seq'), deleted_at = now() where id = $1", [id]);
  return { status: "applied" };
}
