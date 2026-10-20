import { deleteDB, openDB, type DBSchema, type IDBPDatabase } from "idb";
import type {
  FoodPreferences,
  FoodPreferencesBody,
  Goal,
  GoalBody,
  GroupSummary,
  MealFeedback,
  MealFeedbackBody,
  MealLogBody,
  PlannedMeal,
  PlannedMealBody,
  PlanStatus,
  Profile,
  Recipe,
  RecipeBody,
  RecipeNutritionDto,
  SyncOperation,
} from "@betterplate/contracts";
import type { CatalogBundle } from "./api.ts";

/**
 * Local-first storage.
 * - One personal database per account ("betterplate-user-<id>"), deleted on sign-out, so
 *   records never leak between accounts on a shared device.
 * - One shared, non-personal catalog database for the USDA foods.
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
  /** A group's recipe: members read it, the group's admins edit it. */
  groupId?: string | null;
}

/** What the server says about a plan beyond its body: who planned it and whether it is approved. */
export interface PlanMeta {
  status: PlanStatus;
  groupId: string | null;
  plannedBy: string | null;
}

export interface LocalPlan {
  id: string;
  body: PlannedMealBody;
  serverVersion: number | null;
  state: RecipeSyncState;
  conflictServer?: PlannedMeal | null;
  rejection?: string;
  deleted?: boolean;
  updatedAt: string;
  /** Known once the server has the plan; absent for a plan only on this device. */
  meta?: PlanMeta;
}

/** A consumption goal the person set; versioned like plans. */
export interface LocalGoal {
  id: string;
  body: GoalBody;
  serverVersion: number | null;
  state: RecipeSyncState;
  conflictServer?: Goal | null;
  rejection?: string;
  deleted?: boolean;
  updatedAt: string;
}

/** Food eaten. Created once, never edited; "deleted" marks a retraction waiting to sync. */
export interface LocalLog {
  id: string;
  body: MealLogBody;
  state: "pending" | "synced" | "rejected";
  /** Server's immutable snapshot once acknowledged; before that the device computes a preview. */
  nutrition?: RecipeNutritionDto;
  rejection?: string;
  deleted?: boolean;
  createdAt: string;
}

/** Allergies, likes and dislikes as a person told us; id is the account's own id or a profile's. */
export interface LocalPreferences {
  id: string;
  body: FoodPreferencesBody;
  serverVersion: number | null;
  state: RecipeSyncState;
  conflictServer?: FoodPreferences | null;
  rejection?: string;
  updatedAt: string;
}

/** How a logged meal went; id is the eaten log's id. */
export interface LocalFeedback {
  id: string;
  body: MealFeedbackBody;
  serverVersion: number | null;
  state: RecipeSyncState;
  conflictServer?: MealFeedback | null;
  rejection?: string;
  updatedAt: string;
}

export type LocalProfile = Profile;

export interface OutboxOp {
  opId: string;
  entityId: string;
  type: SyncOperation["type"];
  baseVersion: number | null;
  body?: RecipeBody | PlannedMealBody | MealLogBody | GoalBody | FoodPreferencesBody | MealFeedbackBody;
  createdAt: string;
  seq: number;
}

export interface UserDB extends DBSchema {
  recipes: { key: string; value: LocalRecipe; indexes: { byUpdated: string } };
  plans: { key: string; value: LocalPlan };
  logs: { key: string; value: LocalLog };
  goals: { key: string; value: LocalGoal };
  prefs: { key: string; value: LocalPreferences };
  feedback: { key: string; value: LocalFeedback };
  profiles: { key: string; value: LocalProfile };
  outbox: { key: string; value: OutboxOp; indexes: { byEntity: string; bySeq: number } };
  meta: { key: string; value: unknown };
}

/** The groups this account is in, as last seen online (kept in the meta store). */
export type CachedGroups = GroupSummary[];

interface CatalogDB extends DBSchema {
  catalog: { key: string; value: CatalogBundle };
}

export type UserDatabase = IDBPDatabase<UserDB>;

export const userDbName = (userId: string) => `betterplate-user-${userId}`;

const seenKey = (userId: string) => `bp.db-seen.${userId}`;

/**
 * Opens the account's database. If this device held it before (a marker in localStorage) but
 * it comes back empty, the browser evicted it; onEvicted lets the app tell the person.
 */
export function openUserDb(userId: string, onEvicted?: () => void): Promise<UserDatabase> {
  return openDB<UserDB>(userDbName(userId), 4, {
    upgrade(db, oldVersion) {
      if (oldVersion === 0) {
        try {
          if (localStorage.getItem(seenKey(userId))) onEvicted?.();
          localStorage.setItem(seenKey(userId), "1");
        } catch {
          // Storage blocked: nothing to compare against.
        }
      }
      if (oldVersion < 1) {
        db.createObjectStore("recipes", { keyPath: "id" }).createIndex("byUpdated", "updatedAt");
        const outbox = db.createObjectStore("outbox", { keyPath: "opId" });
        outbox.createIndex("byEntity", "entityId");
        outbox.createIndex("bySeq", "seq");
        db.createObjectStore("meta");
      }
      if (oldVersion < 2) {
        db.createObjectStore("plans", { keyPath: "id" });
        db.createObjectStore("logs", { keyPath: "id" });
      }
      if (oldVersion < 3) db.createObjectStore("goals", { keyPath: "id" });
      if (oldVersion < 4) {
        db.createObjectStore("prefs", { keyPath: "id" });
        db.createObjectStore("feedback", { keyPath: "id" });
        db.createObjectStore("profiles", { keyPath: "id" });
      }
    },
  });
}

export async function deleteUserDb(userId: string): Promise<void> {
  try {
    localStorage.removeItem(seenKey(userId));
  } catch {
    // ignore
  }
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

/** True when the browser refused a write because the device or origin is out of space. */
export function isQuotaError(err: unknown): boolean {
  const name = (err as { name?: string } | null)?.name;
  return name === "QuotaExceededError" || name === "NS_ERROR_DOM_QUOTA_REACHED";
}

export const STORAGE_FULL_EVENT = "bp:storage-full";

export async function storageInfo(): Promise<{ persisted: boolean | null; usage: number | null; quota: number | null }> {
  try {
    const [persisted, estimate] = await Promise.all([navigator.storage?.persisted?.() ?? null, navigator.storage?.estimate?.() ?? null]);
    return { persisted, usage: estimate?.usage ?? null, quota: estimate?.quota ?? null };
  } catch {
    return { persisted: null, usage: null, quota: null };
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
