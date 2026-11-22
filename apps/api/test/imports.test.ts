import { afterAll, beforeAll, describe, expect, it } from "vitest";
import sharp from "sharp";
import { RecipeImportSchema, textFingerprint } from "@betterplate/contracts";
import { config } from "../src/config.ts";
import { pool } from "../src/db/pool.ts";
import { call, type Client, signIn } from "./helpers.ts";

/**
 * Recipes read from photos. The fake model answers every photo with the same labelled fixture
 * (fake-vision.ts); the catalog matching, amounts, caps and storage rules are the real ones.
 */
const house = config.house as { apiKey: string; dailyImports: number; monthlyBudgetUsd: number; allowedEmails: "*" | Set<string> };
const features = config.features as { recipePhotoImport: boolean; community: boolean };
const saved = { ...house };
let cook: Client;
let other: Client;
let photo: string;

beforeAll(async () => {
  [cook, other] = await Promise.all([signIn(), signIn()]);
  Object.assign(house, { apiKey: "fake-local-house", dailyImports: 2, monthlyBudgetUsd: 1000, allowedEmails: new Set([cook.email.toLowerCase()]) });
  // A synthetic "page" with an EXIF block, to check nothing of it is kept.
  const png = await sharp({ create: { width: 900, height: 1200, channels: 3, background: { r: 250, g: 248, b: 240 } } })
    .withMetadata({ exif: { IFD0: { Artist: "Test fixture owner" } } })
    .jpeg()
    .toBuffer();
  photo = png.toString("base64");
});
afterAll(async () => {
  Object.assign(house, saved);
  features.recipePhotoImport = true;
  await pool.end();
});

const read = (client: Client, images = [photo], rightsConfirmed: unknown = true) =>
  client.request("/v1/recipe-imports", { method: "POST", json: { images, rightsConfirmed } });

describe("recipe photo import", () => {
  it("needs sign-in, the rights confirmation, an AI key and the feature", async () => {
    expect((await call("/v1/recipe-imports", { method: "POST", json: { images: [photo], rightsConfirmed: true } })).status).toBe(401);
    expect((await read(cook, [photo], false)).status).toBe(400);
    expect((await read(cook, [photo, photo, photo, photo, photo])).status).toBe(400);
    const noKey = await read(other);
    expect(noKey.status).toBe(404);
    expect((await noKey.json()).error.code).toBe("not_connected");
    features.recipePhotoImport = false;
    try {
      expect((await read(cook)).status).toBe(404);
      expect((await (await cook.request("/v1/me")).json()).features.recipePhotoImport).toBe(false);
    } finally {
      features.recipePhotoImport = true;
    }
  });

  it("refuses a file that isn't a photo", async () => {
    const res = await read(cook, [Buffer.from("not an image at all").toString("base64")]);
    expect(res.status).toBe(422);
    expect((await res.json()).error.code).toBe("photo_unusable");
  });

  it("reads lines, matches catalog foods, weighs what it can and leaves the rest for review", async () => {
    const before = await pool.query<{ n: string }>("select count(*) as n from recipe_images");
    const res = await read(cook);
    expect(res.status).toBe(200);
    const draft = RecipeImportSchema.parse(await res.json());
    expect(draft).toMatchObject({ title: "Test fixture: lemon chicken with rice", servings: 4, language: "en", readsLeftToday: 1 });
    expect(draft.method).toContain("74 °C");

    const byText = new Map(draft.lines.map((l) => [l.original, l]));
    const chicken = byText.get("500 g chicken breast, skinless")!;
    expect(chicken.foodId).toMatch(/^fdc:\d+$/);
    expect(chicken.amount).toEqual({ quantity: 500, unit: "g", portionIndex: null });
    const oil = byText.get("2 tbsp olive oil")!;
    expect(oil.role).toBe("cooking_oil");
    expect(oil.amount).toMatchObject({ quantity: 2, unit: "portion" });
    expect(byText.get("3 cloves garlic, minced")!.amount).toMatchObject({ unit: "portion" });
    // Matched, but "to taste" has no amount; "moon dust" matches nothing in the catalog.
    expect(byText.get("Salt to taste")!.amount).toBeNull();
    const dust = byText.get("1 pinch of moon dust")!;
    expect(dust.foodId).toBeNull();
    expect(dust.candidates).toEqual([]);

    // Every matched id is a real catalog food, picked from that line's own candidates.
    const ids = draft.lines.flatMap((l) => (l.foodId ? [l.foodId] : []));
    const { rows } = await pool.query<{ id: string }>("select id from food_items where id = any($1)", [ids]);
    expect(rows).toHaveLength(ids.length);
    for (const l of draft.lines) if (l.foodId) expect(l.candidates.map((c) => c.foodId)).toContain(l.foodId);

    // The photo was not stored anywhere; only the read was counted (with its tokens).
    expect((await pool.query<{ n: string }>("select count(*) as n from recipe_images")).rows[0]!.n).toBe(before.rows[0]!.n);
    const usage = await pool.query<{ imports: number; input_tokens: string }>("select imports, input_tokens from ai_house_usage where user_id = (select id from users where email = $1)", [cook.email]);
    expect(usage.rows[0]).toMatchObject({ imports: 1 });
    expect(Number(usage.rows[0]!.input_tokens)).toBeGreaterThan(0);
  });

  it("stops at the daily read cap on the included companion", async () => {
    expect((await read(cook)).status).toBe(200);
    const over = await read(cook);
    expect(over.status).toBe(429);
    expect((await over.json()).error.code).toBe("ai_daily_import_limit");
  });

  it("uses the person's own key without counting against the included cap", async () => {
    expect((await other.request("/v1/ai/credentials/openai", { method: "PUT", json: { apiKey: "fake-local-openai-5678" } })).status).toBe(200);
    const res = await read(other);
    expect(res.status).toBe(200);
    expect(RecipeImportSchema.parse(await res.json()).readsLeftToday).toBeNull();
  });

  it("keeps where a saved recipe came from, and keeps a photo's method out of the community until rewritten", async () => {
    const draft = RecipeImportSchema.parse(await (await read(other)).json());
    const ingredients = draft.lines
      .filter((l) => l.foodId && l.amount)
      .map((l) => ({ id: l.id, foodId: l.foodId, ...l.amount, role: l.role }));
    const origin = { kind: "photo", importedAt: draft.importedAt, methodFingerprint: textFingerprint(draft.method) };
    const created = await other.request("/v1/recipes", { method: "POST", json: { title: draft.title, servings: draft.servings, method: draft.method, ingredients, origin } });
    expect(created.status).toBe(201);
    const recipe = await created.json();
    expect(recipe.origin).toEqual(origin);

    features.community = true;
    const withMethod = await other.request(`/v1/recipes/${recipe.id}/community`, { method: "PUT", json: { includeMethod: true } });
    expect(withMethod.status).toBe(422);
    expect((await withMethod.json()).error.code).toBe("method_from_photo");
    expect((await other.request(`/v1/recipes/${recipe.id}/community`, { method: "PUT", json: { includeMethod: false } })).status).toBe(200);

    const rewritten = await other.request(`/v1/recipes/${recipe.id}`, {
      method: "PUT",
      headers: { "if-match": `"v${recipe.version}"` },
      json: { title: draft.title, servings: 4, method: "My way: simmer the rice, pan-fry the chicken to 74 °C, season.", ingredients, origin },
    });
    expect(rewritten.status).toBe(200);
    expect((await other.request(`/v1/recipes/${recipe.id}/community`, { method: "PUT", json: { includeMethod: true } })).status).toBe(200);
  });
});
