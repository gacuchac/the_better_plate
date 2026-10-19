import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import type { FoodRecord, NutrientDefinition } from "@betterplate/nutrition";
import { pool } from "../db/pool.ts";
import { ApiError, type AppEnv, rateLimit } from "../lib/http.ts";
import { ErrorResponses } from "./common.ts";

// ---------- service ----------

export interface CatalogVersion {
  version: string;
  retrievedAt: string;
  contentSha256: string;
  foodCount: number;
  source: unknown;
  nutrients: NutrientDefinition[];
}

type FoodRow = {
  id: string;
  fdc_id: number;
  description: string;
  data_type: string;
  category: string | null;
  publication_date: string | null;
  nutrients_per_100g: Record<string, number>;
  portions: FoodRecord["portions"];
  source: FoodRecord["source"];
};

export function toFood(r: FoodRow) {
  return {
    id: r.id,
    fdcId: r.fdc_id,
    description: r.description,
    dataType: r.data_type,
    category: r.category,
    publicationDate: r.publication_date,
    nutrientsPer100g: r.nutrients_per_100g,
    portions: r.portions,
    source: r.source,
  };
}

export async function currentCatalog(): Promise<CatalogVersion> {
  const { rows } = await pool.query(
    "select version, retrieved_at, content_sha256, food_count, source, nutrients from catalog_versions where is_current",
  );
  const r = rows[0];
  if (!r) throw new ApiError(503, "catalog_not_loaded", "The food catalog has not been loaded yet");
  return {
    version: r.version,
    retrievedAt: r.retrieved_at.toISOString(),
    contentSha256: r.content_sha256,
    foodCount: r.food_count,
    source: r.source,
    nutrients: r.nutrients,
  };
}

export async function foodsByIds(ids: string[]): Promise<Map<string, ReturnType<typeof toFood>>> {
  if (ids.length === 0) return new Map();
  const { rows } = await pool.query<FoodRow>("select * from food_items where id = any($1)", [ids]);
  return new Map(rows.map((r) => [r.id, toFood(r)]));
}

// ---------- schemas ----------

const PortionSchema = z.object({ label: z.string(), gramWeight: z.number() });
const SourceSchema = z.object({
  publisher: z.string(),
  dataset: z.string(),
  url: z.string(),
  retrievedAt: z.string(),
  license: z.string().optional(),
});
export const FoodSchema = z
  .object({
    id: z.string().openapi({ example: "fdc:171705" }),
    fdcId: z.number().int(),
    description: z.string(),
    dataType: z.string(),
    category: z.string().nullable(),
    publicationDate: z.string().nullable(),
    nutrientsPer100g: z
      .record(z.string(), z.number())
      .openapi({ description: "Per 100 g as published. A missing key means not reported, never zero." }),
    portions: z.array(PortionSchema),
    source: SourceSchema,
  })
  .openapi("Food");
const NutrientDefSchema = z.object({ key: z.string(), name: z.string(), unit: z.string(), fdcNutrientId: z.number().optional() });
const ManifestFields = z.object({
  version: z.string(),
  retrievedAt: z.string(),
  contentSha256: z.string(),
  foodCount: z.number().int(),
  source: z.unknown(),
  nutrients: z.array(NutrientDefSchema),
});
const ManifestSchema = ManifestFields.extend({ bundleUrl: z.string() }).openapi("CatalogManifest");
const BundleSchema = ManifestFields.extend({ foods: z.array(FoodSchema) }).openapi("CatalogBundle");
const FoodIdParam = z.string().regex(/^fdc:\d{1,9}$/);

// ---------- routes ----------

export const catalogRoutes = new OpenAPIHono<AppEnv>();
catalogRoutes.use("/v1/foods/*", rateLimit("food lookup", 300, 60));
catalogRoutes.use("/v1/foods", rateLimit("food search", 300, 60));
catalogRoutes.use("/v1/catalog/*", rateLimit("catalog", 120, 60));

catalogRoutes.openapi(
  createRoute({
    method: "get",
    path: "/v1/catalog/manifest",
    tags: ["catalog"],
    summary: "Current starter catalog version",
    responses: { 200: { description: "Manifest", content: { "application/json": { schema: ManifestSchema } } }, ...ErrorResponses },
  }),
  async (c) => {
    const cat = await currentCatalog();
    return c.json({ ...cat, bundleUrl: `/v1/catalog/bundle?version=${encodeURIComponent(cat.version)}` }, 200);
  },
);

catalogRoutes.openapi(
  createRoute({
    method: "get",
    path: "/v1/catalog/bundle",
    tags: ["catalog"],
    summary: "Full starter catalog for offline use",
    request: { query: z.object({ version: z.string().optional() }) },
    responses: {
      200: { description: "Bundle", content: { "application/json": { schema: BundleSchema } } },
      304: { description: "Not modified (ETag match)" },
      ...ErrorResponses,
    },
  }),
  async (c) => {
    const cat = await currentCatalog();
    const etag = `"${cat.contentSha256}"`;
    c.header("ETag", etag);
    c.header("Cache-Control", "public, max-age=300");
    if (c.req.header("if-none-match") === etag) return c.body(null, 304);
    const { rows } = await pool.query<FoodRow>(
      "select * from food_items where catalog_version = $1 order by lower(description)",
      [cat.version],
    );
    return c.json({ ...cat, foods: rows.map(toFood) }, 200);
  },
);

catalogRoutes.openapi(
  createRoute({
    method: "get",
    path: "/v1/foods",
    tags: ["catalog"],
    summary: "Search foods in the catalog",
    request: {
      query: z.object({
        query: z.string().trim().max(100).default(""),
        limit: z.coerce.number().int().min(1).max(50).default(20),
        cursor: z.coerce.number().int().min(0).default(0).openapi({ description: "Opaque cursor from the previous page" }),
      }),
    },
    responses: {
      200: {
        description: "Matches",
        content: { "application/json": { schema: z.object({ foods: z.array(FoodSchema), nextCursor: z.string().nullable() }) } },
      },
      ...ErrorResponses,
    },
  }),
  async (c) => {
    const { query, limit, cursor } = c.req.valid("query");
    const words = query.toLowerCase().split(/\s+/).filter(Boolean).slice(0, 8);
    const terms = words.map((t) => `%${t.replace(/[%_\\]/g, "\\$&")}%`);
    const { rows } = await pool.query<FoodRow>(
      `select f.* from food_items f join catalog_versions v on v.version = f.catalog_version and v.is_current
       where lower(f.description) like all($1::text[])
       order by (lower(f.description) like $2) desc, length(f.description), f.description
       limit $3 offset $4`,
      [terms.length ? terms : ["%"], `${(words[0] ?? "").replace(/[%_\\]/g, "\\$&")}%`, limit + 1, cursor],
    );
    const more = rows.length > limit;
    return c.json({ foods: rows.slice(0, limit).map(toFood), nextCursor: more ? String(cursor + limit) : null }, 200);
  },
);

catalogRoutes.openapi(
  createRoute({
    method: "get",
    path: "/v1/foods/{foodId}",
    tags: ["catalog"],
    summary: "One food with nutrients and provenance",
    request: { params: z.object({ foodId: FoodIdParam }) },
    responses: { 200: { description: "Food", content: { "application/json": { schema: FoodSchema } } }, ...ErrorResponses },
  }),
  async (c) => {
    const id = c.req.valid("param").foodId;
    const food = (await foodsByIds([id])).get(id);
    if (!food) throw new ApiError(404, "not_found", "Food not found");
    return c.json(food, 200);
  },
);

catalogRoutes.openapi(
  createRoute({
    method: "post",
    path: "/v1/foods/batch",
    tags: ["catalog"],
    summary: "Look up several foods by id",
    request: {
      body: { required: true, content: { "application/json": { schema: z.object({ ids: z.array(FoodIdParam).min(1).max(100) }) } } },
    },
    responses: {
      200: {
        description: "Found foods and missing ids",
        content: { "application/json": { schema: z.object({ foods: z.array(FoodSchema), missing: z.array(z.string()) }) } },
      },
      ...ErrorResponses,
    },
  }),
  async (c) => {
    const ids = [...new Set(c.req.valid("json").ids)];
    const found = await foodsByIds(ids);
    return c.json({ foods: [...found.values()], missing: ids.filter((id) => !found.has(id)) }, 200);
  },
);
