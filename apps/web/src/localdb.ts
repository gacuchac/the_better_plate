import { deleteDB, openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { Recipe, RecipeBody } from "@betterplate/contracts";
import type { CatalogBundle } from "./api.ts";

/**
 * Local-first storage.
 * - One personal database per account ("betterplate-user-<id>"), deleted on sign-out, so
 *   records never leak between accounts on a shared device.
 * - One shared, non-personal catalog database for the USDA starter foods.
 */

export type RecipeSyncState = "pending" | "synced" | "conflict" | "rejected";

export interface LocalRecipe {
  id: string;
  body: RecipeBody;
  /** Server version this local content was based on; null if never synced. */
  serverVersion: number | null;
  state: RecipeSyncState;
  conflictServer?: Recipe | null;
  rejection?: string;
  /** Deleted on this device; kept as a marker until the server acknowledges. */
  deleted?: boolean;
  updatedAt: string;
}

export interface OutboxOp {
  opId: string;
  entityId: string;
  type: "recipe.put" | "recipe.delete";
  baseVersion: number | null;
  body?: RecipeBody;
  createdAt: string;
  seq: number;
}

interface UserDB extends DBSchema {
  recipes: { key: string; value: LocalRecipe; indexes: { byUpdated: string } };
  outbox: { key: string; value: OutboxOp; indexes: { byEntity: string; bySeq: number } };
  meta: { key: string; value: unknown };
}

interface CatalogDB extends DBSchema {
  catalog: { key: string; value: CatalogBundle };
}

export type UserDatabase = IDBPDatabase<UserDB>;

export const userDbName = (userId: string) => `betterplate-user-${userId}`;

export function openUserDb(userId: string): Promise<UserDatabase> {
  return openDB<UserDB>(userDbName(userId), 1, {
    upgrade(db) {
      db.createObjectStore("recipes", { keyPath: "id" }).createIndex("byUpdated", "updatedAt");
      const outbox = db.createObjectStore("outbox", { keyPath: "opId" });
      outbox.createIndex("byEntity", "entityId");
      outbox.createIndex("bySeq", "seq");
      db.createObjectStore("meta");
    },
  });
}

export async function deleteUserDb(userId: string): Promise<void> {
  await deleteDB(userDbName(userId));
}

function openCatalogDb() {
  return openDB<CatalogDB>("betterplate-catalog", 1, {
    upgrade(db) {
      db.createObjectStore("catalog");
    },
  });
}

export async function readCatalog(): Promise<CatalogBundle | undefined> {
  const db = await openCatalogDb();
  try {
    return await db.get("catalog", "current");
  } finally {
    db.close();
  }
}

export async function writeCatalog(bundle: CatalogBundle): Promise<void> {
  const db = await openCatalogDb();
  try {
    await db.put("catalog", bundle, "current");
  } finally {
    db.close();
  }
}

/** Ask the browser not to evict local data under storage pressure (best effort). */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}
