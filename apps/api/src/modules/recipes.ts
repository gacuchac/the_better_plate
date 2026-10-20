import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import type pg from "pg";
import {
  RecipeBodySchema,
  RecipeIngredientSchema,
  RecipeNutritionSchema,
  RecipeSchema,
  type Recipe,
  type RecipeBody,
  type RecipeNutritionDto,
} from "@betterplate/contracts";
import { calculateRecipe } from "@betterplate/nutrition";
import { pool, withTransaction } from "../db/pool.ts";
import { ApiError, type AppEnv, rateLimit, requireUser } from "../lib/http.ts";
import { currentCatalog, foodsByIds } from "./catalog.ts";
import { ErrorResponses, IdParam } from "./common.ts";
import { resolveRecipeImage } from "./images.ts";
import { groupUserIds, isAdminRole, lockUsers, READABLE_RECIPES, roleIn } from "./access.ts";

// ---------- service ----------

type RecipeRow = {
  id: string;
  user_id: string;
  group_id: string | null;
  title: string;
  servings: string;
  body: { ingredients?: RecipeBody["ingredients"]; method?: string; description?: string; image?: RecipeBody["image"] };
  nutrition: RecipeNutritionDto | null;
  version: number;
  server_seq: string;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
};

export function toRecipe(r: RecipeRow): Recipe {
  return {
    id: r.id,
    groupId: r.group_id ?? null,
    title: r.title,
    servings: Number(r.servings),
    ingredients: r.body.ingredients ?? [],
    description: r.body.description ?? "",
    method: r.body.method ?? "",
    image: r.body.image ?? null,
    version: r.version,
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
    nutrition: r.nutrition,
  };
}

export type WriteOutcome =
  | { status: "applied"; version: number; recipe: Recipe | null }
  | { status: "conflict"; server: Recipe | null }
  | { status: "rejected"; code: string; message: string };

/**
 * Authoritative nutrition: recomputed on the server from catalog records, never trusted
 * from the client. Unknown foods are rejected so a recipe cannot reference made-up data.
 */
export async function computeNutrition(input: Pick<RecipeBody, "servings" | "ingredients">) {
  const ids = [...new Set(input.ingredients.map((i) => i.foodId))];
  const [foods, catalog] = await Promise.all([foodsByIds(ids), currentCatalog()]);
  const unknown = ids.filter((id) => !foods.has(id));
  if (unknown.length) return { ok: false as const, unknown };
  const result = calculateRecipe(input, foods, catalog.nutrients);
  const nutrition: RecipeNutritionDto = {
    engineVersion: result.engineVersion,
    catalogVersion: catalog.version,
    servings: result.servings,
    totals: result.totals,
    perServing: result.perServing,
    disclosures: result.disclosures,
  };
  return { ok: true as const, nutrition, ingredients: result.ingredients };
}

/** Serializes one user's writes so change-feed sequence order equals commit order for that user. */
export async function lockUser(client: pg.PoolClient, userId: string) {
  await lockUsers(client, [userId]);
}

async function loadForWrite(client: pg.PoolClient, id: string) {
  const { rows } = await client.query<RecipeRow>("select * from recipes where id = $1 for update", [id]);
  return rows[0];
}

/**
 * Takes the change-feed locks a write to this recipe needs: the writer's, and for a group recipe
 * every person in the group (they all receive it), then loads the row for update.
 */
async function lockAndLoad(client: pg.PoolClient, userId: string, id: string) {
  const pre = (await client.query<{ group_id: string | null }>("select group_id from recipes where id = $1", [id])).rows[0];
  await lockUsers(client, [userId, ...(pre?.group_id ? await groupUserIds(client, pre.group_id) : [])]);
  return loadForWrite(client, id);
}

/** Own recipes are writable by their owner; group recipes by the group's owner and admins. */
async function writeDenied(client: pg.PoolClient, userId: string, row: RecipeRow): Promise<WriteOutcome | null> {
  if (row.user_id === userId && !row.group_id) return null;
  const role = row.group_id ? await roleIn(client, row.group_id, userId) : null;
  if (isAdminRole(role)) return null;
  if (role === "member") return { status: "rejected", code: "read_only", message: "Only the group's admins can change its recipes" };
  // Never reveal that another user's recipe exists.
  return { status: "rejected", code: "not_found", message: "Recipe not found" };
}

export async function putRecipe(
  client: pg.PoolClient,
  userId: string,
  id: string,
  baseVersion: number | null,
  body: RecipeBody,
): Promise<WriteOutcome> {
  const row = await lockAndLoad(client, userId, id);
  const denied = row && (await writeDenied(client, userId, row));
  if (denied) return denied;
  if (!row && baseVersion !== null) return { status: "conflict", server: null };
  if (row && row.deleted_at) return { status: "conflict", server: null };
  if (row && baseVersion !== row.version) return { status: "conflict", server: toRecipe(row) };

  const calc = await computeNutrition(body);
  if (!calc.ok) return { status: "rejected", code: "unknown_food", message: `Foods not in catalog: ${calc.unknown.join(", ")}` };

  // A photo already on the recipe stays (in a group it may be another admin's); a new one must be the
  // writer's own. One that isn't (or was cleaned up while a device was offline) is dropped, not the recipe.
  const kept = row?.body.image && body.image?.id === row.body.image.id ? { ...row.body.image, alt: body.image.alt } : null;
  const image = kept ? { ok: true as const, image: kept } : await resolveRecipeImage(client, userId, body.image);

  const version = row ? row.version + 1 : 1;
  const stored = { ingredients: body.ingredients, description: body.description, method: body.method, image: image.ok ? image.image : null };
  const values = [body.title, body.servings, JSON.stringify(stored), JSON.stringify(calc.nutrition), version];
  // The owner and group stay as they are on edits: an admin editing a group recipe does not take it over.
  const { rows } = row
    ? await client.query<RecipeRow>(
        `update recipes set title = $2, servings = $3, body = $4, nutrition = $5, version = $6, server_seq = nextval('change_seq'), updated_at = now()
         where id = $1 returning *`,
        [id, ...values],
      )
    : await client.query<RecipeRow>(
        `insert into recipes (id, user_id, title, servings, body, nutrition, version, server_seq)
         values ($1, $2, $3, $4, $5, $6, $7, nextval('change_seq')) returning *`,
        [id, userId, ...values],
      );
  await client.query(
    `insert into recipe_revisions (recipe_id, version, user_id, body, nutrition, catalog_version) values ($1, $2, $3, $4, $5, $6)`,
    [id, version, userId, JSON.stringify({ title: body.title, servings: body.servings, ...stored }), JSON.stringify(calc.nutrition), calc.nutrition.catalogVersion],
  );
  return { status: "applied", version, recipe: toRecipe(rows[0]!) };
}

export async function deleteRecipe(client: pg.PoolClient, userId: string, id: string, baseVersion: number | null): Promise<WriteOutcome> {
  const row = await lockAndLoad(client, userId, id);
  const denied = row && (await writeDenied(client, userId, row));
  if (denied) return denied;
  if (!row) return { status: "applied", version: 0, recipe: null };
  if (row.deleted_at) return { status: "applied", version: row.version, recipe: null };
  if (baseVersion !== row.version) return { status: "conflict", server: toRecipe(row) };
  const version = row.version + 1;
  // Tombstone: content is cleared; only id, version and sequence remain for sync.
  await client.query(
    `update recipes set title = '', body = '{}'::jsonb, nutrition = null, version = $2, server_seq = nextval('change_seq'), updated_at = now(), deleted_at = now()
     where id = $1`,
    [id, version],
  );
  await client.query(`insert into recipe_revisions (recipe_id, version, user_id, deleted) values ($1, $2, $3, true)`, [id, version, userId]);
  // A deleted recipe's share links stop working and their snapshots are erased.
  await client.query(`update share_snapshots set revoked_at = now(), snapshot = '{}'::jsonb where recipe_id = $1 and revoked_at is null`, [id]);
  return { status: "applied", version, recipe: null };
}

/** A recipe the person owns (not a group recipe someone else created). */
export async function getRecipe(userId: string, id: string): Promise<Recipe | null> {
  const { rows } = await pool.query<RecipeRow>("select * from recipes where id = $1 and user_id = $2 and deleted_at is null", [id, userId]);
  return rows[0] ? toRecipe(rows[0]) : null;
}

/** A recipe the person can read: their own, or one of a group they belong to. */
export async function getReadableRecipe(userId: string, id: string): Promise<Recipe | null> {
  const { rows } = await pool.query<RecipeRow>(`select * from recipes where id = $2 and deleted_at is null and ${READABLE_RECIPES}`, [userId, id]);
  return rows[0] ? toRecipe(rows[0]) : null;
}

function parseIfMatch(header: string | undefined): number {
  if (!header) throw new ApiError(428, "precondition_required", "Send If-Match with the recipe version you edited");
  const m = /^(?:W\/)?"?v?(\d+)"?$/.exec(header.trim());
  if (!m) throw new ApiError(400, "invalid_if_match", 'If-Match must be the ETag, e.g. "v3"');
  return Number(m[1]);
}

function throwFor(outcome: Exclude<WriteOutcome, { status: "applied" }>): never {
  if (outcome.status === "conflict") {
    throw new ApiError(412, "version_conflict", "This recipe changed elsewhere; reload and choose which version to keep", { server: outcome.server });
  }
  throw new ApiError(outcome.code === "not_found" ? 404 : outcome.code === "read_only" ? 403 : 422, outcome.code, outcome.message);
}

// ---------- routes ----------

const json = <T extends z.ZodType>(schema: T) => ({ content: { "application/json": { schema } } });
const RecipeListSchema = z.object({ recipes: z.array(RecipeSchema) });
const CreateRecipeSchema = RecipeBodySchema.extend({ id: z.uuid().optional() });
const CalculateSchema = z.object({ servings: z.number().positive().max(100), ingredients: z.array(RecipeIngredientSchema).max(100) });
const etagHeader = { ETag: { schema: { type: "string" as const }, description: 'Recipe version, e.g. "v3"' } };

export const recipeRoutes = new OpenAPIHono<AppEnv>();
recipeRoutes.use("/v1/recipes/*", rateLimit("recipe", 600, 60));
recipeRoutes.use("/v1/recipes", rateLimit("recipe", 600, 60));

recipeRoutes.openapi(
  createRoute({
    method: "get", path: "/v1/recipes", tags: ["recipes"], summary: "List my recipes and my groups' recipes",
    responses: { 200: { description: "Recipes", ...json(RecipeListSchema) }, ...ErrorResponses },
  }),
  async (c) => {
    const user = requireUser(c);
    const { rows } = await pool.query<RecipeRow>(
      `select * from recipes where ${READABLE_RECIPES} and deleted_at is null order by updated_at desc limit 500`,
      [user.id],
    );
    return c.json({ recipes: rows.map(toRecipe) }, 200);
  },
);

recipeRoutes.openapi(
  createRoute({
    method: "post", path: "/v1/recipes", tags: ["recipes"], summary: "Create a recipe (client may supply its local UUID)",
    request: { body: { required: true, ...json(CreateRecipeSchema) } },
    responses: {
      201: { description: "Created", headers: etagHeader, ...json(RecipeSchema) },
      409: { description: "A recipe with this id already exists", ...json(z.object({ error: z.any() })) },
      422: { description: "References foods not in the catalog", ...json(z.object({ error: z.any() })) },
      ...ErrorResponses,
    },
  }),
  async (c) => {
    const user = requireUser(c);
    const { id, ...body } = c.req.valid("json");
    const outcome = await withTransaction((client) => putRecipe(client, user.id, id ?? crypto.randomUUID(), null, body));
    if (outcome.status === "conflict") throw new ApiError(409, "already_exists", "A recipe with this id already exists");
    if (outcome.status !== "applied") throwFor(outcome);
    c.header("ETag", `"v${outcome.version}"`);
    return c.json(outcome.recipe!, 201);
  },
);

recipeRoutes.openapi(
  createRoute({
    method: "post", path: "/v1/recipes/calculate", tags: ["recipes"], summary: "Preview nutrition without saving",
    request: { body: { required: true, ...json(CalculateSchema) } },
    responses: {
      200: { description: "Nutrition estimate", ...json(RecipeNutritionSchema) },
      422: { description: "References foods not in the catalog", ...json(z.object({ error: z.any() })) },
      ...ErrorResponses,
    },
  }),
  async (c) => {
    requireUser(c);
    const calc = await computeNutrition(c.req.valid("json"));
    if (!calc.ok) throw new ApiError(422, "unknown_food", `Foods not in catalog: ${calc.unknown.join(", ")}`);
    return c.json(calc.nutrition, 200);
  },
);

recipeRoutes.openapi(
  createRoute({
    method: "get", path: "/v1/recipes/{id}", tags: ["recipes"], summary: "Get one of my recipes, or one of my groups'",
    request: { params: IdParam },
    responses: { 200: { description: "Recipe", headers: etagHeader, ...json(RecipeSchema) }, ...ErrorResponses },
  }),
  async (c) => {
    const user = requireUser(c);
    const recipe = await getReadableRecipe(user.id, c.req.valid("param").id);
    if (!recipe) throw new ApiError(404, "not_found", "Recipe not found");
    c.header("ETag", `"v${recipe.version}"`);
    return c.json(recipe, 200);
  },
);

recipeRoutes.openapi(
  createRoute({
    method: "put", path: "/v1/recipes/{id}", tags: ["recipes"], summary: "Replace a recipe (If-Match version required)",
    request: { params: IdParam, headers: z.object({ "if-match": z.string().optional() }), body: { required: true, ...json(RecipeBodySchema) } },
    responses: {
      200: { description: "Updated", headers: etagHeader, ...json(RecipeSchema) },
      403: { description: "A group recipe, and you are not one of the group's admins", ...json(z.object({ error: z.any() })) },
      412: { description: "Version conflict; details.server holds the current copy", ...json(z.object({ error: z.any() })) },
      428: { description: "If-Match missing", ...json(z.object({ error: z.any() })) },
      ...ErrorResponses,
    },
  }),
  async (c) => {
    const user = requireUser(c);
    const base = parseIfMatch(c.req.header("if-match"));
    const outcome = await withTransaction((client) => putRecipe(client, user.id, c.req.valid("param").id, base, c.req.valid("json")));
    if (outcome.status !== "applied") {
      if (outcome.status === "conflict" && outcome.server === null) throw new ApiError(404, "not_found", "Recipe not found");
      throwFor(outcome);
    }
    c.header("ETag", `"v${outcome.version}"`);
    return c.json(outcome.recipe!, 200);
  },
);

recipeRoutes.openapi(
  createRoute({
    method: "delete", path: "/v1/recipes/{id}", tags: ["recipes"], summary: "Delete a recipe (If-Match version required)",
    request: { params: IdParam, headers: z.object({ "if-match": z.string().optional() }) },
    responses: {
      204: { description: "Deleted" },
      403: { description: "A group recipe, and you are not one of the group's admins", ...json(z.object({ error: z.any() })) },
      412: { description: "Version conflict", ...json(z.object({ error: z.any() })) },
      428: { description: "If-Match missing", ...json(z.object({ error: z.any() })) },
      ...ErrorResponses,
    },
  }),
  async (c) => {
    const user = requireUser(c);
    const id = c.req.valid("param").id;
    const base = parseIfMatch(c.req.header("if-match"));
    if (!(await getReadableRecipe(user.id, id))) throw new ApiError(404, "not_found", "Recipe not found");
    const outcome = await withTransaction((client) => deleteRecipe(client, user.id, id, base));
    if (outcome.status !== "applied") throwFor(outcome);
    return c.body(null, 204);
  },
);
