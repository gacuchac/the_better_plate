import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RecipeImageSchema } from "@betterplate/contracts";
import { pool } from "../src/db/pool.ts";
import { keywords } from "../src/modules/images.ts";
import { call, type Client, signIn } from "./helpers.ts";
// @ts-expect-error plain JS test server
import { startMockOpenverse } from "../../../scripts/mock-openverse.mjs";

let alice: Client;
let bob: Client;
let mock: { queries: string[]; close: () => void };
const CHICKEN = "11111111-1111-4111-8111-111111111111";
const NON_COMMERCIAL = "33333333-3333-4333-8333-333333333333";

beforeAll(async () => {
  mock = await startMockOpenverse(4191);
  [alice, bob] = await Promise.all([signIn(), signIn()]);
});
afterAll(async () => {
  mock.close();
  await pool.end();
});

async function catalogFood(): Promise<string> {
  const { rows } = await pool.query<{ id: string }>("select id from food_items order by id limit 1");
  return rows[0]!.id;
}

describe("recipe photos", () => {
  it("picks the main words of a description", () => {
    expect(keywords("Grilled lemon chicken on a plate with rice")).toEqual(["grilled", "lemon", "chicken", "rice"]);
  });

  it("finds openly licensed photos from a description, trying its main words when the full text finds nothing", async () => {
    expect((await call("/v1/photos/search?q=chicken")).status).toBe(401);
    const res = await alice.request(`/v1/photos/search?q=${encodeURIComponent("juicy grilled chicken for a weeknight dinner")}`);
    expect(res.status).toBe(200);
    const { results } = await res.json();
    expect(mock.queries.length).toBeGreaterThan(1);
    const ids = results.map((r: { sourceId: string }) => r.sourceId);
    expect(ids[0]).toBe(CHICKEN);
    expect(ids).not.toContain(NON_COMMERCIAL);
    for (const r of results) expect(["cc0", "pdm", "by", "by-sa"]).toContain(r.license);
    const broccoli = (await (await alice.request("/v1/photos/search?q=broccoli")).json()).results[0];
    expect(broccoli.creator).toBe("Fixture Cook");
  });

  it("copies a photo with its credit, serves it only to its owner, and refuses non-open licenses", async () => {
    expect((await alice.request("/v1/images/import", { method: "POST", json: { source: "openverse", sourceId: NON_COMMERCIAL } })).status).toBe(422);
    const res = await alice.request("/v1/images/import", { method: "POST", json: { source: "openverse", sourceId: CHICKEN } });
    expect(res.status).toBe(201);
    const image = RecipeImageSchema.parse(await res.json());
    expect(image).toMatchObject({ kind: "photo", alt: "Test fixture: grilled chicken breast", credit: { license: "by", creator: "Fixture Photographer", provider: "flickr" } });

    const own = await alice.request(`/v1/images/${image.id}`);
    expect(own.status).toBe(200);
    expect(own.headers.get("content-type")).toBe("image/png");
    expect(own.headers.get("cache-control")).toContain("private");
    expect((await bob.request(`/v1/images/${image.id}`)).status).toBe(404);
    expect((await call(`/v1/images/${image.id}`)).status).toBe(401);
  });

  it("keeps the server's credit on a recipe and drops images that aren't the person's", async () => {
    const image = RecipeImageSchema.parse(await (await alice.request("/v1/images/import", { method: "POST", json: { source: "openverse", sourceId: CHICKEN } })).json());
    const foodId = await catalogFood();
    const ingredients = [{ id: crypto.randomUUID(), foodId, quantity: 100, unit: "g", role: "ingredient" }];
    const forged = { ...image, alt: "Seared chicken", credit: { ...image.credit!, creator: "Someone else", license: "cc0" } };
    const saved = await alice.request("/v1/recipes", { method: "POST", json: { title: "Photo test", servings: 1, ingredients, image: forged } });
    expect(saved.status).toBe(201);
    const recipe = await saved.json();
    expect(recipe.image).toMatchObject({ id: image.id, alt: "Seared chicken", credit: { creator: "Fixture Photographer", license: "by" } });

    const stolen = await bob.request("/v1/recipes", { method: "POST", json: { title: "Not mine", servings: 1, ingredients, image } });
    expect(stolen.status).toBe(201);
    expect((await stolen.json()).image).toBeNull();
  });

  it("generates an image on the person's OpenAI key, labelled with its model", async () => {
    const before = await alice.request("/v1/images/generate", { method: "POST", json: { prompt: "lemon chicken with rice", alt: "Lemon chicken" } });
    expect(before.status).toBe(404);
    expect((await before.json()).error.code).toBe("not_connected");
    expect((await alice.request("/v1/ai/credentials/openai", { method: "PUT", json: { apiKey: "fake-local-openai-1234" } })).status).toBe(200);
    const res = await alice.request("/v1/images/generate", { method: "POST", json: { prompt: "lemon chicken with rice", alt: "Lemon chicken" } });
    expect(res.status).toBe(201);
    expect(RecipeImageSchema.parse(await res.json())).toMatchObject({ kind: "generated", credit: null, generator: { provider: "openai", model: "fake-image" } });
  });

  it("includes images in the data export and deletes them with the account", async () => {
    const exported = await (await alice.request("/v1/me/export")).json();
    expect(exported.recipeImages.length).toBeGreaterThanOrEqual(3);
    expect(exported.recipeImages[0].image).toMatch(/^data:image\/png;base64,/);
    const { rows } = await pool.query<{ id: string }>("select id from users where email = $1", [alice.email]);
    expect((await alice.request("/v1/me", { method: "DELETE" })).status).toBe(204);
    const left = await pool.query("select 1 from recipe_images where user_id = $1", [rows[0]!.id]);
    expect(left.rowCount).toBe(0);
  });
});
