import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CommunityHomeSchema, CommunityRecipeSchema, CommunityStatusSchema, SyncBatchResponseSchema, SyncChangesResponseSchema } from "@betterplate/contracts";
import { pool } from "../src/db/pool.ts";
import { config } from "../src/config.ts";
import { similarity } from "../src/modules/community.ts";
import { call, type Client, findFood, signIn } from "./helpers.ts";

let rice: string;
let broccoli: string;
let lentils: string;

const uuid = () => crypto.randomUUID();
const ingredient = (foodId: string, quantity: number) => ({ id: uuid(), foodId, quantity, unit: "g", role: "ingredient" });

beforeAll(async () => {
  rice = await findFood("Rice, white, long-grain, regular, enriched, cooked");
  broccoli = await findFood("Broccoli, raw");
  lentils = await findFood("Lentils, mature seeds, cooked, boiled, without salt");
});
afterAll(() => pool.end());

async function recipe(client: Client, title: string, foods: string[], extra: Record<string, unknown> = {}) {
  const res = await client.request("/v1/recipes", {
    method: "POST",
    json: { title, servings: 2, method: "My own steps.", ingredients: foods.map((f) => ingredient(f, 200)), ...extra },
  });
  expect(res.status).toBe(201);
  return (await res.json()) as { id: string; version: number };
}

async function share(client: Client, recipeId: string, includeMethod = false) {
  const res = await client.request(`/v1/recipes/${recipeId}/community`, { method: "PUT", json: { includeMethod } });
  expect(res.status).toBe(200);
  return CommunityStatusSchema.parse(await res.json());
}

const home = async (client: Client) => CommunityHomeSchema.parse(await (await client.request("/v1/community/home?today=2026-11-11")).json());

describe("favorites", () => {
  const batch = async (client: Client, operations: unknown[]) => {
    const res = await client.request("/v1/sync/batch", { method: "POST", json: { protocol: 1, operations } });
    expect(res.status).toBe(200);
    return SyncBatchResponseSchema.parse(await res.json()).results;
  };
  const fav = (recipeId: string, entityId = uuid()) => ({ opId: uuid(), type: "favorite.create" as const, entityId, body: { recipeId } });

  it("keeps one favorite per recipe across devices, replays safely, tombstones and exports", async () => {
    const hal = await signIn();
    const r = await recipe(hal, "Plain rice", [rice]);
    const phone = fav(r.id);
    const laptop = fav(r.id);
    const results = await batch(hal, [phone, phone, laptop]);
    expect(results.map((x) => [x.status, x.replayed])).toEqual([["applied", false], ["applied", true], ["applied", false]]);
    let changes = SyncChangesResponseSchema.parse(await (await hal.request("/v1/sync/changes")).json()).changes.filter((c) => c.entity === "recipe_favorite");
    // The newest tap's record is the live one; the other device's is retired.
    expect(changes.find((c) => c.entityId === phone.entityId)).toMatchObject({ deleted: true, favorite: null });
    expect(changes.find((c) => c.entityId === laptop.entityId)).toMatchObject({ deleted: false, favorite: { recipeId: r.id } });
    expect((await (await hal.request("/v1/me/export")).json()).favoriteRecipes).toHaveLength(1);

    expect((await batch(hal, [{ opId: uuid(), type: "favorite.delete", entityId: laptop.entityId }]))[0]!.status).toBe("applied");
    changes = SyncChangesResponseSchema.parse(await (await hal.request("/v1/sync/changes")).json()).changes.filter((c) => c.entity === "recipe_favorite");
    expect(changes.every((c) => c.deleted)).toBe(true);
  });

  it("refuses recipes the person cannot open and never crosses accounts", async () => {
    const [hal, ivy] = await Promise.all([signIn(), signIn()]);
    const r = await recipe(hal, "Hal's rice", [rice]);
    const mine = fav(r.id);
    await batch(hal, [mine]);
    const results = await batch(ivy, [fav(r.id), { ...mine, opId: uuid() }, { opId: uuid(), type: "favorite.delete", entityId: mine.entityId }]);
    expect(results.map((x) => x.status)).toEqual(["rejected", "rejected", "rejected"]);
    const changes = SyncChangesResponseSchema.parse(await (await hal.request("/v1/sync/changes")).json()).changes;
    expect(changes.find((c) => c.entityId === mine.entityId)).toMatchObject({ deleted: false });
  });
});

describe("community recipes", () => {
  it("shares a reviewed snapshot with nothing about the author, and unsharing erases it", async () => {
    const [ann, ben] = await Promise.all([signIn(), signIn()]);
    const r = await recipe(ann, "Ann's broccoli rice", [rice, broccoli], { description: "Weeknight bowl." });
    const status = await share(ann, r.id);
    expect(status).toMatchObject({ recipeId: r.id, recipeVersion: 1, includeMethod: false, hidden: false });
    // Sharing again refreshes the same listing.
    expect((await share(ann, r.id, true)).communityId).toBe(status.communityId);

    const res = await ben.request(`/v1/community/${status.communityId}`);
    expect(res.status).toBe(200);
    const text = await res.text();
    const read = CommunityRecipeSchema.parse(JSON.parse(text));
    expect(read).toMatchObject({ title: "Ann's broccoli rice", description: "Weeknight bowl.", method: "My own steps.", mine: false, savedRecipeId: null });
    expect(text).not.toContain(ann.email);
    const { rows } = await pool.query<{ user_id: string }>("select user_id from community_recipes where id = $1", [status.communityId]);
    expect(text).not.toContain(rows[0]!.user_id);
    expect(text).not.toContain(r.id);

    // Signed out: nothing.
    expect((await call(`/v1/community/${status.communityId}`)).status).toBe(401);
    expect((await call("/v1/community/home")).status).toBe(401);
    // Only the author can see or change the listing's status.
    expect((await ben.request(`/v1/recipes/${r.id}/community`)).status).toBe(404);
    expect((await ben.request(`/v1/recipes/${r.id}/community`, { method: "PUT", json: { includeMethod: true } })).status).toBe(404);

    expect((await ann.request(`/v1/recipes/${r.id}/community`, { method: "DELETE" })).status).toBe(204);
    expect((await ben.request(`/v1/community/${status.communityId}`)).status).toBe(404);
    const erased = await pool.query<{ snapshot: unknown }>("select snapshot from community_recipes where id = $1", [status.communityId]);
    expect(erased.rows[0]!.snapshot).toEqual({});
  });

  it("deleting the recipe takes it out of the community; group recipes stay in their group", async () => {
    const ann = await signIn();
    const r = await recipe(ann, "Short-lived", [rice]);
    const status = await share(ann, r.id);
    const del = await ann.request(`/v1/recipes/${r.id}`, { method: "DELETE", headers: { "if-match": String(r.version) } });
    expect([200, 204]).toContain(del.status);
    const { rows } = await pool.query<{ unshared_at: Date | null }>("select unshared_at from community_recipes where id = $1", [status.communityId]);
    expect(rows[0]!.unshared_at).not.toBeNull();

    const group = await (await ann.request("/v1/groups", { method: "POST", json: { name: "Family", myName: "Ann" } })).json();
    const own = await recipe(ann, "Family rice", [rice]);
    const copy = await (await ann.request(`/v1/groups/${group.id}/recipes`, { method: "POST", json: { recipeId: own.id } })).json();
    expect((await ann.request(`/v1/recipes/${copy.id}/community`, { method: "PUT", json: { includeMethod: false } })).status).toBe(404);
  });

  it("saves a copy once per person, and trending counts different savers, not the author", async () => {
    const [ann, ben, cal, dee] = await Promise.all([signIn(), signIn(), signIn(), signIn()]);
    const popular = await share(ann, (await recipe(ann, "Popular lentils", [lentils])).id);
    const quiet = await share(ann, (await recipe(ann, "Quiet broccoli", [broccoli])).id);

    const saved = await ben.request(`/v1/community/${popular.communityId}/save`, { method: "POST" });
    expect(saved.status).toBe(201);
    const { recipeId } = await saved.json();
    const again = await (await ben.request(`/v1/community/${popular.communityId}/save`, { method: "POST" })).json();
    expect(again.recipeId).toBe(recipeId);
    const copy = await (await ben.request(`/v1/recipes/${recipeId}`)).json();
    expect(copy).toMatchObject({ title: "Popular lentils", groupId: null, image: null });
    expect(copy.ingredients[0].foodId).toBe(lentils);
    expect((await (await ben.request(`/v1/community/${popular.communityId}`)).json()).savedRecipeId).toBe(recipeId);

    await cal.request(`/v1/community/${popular.communityId}/save`, { method: "POST" });
    // The author saving their own does not count.
    await ann.request(`/v1/community/${quiet.communityId}/save`, { method: "POST" });
    await dee.request(`/v1/community/${quiet.communityId}/save`, { method: "POST" });

    const ids = (await home(dee)).trending.map((t) => t.communityId);
    expect(ids.indexOf(popular.communityId)).toBeGreaterThanOrEqual(0);
    expect(ids.indexOf(popular.communityId)).toBeLessThan(ids.indexOf(quiet.communityId));
    const card = (await home(ann)).trending.find((t) => t.communityId === popular.communityId)!;
    expect(card).toMatchObject({ title: "Popular lentils", mine: true });
    expect(Object.keys(card).sort()).toEqual(["communityId", "image", "kcalPerServing", "mine", "servings", "title"]);
  });

  it("hides a listing after three different people report it; the author still sees it", async () => {
    const [ann, ...others] = await Promise.all([signIn(), signIn(), signIn(), signIn(), signIn()]);
    const listing = await share(ann, (await recipe(ann, "Reported dish", [rice])).id);
    expect((await ann.request(`/v1/community/${listing.communityId}/report`, { method: "POST", json: { reason: "spam" } })).status).toBe(404);
    expect((await others[0]!.request(`/v1/community/${listing.communityId}/report`, { method: "POST", json: { reason: "nope" } })).status).toBe(400);
    for (const who of [others[0]!, others[0]!, others[1]!]) {
      expect((await who.request(`/v1/community/${listing.communityId}/report`, { method: "POST", json: { reason: "spam" } })).status).toBe(204);
    }
    expect((await others[3]!.request(`/v1/community/${listing.communityId}`)).status).toBe(200);
    await others[2]!.request(`/v1/community/${listing.communityId}/report`, { method: "POST", json: { reason: "offensive" } });
    expect((await others[3]!.request(`/v1/community/${listing.communityId}`)).status).toBe(404);
    expect((await home(others[3]!)).trending.map((t) => t.communityId)).not.toContain(listing.communityId);
    expect((await (await ann.request(`/v1/recipes/${listing.recipeId}/community`)).json()).hidden).toBe(true);
    expect((await ann.request(`/v1/community/${listing.communityId}`)).status).toBe(200);
  });

  it("suggests something unlike what the person cooks, never their own or one they saved", async () => {
    const [ann, eve] = await Promise.all([signIn(), signIn()]);
    const riceListing = await share(ann, (await recipe(ann, "More rice", [rice])).id);
    const lentilListing = await share(ann, (await recipe(ann, "Lentil stew", [lentils])).id);
    await recipe(eve, "Eve's rice", [rice]);
    const pick = (await home(eve)).adventure;
    expect(pick).not.toBeNull();
    expect(pick!.communityId).not.toBe(riceListing.communityId);
    expect(pick!.mine).toBe(false);
    await eve.request(`/v1/community/${lentilListing.communityId}/save`, { method: "POST" });
    expect((await home(eve)).adventure?.communityId).not.toBe(lentilListing.communityId);
    expect((await home(ann)).adventure?.mine ?? false).toBe(false);
  });

  it("scores overlap of foods and food categories", () => {
    const recent = { foods: new Set(["fdc:1"]), categories: new Set(["Grains"]) };
    expect(similarity({ foods: ["fdc:2"], categories: ["Legumes"] }, recent)).toBe(0);
    expect(similarity({ foods: ["fdc:1"], categories: ["Grains"] }, recent)).toBe(1);
    expect(similarity({ foods: ["fdc:3"], categories: ["Grains"] }, recent)).toBe(0.5);
  });

  it("answers 404 feature_disabled when switched off", async () => {
    const ann = await signIn();
    config.features.community = false;
    try {
      const res = await ann.request("/v1/community/home");
      expect(res.status).toBe(404);
      expect((await res.json()).error.code).toBe("feature_disabled");
    } finally {
      config.features.community = true;
    }
  });
});
