import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { ShareCreateSchema, SharedRecipeSchema, ShareSchema, type Recipe, type Share, type SharedRecipe } from "@betterplate/contracts";
import { config } from "../config.ts";
import { pool, withTransaction } from "../db/pool.ts";
import { ApiError, type AppEnv, rateLimit, requireUser } from "../lib/http.ts";
import { currentCatalog, foodsByIds } from "./catalog.ts";
import { ErrorResponses, IdParam } from "./common.ts";
import { getRecipe } from "./recipes.ts";

// ---------- service ----------

type ShareRow = {
  id: string;
  user_id: string;
  recipe_id: string;
  recipe_version: number;
  include_method: boolean;
  snapshot: Omit<SharedRecipe, "shareId" | "sharedAt" | "expiresAt">;
  created_at: Date;
  expires_at: Date | null;
  revoked_at: Date | null;
};

const SOURCE = { name: "USDA FoodData Central (SR Legacy)", url: "https://fdc.nal.usda.gov/" };

export const shareUrl = (id: string) => `${config.publicApiUrl.replace(/\/$/, "")}/s/${id}`;

function toShare(r: ShareRow): Share {
  return {
    shareId: r.id,
    recipeId: r.recipe_id,
    recipeVersion: r.recipe_version,
    title: r.snapshot.title,
    includeMethod: r.include_method,
    url: shareUrl(r.id),
    createdAt: r.created_at.toISOString(),
    expiresAt: r.expires_at?.toISOString() ?? null,
  };
}

/** Builds the snapshot from the server's copy only: the fields the owner reviewed, nothing about the owner. */
async function buildSnapshot(recipe: Recipe, includeMethod: boolean): Promise<ShareRow["snapshot"]> {
  if (!recipe.nutrition) throw new ApiError(409, "not_ready", "This recipe has no nutrition estimate yet; save it again and retry");
  const [foods, catalog] = await Promise.all([foodsByIds([...new Set(recipe.ingredients.map((i) => i.foodId))]), currentCatalog()]);
  return {
    title: recipe.title,
    servings: recipe.servings,
    ingredients: recipe.ingredients.map((i) => {
      const food = foods.get(i.foodId);
      const portion = i.unit === "portion" && i.portionIndex != null ? food?.portions[i.portionIndex] : undefined;
      return {
        id: i.id,
        foodId: i.foodId,
        name: food?.description ?? i.foodId,
        quantity: i.quantity,
        unit: i.unit,
        portionIndex: i.portionIndex ?? null,
        portionLabel: portion?.label ?? null,
        role: i.role,
        oilDiscardedGrams: i.oilDiscardedGrams ?? null,
      };
    }),
    description: recipe.description,
    method: includeMethod && recipe.method ? recipe.method : null,
    nutrition: recipe.nutrition,
    nutrientNames: Object.fromEntries(catalog.nutrients.map((n) => [n.key, n.name])),
    source: SOURCE,
  };
}

// ---------- routes ----------

const json = <T extends z.ZodType>(schema: T) => ({ content: { "application/json": { schema } } });
const ShareIdParam = z.object({ shareId: z.uuid() });
const ShareListSchema = z.object({ shares: z.array(ShareSchema) });

export const shareRoutes = new OpenAPIHono<AppEnv>();
shareRoutes.use("/v1/shares", rateLimit("share", 120, 60));
shareRoutes.use("/v1/shares/*", rateLimit("share", 120, 60));
shareRoutes.use("/v1/recipes/:id/share", rateLimit("share-create", 30, 3600));
// Public reads are keyed by IP; generous for real readers, tight enough to slow link guessing.
shareRoutes.use("/v1/shared/*", rateLimit("shared-read", 120, 60));

shareRoutes.openapi(
  createRoute({
    method: "post", path: "/v1/recipes/{id}/share", tags: ["sharing"],
    summary: "Publish a read-only snapshot of the current saved version and get its link",
    description: "Online only. The snapshot holds the title, description, servings, ingredients, the USDA-based estimate and, if chosen, the method. Anyone with the link can read it until it is revoked or expires.",
    request: { params: IdParam, body: { required: true, ...json(ShareCreateSchema) } },
    responses: { 201: { description: "Link created", ...json(ShareSchema) }, 409: { description: "Recipe not ready to share", ...json(z.object({ error: z.any() })) }, ...ErrorResponses },
  }),
  async (c) => {
    const user = requireUser(c);
    const { id } = c.req.valid("param");
    const { includeMethod, expiresInDays } = c.req.valid("json");
    const recipe = await getRecipe(user.id, id);
    if (!recipe) throw new ApiError(404, "not_found", "Recipe not found");
    const snapshot = await buildSnapshot(recipe, includeMethod);
    const { rows } = await pool.query<ShareRow>(
      `insert into share_snapshots (id, user_id, recipe_id, recipe_version, include_method, snapshot, expires_at)
       values (gen_random_uuid(), $1, $2, $3, $4, $5, case when $6::int is null then null else now() + make_interval(days => $6::int) end)
       returning *`,
      [user.id, id, recipe.version, includeMethod, JSON.stringify(snapshot), expiresInDays],
    );
    return c.json(toShare(rows[0]!), 201);
  },
);

shareRoutes.openapi(
  createRoute({
    method: "get", path: "/v1/shares", tags: ["sharing"], summary: "My active share links",
    request: { query: z.object({ recipeId: z.uuid().optional() }) },
    responses: { 200: { description: "Links", ...json(ShareListSchema) }, ...ErrorResponses },
  }),
  async (c) => {
    const user = requireUser(c);
    const { recipeId } = c.req.valid("query");
    const { rows } = await pool.query<ShareRow>(
      `select * from share_snapshots
       where user_id = $1 and revoked_at is null and (expires_at is null or expires_at > now()) and ($2::uuid is null or recipe_id = $2)
       order by created_at desc limit 200`,
      [user.id, recipeId ?? null],
    );
    return c.json({ shares: rows.map(toShare) }, 200);
  },
);

shareRoutes.openapi(
  createRoute({
    method: "delete", path: "/v1/shares/{shareId}", tags: ["sharing"], summary: "Revoke a link; the snapshot is erased",
    request: { params: ShareIdParam },
    responses: { 204: { description: "Revoked (also when already revoked)" }, ...ErrorResponses },
  }),
  async (c) => {
    const user = requireUser(c);
    const { shareId } = c.req.valid("param");
    const found = await withTransaction(async (client) => {
      const { rows } = await client.query<{ user_id: string }>("select user_id from share_snapshots where id = $1 for update", [shareId]);
      if (!rows[0] || rows[0].user_id !== user.id) return false;
      await client.query(`update share_snapshots set revoked_at = coalesce(revoked_at, now()), snapshot = '{}'::jsonb where id = $1`, [shareId]);
      return true;
    });
    // Never reveal that someone else's link exists.
    if (!found) throw new ApiError(404, "not_found", "Link not found");
    return c.body(null, 204);
  },
);

export async function readShared(shareId: string): Promise<SharedRecipe | null> {
  const { rows } = await pool.query<ShareRow>(
    "select * from share_snapshots where id = $1 and revoked_at is null and (expires_at is null or expires_at > now())",
    [shareId],
  );
  const r = rows[0];
  if (!r) return null;
  // Links made before recipes had a description carry none.
  return { shareId: r.id, ...r.snapshot, description: r.snapshot.description ?? "", sharedAt: r.created_at.toISOString(), expiresAt: r.expires_at?.toISOString() ?? null };
}

shareRoutes.openapi(
  createRoute({
    method: "get", path: "/v1/shared/{shareId}", tags: ["sharing"], summary: "Read a shared recipe (no sign-in)",
    description: "Returns only the approved snapshot fields. Revoked, expired and unknown links all answer 404.",
    request: { params: ShareIdParam },
    responses: { 200: { description: "Shared recipe", ...json(SharedRecipeSchema) }, ...ErrorResponses },
  }),
  async (c) => {
    const shared = await readShared(c.req.valid("param").shareId);
    // A revoked link must stop working everywhere, so nothing may cache it.
    c.header("Cache-Control", "no-store");
    c.header("X-Robots-Tag", "noindex");
    if (!shared) throw new ApiError(404, "not_found", "This link was revoked, expired or never existed");
    return c.json(shared, 200);
  },
);

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);

/**
 * Link-preview page for /s/{id}: messaging apps read its title and description, people are sent
 * on to the app. It is outside /v1 because it is a page, not part of the API contract.
 */
export const sharePageRoutes = new OpenAPIHono<AppEnv>();
sharePageRoutes.use("/s/*", rateLimit("shared-read", 120, 60));
sharePageRoutes.get("/s/:shareId", async (c) => {
  const shareId = c.req.param("shareId");
  const valid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(shareId);
  const shared = valid ? await readShared(shareId) : null;
  const target = `${config.publicAppUrl.replace(/\/$/, "")}/#/shared/${valid ? shareId : "missing"}`;
  const title = shared ? `${shared.title} · The Better Plate` : "The Better Plate";
  const description = shared
    ? shared.description ||
      `A recipe for ${shared.servings} ${shared.servings === 1 ? "serving" : "servings"} with ${shared.ingredients.length} ingredients and an estimated nutrition breakdown from USDA data.`
    : "This link was revoked, expired or never existed.";
  c.header("Cache-Control", "no-store");
  c.header("X-Robots-Tag", "noindex");
  c.header("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'");
  const t = escapeHtml(title);
  const d = escapeHtml(description);
  const href = escapeHtml(target);
  return c.html(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
      `<title>${t}</title><meta name="description" content="${d}"><meta name="robots" content="noindex">` +
      `<meta property="og:type" content="article"><meta property="og:title" content="${t}"><meta property="og:description" content="${d}">` +
      `<meta property="og:site_name" content="The Better Plate"><meta name="twitter:card" content="summary">` +
      `<meta http-equiv="refresh" content="0; url=${href}"></head>` +
      `<body style="font-family:system-ui,sans-serif;background:#FAFBF9;color:#17211E;padding:24px"><p><a href="${href}">Open the recipe</a></p></body></html>`,
    shared ? 200 : 404,
  );
});
