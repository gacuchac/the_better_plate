import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import type pg from "pg";
import {
  FoodPreferencesSchema,
  MealFeedbackSchema,
  type FoodPreferences,
  type FoodPreferencesBody,
  type MealFeedback,
  type MealFeedbackBody,
} from "@betterplate/contracts";
import { pool } from "../db/pool.ts";
import { type AppEnv, rateLimit, requireUser } from "../lib/http.ts";
import { foodsByIds } from "./catalog.ts";
import { ErrorResponses } from "./common.ts";
import { lockUsers, profileOwner } from "./access.ts";

// ---------- service ----------

export type PreferencesRow = {
  id: string; user_id: string; profile_id: string | null; allergy_answer: FoodPreferences["allergyAnswer"]; allergens: string[];
  likes: string[]; dislikes: string[]; notes: string; version: number; server_seq: string; created_at: Date; updated_at: Date;
};

export type FeedbackRow = {
  id: string; user_id: string; profile_id: string | null; rating: MealFeedback["rating"]; comment: string; disliked_food_ids: string[];
  version: number; server_seq: string; created_at: Date; updated_at: Date; deleted_at: Date | null;
};

export function toPreferences(r: PreferencesRow): FoodPreferences {
  return {
    id: r.id, profileId: r.profile_id, allergyAnswer: r.allergy_answer, allergens: r.allergens as FoodPreferences["allergens"],
    likes: r.likes, dislikes: r.dislikes, notes: r.notes, version: r.version, updatedAt: r.updated_at.toISOString(),
  };
}

export function toFeedback(r: FeedbackRow): MealFeedback {
  return {
    id: r.id, profileId: r.profile_id, rating: r.rating, comment: r.comment, dislikedFoodIds: r.disliked_food_ids,
    version: r.version, updatedAt: r.updated_at.toISOString(),
  };
}

export type PrefsOutcome<T> =
  | { status: "applied"; version: number }
  | { status: "conflict"; server: T | null }
  | { status: "rejected"; code: string; message: string };

const notFound = { status: "rejected" as const, code: "not_found", message: "Not found" };

async function unknownFoods(ids: string[]): Promise<string[]> {
  if (!ids.length) return [];
  const found = await foodsByIds([...new Set(ids)]);
  return [...new Set(ids)].filter((id) => !found.has(id));
}

/**
 * Writes the preferences of one person into the kitchen that holds them (feedOwner): the account
 * itself (subject = its own id) or one of its profiles (subject = the profile id). Callers check
 * who may write; this checks versions and catalog foods.
 */
export async function writePreferences(
  client: pg.PoolClient,
  feedOwner: string,
  subjectId: string,
  profileId: string | null,
  baseVersion: number | null,
  body: FoodPreferencesBody,
): Promise<PrefsOutcome<FoodPreferences>> {
  const unknown = await unknownFoods([...body.likes, ...body.dislikes]);
  if (unknown.length) return { status: "rejected", code: "unknown_food", message: `Foods not in catalog: ${unknown.join(", ")}` };
  await lockUsers(client, [feedOwner]);
  const row = (await client.query<PreferencesRow>("select * from food_preferences where id = $1 for update", [subjectId])).rows[0];
  if (row && row.user_id !== feedOwner) return notFound;
  if (!row && baseVersion !== null) return { status: "conflict", server: null };
  if (row && baseVersion !== row.version) return { status: "conflict", server: toPreferences(row) };
  const version = row ? row.version + 1 : 1;
  const values = [body.allergyAnswer, body.allergens, JSON.stringify(body.likes), JSON.stringify(body.dislikes), body.notes ?? "", version];
  await client.query(
    row
      ? `update food_preferences set allergy_answer = $2, allergens = $3, likes = $4, dislikes = $5, notes = $6, version = $7,
           server_seq = nextval('change_seq'), updated_at = now() where id = $1`
      : `insert into food_preferences (id, allergy_answer, allergens, likes, dislikes, notes, version, user_id, profile_id, server_seq)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, nextval('change_seq'))`,
    row ? [subjectId, ...values] : [subjectId, ...values, feedOwner, profileId],
  );
  return { status: "applied", version };
}

/** A person's own write through sync: for themselves (entity = own id) or a profile they own. */
export async function putPreferences(
  client: pg.PoolClient,
  userId: string,
  subjectId: string,
  baseVersion: number | null,
  body: FoodPreferencesBody,
): Promise<PrefsOutcome<FoodPreferences>> {
  const profileId = body.profileId ?? null;
  if (profileId) {
    if (subjectId !== profileId || (await profileOwner(client, profileId)) !== userId) return { status: "rejected", code: "not_found", message: "Profile not found" };
  } else if (subjectId !== userId) {
    return { status: "rejected", code: "invalid_subject", message: "Preferences are saved under your own id, or a profile's id" };
  }
  return writePreferences(client, userId, subjectId, profileId, baseVersion, body);
}

/** How a logged meal went. Only for meals logged in this kitchen; removed with the log. */
export async function putFeedback(
  client: pg.PoolClient,
  userId: string,
  logId: string,
  baseVersion: number | null,
  body: MealFeedbackBody,
): Promise<PrefsOutcome<MealFeedback>> {
  const unknown = await unknownFoods(body.dislikedFoodIds);
  if (unknown.length) return { status: "rejected", code: "unknown_food", message: `Foods not in catalog: ${unknown.join(", ")}` };
  await lockUsers(client, [userId]);
  const log = (await client.query<{ user_id: string; profile_id: string | null; deleted_at: Date | null }>(
    "select user_id, profile_id, deleted_at from consumption_events where id = $1",
    [logId],
  )).rows[0];
  if (!log || log.user_id !== userId) return notFound;
  if (log.deleted_at) return { status: "rejected", code: "log_removed", message: "That meal was removed from what you ate" };
  const row = (await client.query<FeedbackRow>("select * from meal_feedback where id = $1 for update", [logId])).rows[0];
  if (!row && baseVersion !== null) return { status: "conflict", server: null };
  if (row && baseVersion !== row.version) return { status: "conflict", server: toFeedback(row) };
  const version = row ? row.version + 1 : 1;
  const values = [body.rating, body.comment ?? "", JSON.stringify(body.dislikedFoodIds ?? []), version];
  await client.query(
    row
      ? `update meal_feedback set rating = $2, comment = $3, disliked_food_ids = $4, version = $5, deleted_at = null,
           server_seq = nextval('change_seq'), updated_at = now() where id = $1`
      : `insert into meal_feedback (id, rating, comment, disliked_food_ids, version, user_id, profile_id, server_seq)
         values ($1, $2, $3, $4, $5, $6, $7, nextval('change_seq'))`,
    row ? [logId, ...values] : [logId, ...values, userId, log.profile_id],
  );
  return { status: "applied", version };
}

/** Everyone's preferences held in one kitchen: the account's own and its profiles'. */
export async function preferencesIn(userId: string): Promise<FoodPreferences[]> {
  const { rows } = await pool.query<PreferencesRow>("select * from food_preferences where user_id = $1 order by created_at", [userId]);
  return rows.map(toPreferences);
}

// ---------- routes ----------

export const preferenceRoutes = new OpenAPIHono<AppEnv>();
preferenceRoutes.use("/v1/preferences", rateLimit("preferences", 120, 60));
preferenceRoutes.use("/v1/meal-feedback", rateLimit("preferences", 120, 60));

preferenceRoutes.openapi(
  createRoute({
    method: "get", path: "/v1/preferences", tags: ["preferences"],
    summary: "Food preferences in my kitchen: mine and my profiles'",
    description:
      "Allergies, likes and dislikes as people stated them. The app always asks about allergies and records the answer; it never infers or diagnoses. " +
      "Writes go through POST /v1/sync/batch (prefs.put).",
    responses: { 200: { description: "Preferences", content: { "application/json": { schema: z.object({ preferences: z.array(FoodPreferencesSchema) }) } } }, ...ErrorResponses },
  }),
  async (c) => c.json({ preferences: await preferencesIn(requireUser(c).id) }, 200),
);

preferenceRoutes.openapi(
  createRoute({
    method: "get", path: "/v1/meal-feedback", tags: ["preferences"],
    summary: "How my logged meals went (and my profiles')",
    description: "Liked or not, a comment and ingredients not liked, one per eaten log. Writes go through POST /v1/sync/batch (feedback.put).",
    responses: { 200: { description: "Feedback", content: { "application/json": { schema: z.object({ feedback: z.array(MealFeedbackSchema) }) } } }, ...ErrorResponses },
  }),
  async (c) => {
    const { rows } = await pool.query<FeedbackRow>("select * from meal_feedback where user_id = $1 and deleted_at is null order by updated_at desc limit 1000", [requireUser(c).id]);
    return c.json({ feedback: rows.map(toFeedback) }, 200);
  },
);
