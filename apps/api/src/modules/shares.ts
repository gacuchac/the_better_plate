import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { ShareCreateSchema, SharedRecipeSchema, ShareSchema, type Recipe, type RecipeImage, type Share, type SharedRecipe } from "@betterplate/contracts";
import { config } from "../config.ts";
import { pool, withTransaction } from "../db/pool.ts";
import { ApiError, type AppEnv, rateLimit, requireUser } from "../lib/http.ts";
import { currentCatalog, foodsByIds } from "./catalog.ts";
import { ErrorResponses, IdParam } from "./common.ts";
import { resolveRecipeImage } from "./images.ts";
import { getRecipe } from "./recipes.ts";

// ---------- service ----------

type ShareRow = {
  id: string;
  user_id: string;
  recipe_id: string;
  recipe_version: number;
  include_method: boolean;
  /** The image is kept by reference: the bytes stay in recipe_images while a live link names them. */
  snapshot: Omit<SharedRecipe, "shareId" | "sharedAt" | "expiresAt" | "image"> & { image?: RecipeImage | null };
  created_at: Date;
  expires_at: Date | null;
  revoked_at: Date | null;
};

const SOURCE = { name: "USDA FoodData Central (SR Legacy)", url: "https://fdc.nal.usda.gov/" };

const apiBase = () => config.publicApiUrl.replace(/\/$/, "");
export const shareUrl = (id: string) => `${apiBase()}/s/${id}`;
const sharedImageUrl = (id: string) => `${apiBase()}/v1/shared/${id}/image`;

function toShare(r: ShareRow): Share {
  return {
    shareId: r.id,
    recipeId: r.recipe_id,
    recipeVersion: r.recipe_version,
    title: r.snapshot.title,
    includeMethod: r.include_method,
    includeImage: !!r.snapshot.image,
    url: shareUrl(r.id),
    createdAt: r.created_at.toISOString(),
    expiresAt: r.expires_at?.toISOString() ?? null,
  };
}

/** Builds the snapshot from the server's copy only: the fields the owner reviewed, nothing about the owner. */
async function buildSnapshot(userId: string, recipe: Recipe, includeMethod: boolean, includeImage: boolean): Promise<ShareRow["snapshot"]> {
  if (!recipe.nutrition) throw new ApiError(409, "not_ready", "This recipe has no nutrition estimate yet; save it again and retry");
  const [foods, catalog, image] = await Promise.all([
    foodsByIds([...new Set(recipe.ingredients.map((i) => i.foodId))]),
    currentCatalog(),
    includeImage && recipe.image ? resolveRecipeImage(pool, userId, recipe.image) : null,
  ]);
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
    image: image?.ok ? image.image : null,
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
    description: "Online only. The snapshot holds the title, description, servings, ingredients, the USDA-based estimate and, if chosen, the method and the photo. Anyone with the link can read it until it is revoked or expires.",
    request: { params: IdParam, body: { required: true, ...json(ShareCreateSchema) } },
    responses: { 201: { description: "Link created", ...json(ShareSchema) }, 409: { description: "Recipe not ready to share", ...json(z.object({ error: z.any() })) }, ...ErrorResponses },
  }),
  async (c) => {
    const user = requireUser(c);
    const { id } = c.req.valid("param");
    const { includeMethod, includeImage, expiresInDays } = c.req.valid("json");
    const recipe = await getRecipe(user.id, id);
    if (!recipe) throw new ApiError(404, "not_found", "Recipe not found");
    const snapshot = await buildSnapshot(user.id, recipe, includeMethod, includeImage);
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

const LIVE_SHARE = "select * from share_snapshots where id = $1 and revoked_at is null and (expires_at is null or expires_at > now())";

export async function readShared(shareId: string): Promise<SharedRecipe | null> {
  const { rows } = await pool.query<ShareRow>(LIVE_SHARE, [shareId]);
  const r = rows[0];
  if (!r) return null;
  const { image, ...snapshot } = r.snapshot;
  return {
    shareId: r.id,
    ...snapshot,
    // Links made before recipes had a description or shares had photos carry none.
    description: snapshot.description ?? "",
    image: image ? { alt: image.alt, kind: image.kind, credit: image.credit, generator: image.generator, url: sharedImageUrl(r.id) } : null,
    sharedAt: r.created_at.toISOString(),
    expiresAt: r.expires_at?.toISOString() ?? null,
  };
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

shareRoutes.openapi(
  createRoute({
    method: "get", path: "/v1/shared/{shareId}/image", tags: ["sharing"], summary: "The photo of a shared recipe (no sign-in)",
    description: "Only when the owner shared the photo. Stops working with the link: revoked, expired and unknown links all answer 404.",
    request: { params: ShareIdParam },
    responses: { 200: { description: "Image bytes", content: { "image/webp": { schema: z.any() }, "image/jpeg": { schema: z.any() }, "image/png": { schema: z.any() } } }, ...ErrorResponses },
  }),
  async (c) => {
    const { shareId } = c.req.valid("param");
    const { rows: shares } = await pool.query<ShareRow>(LIVE_SHARE, [shareId]);
    const share = shares[0];
    const imageId = share?.snapshot.image?.id;
    const { rows } = imageId
      ? await pool.query<{ mime: string; bytes: Buffer }>("select mime, bytes from recipe_images where id = $1 and user_id = $2", [imageId, share.user_id])
      : { rows: [] };
    c.header("Cache-Control", "no-store");
    c.header("X-Robots-Tag", "noindex");
    if (!rows[0]) throw new ApiError(404, "not_found", "This link has no photo, or it was revoked, expired or never existed");
    return c.body(new Uint8Array(rows[0].bytes), 200, {
      "content-type": rows[0].mime,
      "x-content-type-options": "nosniff",
    });
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
  const image = shared?.image
    ? `<meta property="og:image" content="${escapeHtml(shared.image.url)}"><meta property="og:image:alt" content="${escapeHtml(shared.image.alt)}"><meta name="twitter:card" content="summary_large_image">`
    : `<meta name="twitter:card" content="summary">`;
  return c.html(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
      `<title>${t}</title><meta name="description" content="${d}"><meta name="robots" content="noindex">` +
      `<meta property="og:type" content="article"><meta property="og:title" content="${t}"><meta property="og:description" content="${d}">` +
      `<meta property="og:site_name" content="The Better Plate">${image}` +
      `<meta http-equiv="refresh" content="0; url=${href}"></head>` +
      `<body style="font-family:system-ui,sans-serif;background:#FAFBF9;color:#17211E;padding:24px"><p><a href="${href}">Open the recipe</a></p></body></html>`,
    shared ? 200 : 404,
  );
});
