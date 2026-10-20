import { deflateSync, crc32 } from "node:zlib";
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import sharp from "sharp";
import {
  ImageGenerateSchema,
  ImageUploadSchema,
  PhotoImportSchema,
  PhotoLicenseSchema,
  PhotoSearchResponseSchema,
  RecipeImageSchema,
  type PhotoSearchResult,
  type RecipeImage,
} from "@betterplate/contracts";
import { config } from "../config.ts";
import { pool } from "../db/pool.ts";
import { ApiError, type AppEnv, rateLimit, requireUser } from "../lib/http.ts";
import { openKey } from "./ai/byok.ts";
import { isFakeKey } from "./ai/fake.ts";
import { openaiFetch } from "./ai/providers.ts";
import { ErrorResponses, IdParam } from "./common.ts";

/** Per-person cap; old images nothing refers to are cleared by the daily maintenance job. */
export const MAX_IMAGES_PER_USER = 100;
const MAX_BYTES = 3_000_000;
const ALLOWED = PhotoLicenseSchema.options as readonly string[];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MIME: Record<string, "image/jpeg" | "image/png" | "image/webp"> = { "image/jpeg": "image/jpeg", "image/jpg": "image/jpeg", "image/png": "image/png", "image/webp": "image/webp" };

// ---------------------------------------------------------------- Openverse

type OpenverseImage = {
  id: string;
  title?: string | null;
  creator?: string | null;
  license?: string;
  license_version?: string | null;
  license_url?: string | null;
  foreign_landing_url?: string | null;
  provider?: string | null;
  source?: string | null;
  width?: number | null;
  height?: number | null;
  mature?: boolean;
  tags?: { name?: string }[] | null;
};

const STOP = new Set("a an and the of with on in for to from my some fresh homemade served plate bowl dish photo picture image".split(" "));
/** Meaningful words of a description, in order ("grilled lemon chicken on rice" → grilled, lemon, chicken, rice). */
export function keywords(description: string): string[] {
  const words = description.toLowerCase().normalize("NFKD").replace(/[^a-z\s-]/g, " ").split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w));
  return [...new Set(words)];
}

/** How many of the description's words a photo's title and tags mention. */
function relevance(img: OpenverseImage, words: string[]): number {
  const text = `${img.title ?? ""} ${(img.tags ?? []).map((t) => t.name ?? "").join(" ")}`.toLowerCase();
  return words.filter((w) => text.includes(w)).length;
}

const openverse = (path: string) => `${config.openverseApiUrl}/v1/images/${path}`;
const httpUrl = (u: string | null | undefined) => (u && /^https?:\/\//.test(u) && u.length <= 1000 ? u : null);
const clean = (s: string | null | undefined, max: number) => (s ? s.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim().slice(0, max) : "");

async function openverseJson(path: string): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(openverse(path), { headers: { accept: "application/json", "user-agent": "TheBetterPlate/1.0 (recipe photos)" }, signal: AbortSignal.timeout(15_000) });
  } catch {
    throw new ApiError(503, "photos_unreachable", "Couldn't reach Openverse; try again");
  }
  if (res.status === 404) throw new ApiError(404, "photo_not_found", "That photo is no longer available");
  if (res.status === 429) throw new ApiError(429, "photos_rate_limited", "Openverse is busy; try again shortly");
  if (!res.ok) throw new ApiError(503, "photos_error", "Openverse had a problem; try again");
  return res.json();
}

/** Only openly licensed, non-mature photos with an Openverse id; everything else is dropped. */
function toResult(img: OpenverseImage): PhotoSearchResult | null {
  if (!img?.id || !UUID.test(img.id) || img.mature || !ALLOWED.includes(img.license ?? "")) return null;
  return {
    source: "openverse",
    sourceId: img.id,
    title: clean(img.title, 300) || "Untitled",
    creator: clean(img.creator, 200) || null,
    license: img.license as PhotoSearchResult["license"],
    licenseVersion: clean(img.license_version, 20) || null,
    licenseUrl: httpUrl(img.license_url),
    sourceUrl: httpUrl(img.foreign_landing_url),
    provider: clean(img.provider ?? img.source, 100) || null,
    thumbnailUrl: openverse(`${img.id}/thumb/`),
    width: typeof img.width === "number" ? img.width : null,
    height: typeof img.height === "number" ? img.height : null,
  };
}

async function download(url: string): Promise<{ bytes: Buffer; mime: (typeof MIME)[string] }> {
  let res: Response;
  try {
    res = await fetch(url, { headers: { "user-agent": "TheBetterPlate/1.0 (recipe photos)" }, signal: AbortSignal.timeout(20_000), redirect: "follow" });
  } catch {
    throw new ApiError(503, "photos_unreachable", "Couldn't download that photo; try again");
  }
  const mime = MIME[(res.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase()];
  if (!res.ok || !mime) throw new ApiError(422, "photo_unusable", "That photo couldn't be used; pick another");
  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.length === 0 || bytes.length > MAX_BYTES) throw new ApiError(422, "photo_unusable", "That photo is too large; pick another");
  return { bytes, mime };
}

// ---------------------------------------------------------------- generation (OpenAI, the person's key)

/** Newest first; the first one the key can use is taken. */
const IMAGE_MODELS = ["gpt-image-2", "gpt-image-1.5", "gpt-image-1"];

/** A flat 64×40 PNG, only for local and test runs with a fake key. Labelled as generated like any other. */
function testImage(): Buffer {
  const w = 64;
  const h = 40;
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr.set([8, 2, 0, 0, 0], 8);
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: w }, () => [0xe8, 0xf0, 0xec]).flat())]);
  const raw = Buffer.concat(Array.from({ length: h }, () => row));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

async function generate(apiKey: string, prompt: string): Promise<{ bytes: Buffer; mime: "image/webp" | "image/png"; model: string }> {
  if (config.isLocal && isFakeKey(apiKey)) return { bytes: testImage(), mime: "image/png", model: "fake-image" };
  const full =
    `Photorealistic food photograph: ${prompt}. Bright natural light, restrained editorial styling, realistic portion on a plain plate, ` +
    "true-to-life ingredients, no text, no people, no logos.";
  let lastError: unknown;
  for (const model of IMAGE_MODELS) {
    try {
      const data = await openaiFetch(apiKey, "/images/generations", { model, prompt: full, size: "1536x1024", quality: "medium", output_format: "webp", n: 1 });
      const b64 = (data.data as { b64_json?: string }[] | undefined)?.[0]?.b64_json;
      if (!b64) throw new ApiError(503, "ai_provider_error", "OpenAI returned no image");
      const bytes = Buffer.from(b64, "base64");
      if (bytes.length > MAX_BYTES) throw new ApiError(422, "image_too_large", "The generated image was too large");
      return { bytes, mime: "image/webp", model };
    } catch (err) {
      lastError = err;
      if (!(err instanceof ApiError && err.code === "ai_model_unavailable")) throw err;
    }
  }
  throw lastError;
}

// ---------------------------------------------------------------- the person's own photos

/** Phone photos run large; anything bigger than this is refused before decoding. */
export const MAX_UPLOAD_BYTES = 9_000_000;
const UPLOAD_FORMATS = new Set(["jpeg", "png", "webp", "avif", "heif", "gif", "tiff"]);
const unusable = () => new ApiError(422, "photo_unusable", "That file couldn't be read as a photo; try a JPEG or PNG");

/**
 * Checks the file really is a raster photo and re-encodes it: at most 1600 px on the long side,
 * WebP, upright, with every bit of metadata (location, camera, owner) dropped.
 */
export async function normalizeUpload(input: Buffer): Promise<{ bytes: Buffer; mime: "image/webp" }> {
  if (input.length === 0) throw unusable();
  if (input.length > MAX_UPLOAD_BYTES) throw new ApiError(413, "photo_too_large", "That photo is too large; use one under 9 MB");
  const opts = { limitInputPixels: 50_000_000, failOn: "error" as const };
  try {
    const meta = await sharp(input, opts).metadata();
    if (!meta.format || !UPLOAD_FORMATS.has(meta.format)) throw unusable();
    const bytes = await sharp(input, opts).rotate().resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true }).webp({ quality: 82 }).toBuffer();
    if (bytes.length > MAX_BYTES) throw unusable();
    return { bytes, mime: "image/webp" };
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw unusable();
  }
}

/** Stores the person's own photo. They confirmed they may use it; that time and where it came from are kept. */
export async function storeUpload(userId: string, input: Buffer, alt: string, via: "app" | "assistant"): Promise<RecipeImage> {
  const { bytes, mime } = await normalizeUpload(input);
  return store(userId, { kind: "upload", credit: null, generator: null, bytes, mime }, alt, via);
}

// ---------------------------------------------------------------- storage

async function store(
  userId: string,
  image: Omit<RecipeImage, "id" | "alt"> & { bytes: Buffer; mime: string },
  alt: string,
  uploadVia: "app" | "assistant" | null = null,
): Promise<RecipeImage> {
  const { rows } = await pool.query<{ n: string }>("select count(*) as n from recipe_images where user_id = $1", [userId]);
  if (Number(rows[0]!.n) >= MAX_IMAGES_PER_USER) {
    throw new ApiError(409, "image_limit", `You have ${MAX_IMAGES_PER_USER} recipe images; remove some photos from recipes and try again tomorrow`);
  }
  const id = crypto.randomUUID();
  await pool.query(
    `insert into recipe_images (id, user_id, kind, mime, bytes, credit, generator, rights_confirmed_at, upload_source)
     values ($1, $2, $3, $4, $5, $6, $7, case when $8::text is null then null else now() end, $8)`,
    [
      id,
      userId,
      image.kind,
      image.mime,
      image.bytes,
      image.credit ? JSON.stringify(image.credit) : null,
      image.generator ? JSON.stringify(image.generator) : null,
      uploadVia,
    ],
  );
  return { id, alt: alt.slice(0, 200), kind: image.kind, credit: image.credit, generator: image.generator };
}

/**
 * For recipe saves: the image must belong to the person, and its credit and generator are taken
 * from the server's record, never from the client.
 */
export async function resolveRecipeImage(
  client: { query: typeof pool.query },
  userId: string,
  image: RecipeImage | null | undefined,
): Promise<{ ok: true; image: RecipeImage | null } | { ok: false }> {
  if (!image) return { ok: true, image: null };
  const { rows } = await client.query<{ kind: RecipeImage["kind"]; credit: RecipeImage["credit"]; generator: RecipeImage["generator"] }>(
    "select kind, credit, generator from recipe_images where id = $1 and user_id = $2",
    [image.id, userId],
  );
  if (!rows[0]) return { ok: false };
  return { ok: true, image: { id: image.id, alt: image.alt, kind: rows[0].kind, credit: rows[0].credit, generator: rows[0].generator } };
}

// ---------------------------------------------------------------- routes

/** Openly licensed photos for a plain description, best matches first (at most 12). */
export async function searchPhotos(q: string): Promise<PhotoSearchResult[]> {
  const words = keywords(q);
  // The full description first; if that finds too little, each main word on its own, ranked below by how many words a photo mentions.
  const seen = new Map<string, OpenverseImage>();
  const search = async (query: string) => {
    const params = new URLSearchParams({ q: query, license: ALLOWED.join(","), page_size: "20", mature: "false" });
    return ((await openverseJson(`?${params}`)) as { results?: OpenverseImage[] }).results ?? [];
  };
  const add = (list: OpenverseImage[]) => list.forEach((img) => img?.id && !seen.has(img.id) && seen.set(img.id, img));
  add(await search(q));
  if (seen.size < 8 && words.length > 1) (await Promise.all(words.slice(0, 4).map(search))).forEach(add);
  const ranked = [...seen.values()].map((img, i) => ({ img, i, score: relevance(img, words) })).sort((a, b) => b.score - a.score || a.i - b.i);
  return ranked.map((r) => toResult(r.img)).filter((r): r is PhotoSearchResult => r !== null).slice(0, 12);
}

/** Copies an Openverse photo into the person's images after re-checking its license by id. */
export async function importPhoto(userId: string, sourceId: string, alt: string | undefined): Promise<RecipeImage> {
  if (!UUID.test(sourceId)) throw new ApiError(400, "photo_not_found", "Unknown photo");
  const result = toResult((await openverseJson(`${sourceId}/`)) as OpenverseImage);
  if (!result) throw new ApiError(422, "photo_license", "That photo's license doesn't allow use here");
  const { bytes, mime } = await download(openverse(`${sourceId}/thumb/?full_size=true`));
  const { thumbnailUrl: _t, width: _w, height: _h, ...credit } = result;
  return store(userId, { kind: "photo", credit, generator: null, bytes, mime }, alt ?? result.title);
}

export const imageRoutes = new OpenAPIHono<AppEnv>();
imageRoutes.use("/v1/photos/search", rateLimit("photo search", 60, 60));
imageRoutes.use("/v1/images/import", rateLimit("photo import", 30, 3600));
imageRoutes.use("/v1/images/generate", rateLimit("image generation", 20, 3600));
imageRoutes.use("/v1/images/upload", rateLimit("photo upload", 30, 3600));

const ImageResponse = { 201: { description: "Stored; attach it to a recipe by id", content: { "application/json": { schema: RecipeImageSchema } } }, ...ErrorResponses };

imageRoutes.openapi(
  createRoute({
    method: "get",
    path: "/v1/photos/search",
    tags: ["images"],
    summary: "Find openly licensed food photos from a description (Openverse)",
    description:
      "q is a plain description (\"grilled lemon chicken with rice\"), matched against photo titles, descriptions and tags. " +
      "If the full description finds too little, its main words are tried. Results are ordered by how many of the description's words they mention. " +
      "Only public domain, CC0, CC BY and CC BY-SA photos are returned. Online only.",
    request: { query: z.object({ q: z.string().trim().min(2).max(200) }) },
    responses: { 200: { description: "Photos with license and attribution", content: { "application/json": { schema: PhotoSearchResponseSchema } } }, ...ErrorResponses },
  }),
  async (c) => {
    requireUser(c);
    return c.json({ results: await searchPhotos(c.req.valid("query").q) }, 200);
  },
);

imageRoutes.openapi(
  createRoute({
    method: "post",
    path: "/v1/images/import",
    tags: ["images"],
    summary: "Copy an Openverse photo into your kitchen",
    description:
      "The server looks the photo up by its Openverse id (it never fetches a URL a client supplies), checks the license again, " +
      "and downloads Openverse's resized copy. Credit and license are stored with it.",
    request: { body: { required: true, content: { "application/json": { schema: PhotoImportSchema } } } },
    responses: ImageResponse,
  }),
  async (c) => {
    const user = requireUser(c);
    const { sourceId, alt } = c.req.valid("json");
    return c.json(await importPhoto(user.id, sourceId, alt), 201);
  },
);

imageRoutes.openapi(
  createRoute({
    method: "post",
    path: "/v1/images/generate",
    tags: ["images"],
    summary: "Generate a photorealistic recipe image with your own OpenAI key",
    description: "Needs the AI companion with OpenAI connected. The image is labelled AI-generated wherever it is shown and is not an exact depiction.",
    request: { body: { required: true, content: { "application/json": { schema: ImageGenerateSchema } } } },
    responses: ImageResponse,
  }),
  async (c) => {
    const user = requireUser(c);
    if (!config.features.aiCompanion) throw new ApiError(404, "feature_disabled", "AI images are not available");
    const { prompt, alt } = c.req.valid("json");
    const { rows } = await pool.query<{ ciphertext: Buffer; iv: Buffer; auth_tag: Buffer }>(
      "select ciphertext, iv, auth_tag from ai_credentials where user_id = $1 and provider = 'openai'",
      [user.id],
    );
    if (!rows[0]) throw new ApiError(404, "not_connected", "Connect an OpenAI key in AI settings to generate images");
    const apiKey = openKey({ ciphertext: rows[0].ciphertext, iv: rows[0].iv, authTag: rows[0].auth_tag }, user.id, "openai");
    const { bytes, mime, model } = await generate(apiKey, prompt);
    await pool.query(
      `insert into ai_usage (user_id, day, requests, input_tokens, output_tokens) values ($1, current_date, 1, 0, 0)
       on conflict (user_id, day) do update set requests = ai_usage.requests + 1`,
      [user.id],
    );
    return c.json(await store(user.id, { kind: "generated", credit: null, generator: { provider: "openai", model }, bytes, mime }, alt), 201);
  },
);

imageRoutes.openapi(
  createRoute({
    method: "post",
    path: "/v1/images/upload",
    tags: ["images"],
    summary: "Upload your own photo",
    description:
      "data is the file in base64 (JPEG, PNG, WebP, AVIF, GIF or TIFF, at most 9 MB). The person must confirm they took the photo or have the right to use it. " +
      "The server re-encodes it to WebP (at most 1600 px) and drops all metadata, including location. Only its owner can see it.",
    request: { body: { required: true, content: { "application/json": { schema: ImageUploadSchema } } } },
    responses: ImageResponse,
  }),
  async (c) => {
    const user = requireUser(c);
    const { data, alt } = c.req.valid("json");
    const bytes = Buffer.from(data.replace(/^data:[^,]*,/, ""), "base64");
    return c.json(await storeUpload(user.id, bytes, alt ?? "", "app"), 201);
  },
);

imageRoutes.openapi(
  createRoute({
    method: "get",
    path: "/v1/images/{id}",
    tags: ["images"],
    summary: "An image you stored (owner only)",
    request: { params: IdParam },
    responses: { 200: { description: "Image bytes", content: { "image/webp": { schema: z.any() }, "image/jpeg": { schema: z.any() }, "image/png": { schema: z.any() } } }, ...ErrorResponses },
  }),
  async (c) => {
    const user = requireUser(c);
    const { id } = c.req.valid("param");
    const { rows } = await pool.query<{ mime: string; bytes: Buffer }>("select mime, bytes from recipe_images where id = $1 and user_id = $2", [id, user.id]);
    if (!rows[0]) throw new ApiError(404, "not_found", "Image not found");
    return c.body(new Uint8Array(rows[0].bytes), 200, {
      "content-type": rows[0].mime,
      // Content never changes for an id; private so shared caches never keep it.
      "cache-control": "private, max-age=31536000, immutable",
      "x-content-type-options": "nosniff",
    });
  },
);
