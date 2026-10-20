import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getMigrations } from "better-auth/db/migration";
import { PRIVACY_NOTICE, RecipeSchema, SharedRecipeSchema, ShareSchema, SyncBatchResponseSchema, SyncChangesResponseSchema, MAX_GOALS, NutritionSummarySchema } from "@betterplate/contracts";
import { authOptions } from "../src/auth.ts";
import { pool } from "../src/db/pool.ts";
import { generateOpenApi } from "../src/openapi-cli.ts";
import { runMaintenance } from "../src/jobs.ts";
import { REPO_ROOT } from "../src/config.ts";
import { call, type Client, findFood, food, signIn } from "./helpers.ts";

let alice: Client;
let bob: Client;
let oil: string;
let rice: string;
let broccoli: string;

const uuid = () => crypto.randomUUID();
const ingredient = (foodId: string, quantity: number, extra: Record<string, unknown> = {}) => ({
  id: uuid(), foodId, quantity, unit: "g", role: "ingredient", ...extra,
});

beforeAll(async () => {
  [alice, bob] = await Promise.all([signIn(), signIn()]);
  oil = await findFood("Oil, olive, salad or cooking");
  rice = await findFood("Rice, white, long-grain, regular, enriched, cooked");
  broccoli = await findFood("Broccoli, raw");
});
afterAll(() => pool.end());

describe("contract", () => {
  it("checked-in OpenAPI document matches the code", () => {
    const committed = readFileSync(path.join(REPO_ROOT, "apps/api/openapi.json"), "utf8");
    expect(committed, "run `pnpm openapi` and commit apps/api/openapi.json").toBe(generateOpenApi());
  });

  it("Better Auth needs no schema changes beyond the frozen migration", async () => {
    const m = await getMigrations(authOptions as never);
    expect(m.toBeCreated).toEqual([]);
    expect(m.toBeAdded).toEqual([]);
  });

  it("returns structured errors with a request id", async () => {
    const res = await call("/v1/nope");
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toMatchObject({ code: "not_found" });
    expect(body.error.requestId).toBe(res.headers.get("x-request-id"));
  });

  it("reports readiness with the loaded catalog version", async () => {
    const body = await (await call("/v1/health/ready")).json();
    expect(body.status).toBe("ok");
    expect(body.checks.catalog).toMatch(/^usda-sr-legacy-/);
  });
});

describe("catalog (USDA FoodData Central SR Legacy)", () => {
  it("serves a manifest and an attributed offline bundle", async () => {
    const manifest = await (await call("/v1/catalog/manifest")).json();
    const res = await call(manifest.bundleUrl);
    const bundle = await res.json();
    expect(bundle.foods.length).toBe(manifest.foodCount);
    expect(bundle.foods.length).toBeGreaterThanOrEqual(100);
    for (const f of bundle.foods) {
      expect(f.id).toBe(`fdc:${f.fdcId}`);
      expect(f.source.url).toBe(`https://fdc.nal.usda.gov/food-details/${f.fdcId}/nutrients`);
      expect(f.dataType).toBe("SR Legacy");
    }
    const etag = res.headers.get("etag")!;
    expect((await call(manifest.bundleUrl, { headers: { "if-none-match": etag } })).status).toBe(304);
    const gz = await call(manifest.bundleUrl, { headers: { "accept-encoding": "gzip" } });
    expect(gz.headers.get("content-encoding")).toBe("gzip");
  });

  it("searches, looks up and batch-looks-up foods", async () => {
    const search = await (await call("/v1/foods?query=broccoli")).json();
    expect(search.foods.map((f: { description: string }) => f.description)).toContain("Broccoli, raw");
    // Words in any order, plurals and partial words; same ranking as the offline search.
    const raw = await (await call("/v1/foods?query=raw%20brocc")).json();
    expect(raw.foods[0].description).toBe("Broccoli, raw");
    const page1 = await (await call("/v1/foods?query=raw&limit=2")).json();
    const page2 = await (await call(`/v1/foods?query=raw&limit=2&cursor=${page1.nextCursor}`)).json();
    expect(page1.foods).toHaveLength(2);
    expect(page2.foods[0].id).not.toBe(page1.foods[0].id);
    expect((await call("/v1/foods/fdc:1")).status).toBe(404);
    const batch = await (await call("/v1/foods/batch", { method: "POST", json: { ids: [oil, "fdc:1"] } })).json();
    expect(batch.foods).toHaveLength(1);
    expect(batch.missing).toEqual(["fdc:1"]);
  });

  it("rejects malformed input with details", async () => {
    const res = await call("/v1/foods?limit=500");
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("invalid_request");
  });
});

describe("authentication", () => {
  it("requires a session for personal data", async () => {
    expect((await call("/v1/me")).status).toBe(401);
    expect((await call("/v1/recipes")).status).toBe(401);
    expect((await call("/v1/sync/changes")).status).toBe(401);
  });

  it("signs in with an emailed one-time code", async () => {
    const me = await (await alice.request("/v1/me")).json();
    expect(me.email).toBe(alice.email);
  });

  it("rejects a wrong code", async () => {
    const email = `wrong-${uuid()}@example.test`;
    await call("/v1/auth/email-otp/send-verification-otp", { method: "POST", json: { email, type: "sign-in" } });
    const res = await call("/v1/auth/sign-in/email-otp", { method: "POST", json: { email, otp: "000000" } });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});

describe("recipes and server-side nutrition", () => {
  it("creates a recipe and recomputes nutrition from catalog records", async () => {
    const [o, r] = await Promise.all([food(oil), food(rice)]);
    const res = await alice.request("/v1/recipes", {
      method: "POST",
      json: {
        title: "Rice with olive oil",
        servings: 2,
        method: "Warm the rice, stir in the oil.",
        ingredients: [ingredient(rice, 300), ingredient(oil, 10, { role: "cooking_oil", oilDiscardedGrams: 2 })],
      },
    });
    expect(res.status).toBe(201);
    expect(res.headers.get("etag")).toBe('"v1"');
    const recipe = RecipeSchema.parse(await res.json());
    const energy = recipe.nutrition!.totals.find((t) => t.key === "energy_kcal")!;
    const expected = (r.nutrientsPer100g.energy_kcal! * 300) / 100 + (o.nutrientsPer100g.energy_kcal! * 8) / 100;
    expect(energy.amount).toBeCloseTo(expected, 9);
    expect(energy.status).toBe("known");
    expect(recipe.nutrition!.perServing.find((t) => t.key === "energy_kcal")!.amount).toBeCloseTo(expected / 2, 9);
    expect(recipe.nutrition!.catalogVersion).toMatch(/^usda-sr-legacy-/);
  });

  it("previews nutrition without saving and discloses unmeasured oil", async () => {
    const res = await alice.request("/v1/recipes/calculate", {
      method: "POST",
      json: { servings: 1, ingredients: [{ ...ingredient(oil, 1), unit: "portion", portionIndex: 0, role: "cooking_oil" }] },
    });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.disclosures.map((d: { code: string }) => d.code)).toContain("oil_discard_not_measured");
  });

  it("rejects foods that are not in the catalog", async () => {
    const res = await alice.request("/v1/recipes", { method: "POST", json: { title: "Mystery", servings: 1, ingredients: [ingredient("fdc:1", 10)] } });
    expect(res.status).toBe(422);
    expect((await res.json()).error.code).toBe("unknown_food");
  });

  it("requires If-Match and refuses stale versions without overwriting", async () => {
    const created = await (await alice.request("/v1/recipes", { method: "POST", json: { title: "Greens", servings: 1, ingredients: [ingredient(broccoli, 100)] } })).json();
    const body = { title: "Greens v2", servings: 1, ingredients: [ingredient(broccoli, 150)] };
    expect((await alice.request(`/v1/recipes/${created.id}`, { method: "PUT", json: body })).status).toBe(428);
    const ok = await alice.request(`/v1/recipes/${created.id}`, { method: "PUT", json: body, headers: { "if-match": '"v1"' } });
    expect(ok.status).toBe(200);
    expect(ok.headers.get("etag")).toBe('"v2"');
    const stale = await alice.request(`/v1/recipes/${created.id}`, { method: "PUT", json: { ...body, title: "Lost?" }, headers: { "if-match": '"v1"' } });
    expect(stale.status).toBe(412);
    const err = await stale.json();
    expect(err.error.details.server.title).toBe("Greens v2");
    expect((await (await alice.request(`/v1/recipes/${created.id}`)).json()).title).toBe("Greens v2");
  });

  it("stores markup as plain text (rendered escaped by clients)", async () => {
    const title = '<img src=x onerror="alert(1)">';
    const res = await alice.request("/v1/recipes", { method: "POST", json: { title, servings: 1, ingredients: [] } });
    expect(res.headers.get("content-type")).toContain("application/json");
    expect((await res.json()).title).toBe(title);
  });
});

describe("account isolation", () => {
  it("never exposes or modifies another user's recipe", async () => {
    const mine = await (await alice.request("/v1/recipes", { method: "POST", json: { title: "Alice only", servings: 1, ingredients: [] } })).json();
    expect((await bob.request(`/v1/recipes/${mine.id}`)).status).toBe(404);
    expect((await bob.request(`/v1/recipes/${mine.id}`, { method: "PUT", json: { title: "pwned", servings: 1, ingredients: [] }, headers: { "if-match": '"v1"' } })).status).toBe(404);
    expect((await bob.request(`/v1/recipes/${mine.id}`, { method: "DELETE", headers: { "if-match": '"v1"' } })).status).toBe(404);
    const list = await (await bob.request("/v1/recipes")).json();
    expect(list.recipes.map((r: { id: string }) => r.id)).not.toContain(mine.id);

    const sync = await bob.request("/v1/sync/batch", {
      method: "POST",
      json: { protocol: 1, operations: [{ opId: uuid(), type: "recipe.put", entityId: mine.id, baseVersion: 1, body: { title: "pwned", servings: 1, ingredients: [] } }] },
    });
    expect((await sync.json()).results[0]).toMatchObject({ status: "rejected", error: { code: "not_found" } });
    const changes = await (await bob.request("/v1/sync/changes")).json();
    expect(changes.changes.map((c: { entityId: string }) => c.entityId)).not.toContain(mine.id);
    expect((await (await alice.request(`/v1/recipes/${mine.id}`)).json()).title).toBe("Alice only");
  });
});

describe("batch sync protocol 1", () => {
  const put = (entityId: string, baseVersion: number | null, title: string, opId = uuid()) => ({
    opId, type: "recipe.put" as const, entityId, baseVersion, body: { title, servings: 2, ingredients: [ingredient(broccoli, 80)], method: "" },
  });
  const batch = async (client: Client, operations: unknown[]) => {
    const res = await client.request("/v1/sync/batch", { method: "POST", json: { protocol: 1, operations } });
    expect(res.status).toBe(200);
    return SyncBatchResponseSchema.parse(await res.json()).results;
  };

  it("applies ops idempotently: a replayed opId does not apply twice", async () => {
    const carol = await signIn();
    const id = uuid();
    const op = put(id, null, "Offline soup");
    const [first] = await batch(carol, [op]);
    expect(first).toMatchObject({ status: "applied", version: 1, replayed: false });
    const [again] = await batch(carol, [op]);
    expect(again).toMatchObject({ status: "applied", version: 1, replayed: true });
    const { rows } = await pool.query("select count(*)::int as n from recipe_revisions where recipe_id = $1", [id]);
    expect(rows[0].n).toBe(1);
  });

  it("returns conflicts with the server copy instead of overwriting", async () => {
    const carol = await signIn();
    const id = uuid();
    await batch(carol, [put(id, null, "Base")]);
    await batch(carol, [put(id, 1, "Edited on phone")]);
    const [conflict] = await batch(carol, [put(id, 1, "Edited on laptop")]);
    expect(conflict).toMatchObject({ status: "conflict", version: 2 });
    expect(conflict!.server!.title).toBe("Edited on phone");
    // Keep local: resend on top of the server version with a new opId.
    const [resolved] = await batch(carol, [put(id, 2, "Edited on laptop")]);
    expect(resolved).toMatchObject({ status: "applied", version: 3 });
  });

  it("partially succeeds and reports each operation", async () => {
    const carol = await signIn();
    const okId = uuid();
    const results = await batch(carol, [put(okId, null, "Good"), { ...put(uuid(), null, "Bad"), body: { title: "Bad", servings: 1, ingredients: [ingredient("fdc:1", 5)], method: "" } }, put(uuid(), 5, "Ghost")]);
    expect(results.map((r) => r.status)).toEqual(["applied", "rejected", "conflict"]);
    expect((await carol.request(`/v1/recipes/${okId}`)).status).toBe(200);
  });

  it("serializes concurrent edits of the same version: one wins, one conflicts", async () => {
    const carol = await signIn();
    const id = uuid();
    await batch(carol, [put(id, null, "Start")]);
    const [a, b] = await Promise.all([batch(carol, [put(id, 1, "Device A")]), batch(carol, [put(id, 1, "Device B")])]);
    expect([a[0]!.status, b[0]!.status].sort()).toEqual(["applied", "conflict"]);
  });

  it("pulls changes by cursor in order, with deletion tombstones", async () => {
    const dave = await signIn();
    const ids = [uuid(), uuid(), uuid()];
    await batch(dave, ids.map((id, i) => put(id, null, `R${i}`)));
    await batch(dave, [{ opId: uuid(), type: "recipe.delete", entityId: ids[0], baseVersion: 1 }]);

    const page1 = SyncChangesResponseSchema.parse(await (await dave.request("/v1/sync/changes?limit=2")).json());
    expect(page1.changes).toHaveLength(2);
    expect(page1.hasMore).toBe(true);
    const page2 = SyncChangesResponseSchema.parse(await (await dave.request(`/v1/sync/changes?cursor=${page1.cursor}&limit=2`)).json());
    const all = [...page1.changes, ...page2.changes];
    expect(all.map((c) => c.entityId).sort()).toEqual([...ids].sort());
    const seqs = all.map((c) => BigInt(c.seq));
    expect([...seqs].sort((x, y) => (x < y ? -1 : 1))).toEqual(seqs);
    const tomb = all.find((c) => c.entityId === ids[0])!;
    expect(tomb).toMatchObject({ deleted: true, recipe: null });
    const { rows } = await pool.query("select title, body from recipes where id = $1", [ids[0]]);
    expect(rows[0]).toEqual({ title: "", body: {} });
  });

  it("bounds batch size", async () => {
    const ops = Array.from({ length: 101 }, () => put(uuid(), null, "x"));
    const res = await alice.request("/v1/sync/batch", { method: "POST", json: { protocol: 1, operations: ops } });
    expect(res.status).toBe(400);
  });
});

describe("planned and eaten meals", () => {
  const batch = async (client: Client, operations: unknown[]) => {
    const res = await client.request("/v1/sync/batch", { method: "POST", json: { protocol: 1, operations } });
    expect(res.status).toBe(200);
    return SyncBatchResponseSchema.parse(await res.json()).results;
  };
  const recipeSnapshot = () => ({ title: "Lemon rice", servings: 2, ingredients: [ingredient(rice, 300), ingredient(broccoli, 150)] });
  const log = (body: Record<string, unknown> = {}) => ({
    opId: uuid(), type: "log.create" as const, entityId: uuid(),
    body: { plannedMealId: null, recipeId: uuid(), recipe: recipeSnapshot(), servings: 1, slot: "lunch", localDate: "2026-10-19", eatenAt: "2026-10-19T12:30:00-03:00", ...body },
  });
  const plan = (entityId: string, baseVersion: number | null, date = "2026-10-19", title = "Lemon rice") => ({
    opId: uuid(), type: "plan.put" as const, entityId, baseVersion, body: { date, slot: "dinner", recipeId: uuid(), title, servings: 1 },
  });

  it("keeps plans and eaten logs separate; a plan never counts as eaten", async () => {
    const fay = await signIn();
    const planId = uuid();
    expect((await batch(fay, [plan(planId, null)]))[0]).toMatchObject({ status: "applied", version: 1 });
    const meals = await (await fay.request("/v1/meals?from=2026-10-19&to=2026-10-19")).json();
    expect(meals.planned).toHaveLength(1);
    expect(meals.eaten).toEqual([]);
  });

  it("logs a meal with a server-computed nutrition snapshot scaled by servings eaten", async () => {
    const fay = await signIn();
    const op = log({ servings: 1.5 });
    expect((await batch(fay, [op]))[0]).toMatchObject({ status: "applied" });
    const meals = await (await fay.request("/v1/meals?from=2026-10-19&to=2026-10-19")).json();
    const [eaten] = meals.eaten;
    const [r, b] = [await food(rice), await food(broccoli)];
    const kcalPerServing = (r.nutrientsPer100g.energy_kcal! * 3 + b.nutrientsPer100g.energy_kcal! * 1.5) / 2;
    expect(eaten.nutrition.perServing.find((t: { key: string }) => t.key === "energy_kcal").amount).toBeCloseTo(kcalPerServing, 6);
    expect(eaten.eaten.find((t: { key: string }) => t.key === "energy_kcal").amount).toBeCloseTo(kcalPerServing * 1.5, 6);
    expect(eaten.nutrition.catalogVersion).toMatch(/^usda-sr-legacy-/);
    expect(eaten.localDate).toBe("2026-10-19");
  });

  it("never logs the same meal twice, even with a new opId; separate meals are kept apart", async () => {
    const fay = await signIn();
    const op = log();
    await batch(fay, [op]);
    const [dupe] = await batch(fay, [{ ...op, opId: uuid() }]);
    expect(dupe!.status).toBe("applied");
    const [replay] = await batch(fay, [op]);
    expect(replay!.replayed).toBe(true);
    await batch(fay, [log()]);
    const meals = await (await fay.request("/v1/meals?from=2026-10-19&to=2026-10-19")).json();
    expect(meals.eaten).toHaveLength(2);
  });

  it("keeps history on the eater's own calendar day across time zones", async () => {
    const fay = await signIn();
    // 23:30 in Santiago is already the next day in UTC; the log stays on the local day.
    await batch(fay, [log({ localDate: "2026-10-19", eatenAt: "2026-10-19T23:30:00-03:00" })]);
    const day = await (await fay.request("/v1/meals?from=2026-10-19&to=2026-10-19")).json();
    expect(day.eaten).toHaveLength(1);
    expect((await (await fay.request("/v1/meals?from=2026-10-20&to=2026-10-20")).json()).eaten).toEqual([]);
  });

  it("preserves the snapshot when the catalog-backed recipe changes later", async () => {
    const fay = await signIn();
    const op = log();
    await batch(fay, [op]);
    const { rows } = await pool.query("select nutrition from consumption_events where id = $1", [op.entityId]);
    const before = rows[0].nutrition;
    await batch(fay, [{ opId: uuid(), type: "recipe.put", entityId: op.body.recipeId, baseVersion: null, body: { title: "Lemon rice v2", servings: 1, ingredients: [ingredient(oil, 50)], method: "" } }]);
    const after = (await pool.query("select nutrition from consumption_events where id = $1", [op.entityId])).rows[0].nutrition;
    expect(after).toEqual(before);
  });

  it("rejects logs that reference foods not in the catalog", async () => {
    const fay = await signIn();
    const [res] = await batch(fay, [log({ recipe: { title: "x", servings: 1, ingredients: [ingredient("fdc:1", 5)] } })]);
    expect(res).toMatchObject({ status: "rejected", error: { code: "unknown_food" } });
  });

  it("returns plan conflicts with the server copy and retracts logs with tombstones", async () => {
    const fay = await signIn();
    const planId = uuid();
    await batch(fay, [plan(planId, null)]);
    await batch(fay, [plan(planId, 1, "2026-10-20", "Moved on phone")]);
    const [conflict] = await batch(fay, [plan(planId, 1, "2026-10-21", "Moved on laptop")]);
    expect(conflict).toMatchObject({ status: "conflict", version: 2 });
    expect(conflict!.serverPlannedMeal).toMatchObject({ date: "2026-10-20", title: "Moved on phone" });

    const op = log();
    await batch(fay, [op]);
    await batch(fay, [{ opId: uuid(), type: "log.delete", entityId: op.entityId }]);
    const changes = SyncChangesResponseSchema.parse(await (await fay.request("/v1/sync/changes")).json()).changes;
    expect(changes.find((c) => c.entityId === op.entityId)).toMatchObject({ entity: "meal_log", deleted: true, mealLog: null });
    expect(changes.find((c) => c.entityId === planId)).toMatchObject({ entity: "planned_meal", plannedMeal: { title: "Moved on phone" } });
    const { rows } = await pool.query("select recipe, nutrition from consumption_events where id = $1", [op.entityId]);
    expect(rows[0]).toEqual({ recipe: {}, nutrition: {} });
  });

  it("never exposes or touches another user's meals", async () => {
    const [fay, gus] = await Promise.all([signIn(), signIn()]);
    const planId = uuid();
    const op = log();
    await batch(fay, [plan(planId, null), op]);
    expect((await (await gus.request("/v1/meals?from=2026-10-19&to=2026-10-19")).json())).toMatchObject({ planned: [], eaten: [] });
    const results = await batch(gus, [plan(planId, 1, "2026-10-19", "hijack"), { opId: uuid(), type: "log.delete", entityId: op.entityId }, { ...op, opId: uuid() }]);
    expect(results.map((r) => r.status)).toEqual(["rejected", "rejected", "rejected"]);
    expect((await (await fay.request("/v1/meals?from=2026-10-19&to=2026-10-19")).json()).eaten).toHaveLength(1);
  });

  it("bounds the date range", async () => {
    expect((await alice.request("/v1/meals?from=2026-10-01&to=2026-12-01")).status).toBe(400);
    expect((await alice.request("/v1/meals?from=2026-10-20&to=2026-10-19")).status).toBe(400);
  });
});

describe("consumption goals and period totals", () => {
  const batch = async (client: Client, operations: unknown[]) => {
    const res = await client.request("/v1/sync/batch", { method: "POST", json: { protocol: 1, operations } });
    expect(res.status).toBe(200);
    return SyncBatchResponseSchema.parse(await res.json()).results;
  };
  const goalBody = (body: Record<string, unknown> = {}) => ({
    nutrientKey: "protein", unit: "g", kind: "at_least", min: 120, max: null, period: "day", startDate: "2026-10-01", endDate: null, ...body,
  });
  const put = (entityId: string, baseVersion: number | null, body: Record<string, unknown> = {}) => ({ opId: uuid(), type: "goal.put" as const, entityId, baseVersion, body: goalBody(body) });
  const log = (localDate: string, servings = 1) => ({
    opId: uuid(), type: "log.create" as const, entityId: uuid(),
    body: { plannedMealId: null, recipeId: uuid(), recipe: { title: "Rice", servings: 1, ingredients: [ingredient(rice, 200)] }, servings, slot: "lunch", localDate, eatenAt: `${localDate}T12:00:00-03:00` },
  });

  it("stores goals through sync, versioned, with conflicts and tombstones", async () => {
    const hal = await signIn();
    const id = uuid();
    expect((await batch(hal, [put(id, null)]))[0]).toMatchObject({ status: "applied", version: 1 });
    expect((await batch(hal, [put(id, 1, { min: 150 })]))[0]).toMatchObject({ status: "applied", version: 2 });
    const [conflict] = await batch(hal, [put(id, 1, { min: 90 })]);
    expect(conflict).toMatchObject({ status: "conflict", version: 2 });
    expect(conflict!.serverGoal).toMatchObject({ min: 150, version: 2 });
    const { goals } = await (await hal.request("/v1/goals")).json();
    expect(goals).toEqual([expect.objectContaining({ id, ...goalBody({ min: 150 }), version: 2 })]);

    expect((await batch(hal, [{ opId: uuid(), type: "goal.delete", entityId: id, baseVersion: 2 }]))[0]).toMatchObject({ status: "applied", version: 3 });
    expect((await (await hal.request("/v1/goals")).json()).goals).toEqual([]);
    const changes = SyncChangesResponseSchema.parse(await (await hal.request("/v1/sync/changes")).json()).changes;
    expect(changes.find((c) => c.entityId === id)).toMatchObject({ entity: "goal", deleted: true, goal: null });
  });

  it("rejects goals with inconsistent numbers, dates, nutrients or units, and caps how many", async () => {
    const hal = await signIn();
    const bad = [
      { kind: "at_least", min: null },
      { kind: "at_most", min: 10, max: 20 },
      { kind: "between", min: 30, max: 20 },
      { endDate: "2026-09-30" },
      { nutrientKey: "body_weight" },
      { unit: "mg" },
    ];
    const results = await batch(hal, bad.map((b) => put(uuid(), null, b)));
    expect(results.map((r) => r.status)).toEqual(bad.map(() => "rejected"));
    expect(results.every((r) => r.error?.code === "invalid_goal")).toBe(true);
    // Schema-level problems (negative amounts, bad dates, unknown kinds) fail validation outright.
    const res = await hal.request("/v1/sync/batch", { method: "POST", json: { protocol: 1, operations: [put(uuid(), null, { min: -5 })] } });
    expect(res.status).toBe(400);

    await batch(hal, Array.from({ length: MAX_GOALS }, () => put(uuid(), null)));
    const [over] = await batch(hal, [put(uuid(), null)]);
    expect(over).toMatchObject({ status: "rejected", error: { code: "goal_limit" } });
  });

  it("never exposes or touches another person's goals", async () => {
    const [hal, ivy] = await Promise.all([signIn(), signIn()]);
    const id = uuid();
    await batch(hal, [put(id, null)]);
    expect((await (await ivy.request("/v1/goals")).json()).goals).toEqual([]);
    const results = await batch(ivy, [put(id, 1, { min: 1 }), { opId: uuid(), type: "goal.delete", entityId: id, baseVersion: 1 }]);
    expect(results.map((r) => r.status)).toEqual(["rejected", "rejected"]);
    expect((await (await hal.request("/v1/goals")).json()).goals[0]).toMatchObject({ min: 120, version: 1 });
    expect((await call("/v1/goals")).status).toBe(401);
    expect((await call("/v1/nutrition/summary?from=2026-10-01&to=2026-10-07")).status).toBe(401);
  });

  it("totals only eaten meals over a range, averaging per logged day, and bounds the range", async () => {
    const hal = await signIn();
    await batch(hal, [
      log("2026-10-05"),
      log("2026-10-07", 2),
      log("2026-10-09"),
      { opId: uuid(), type: "plan.put", entityId: uuid(), baseVersion: null, body: { date: "2026-10-06", slot: "dinner", recipeId: uuid(), title: "Plan only", servings: 3 } },
    ]);
    const res = await hal.request("/v1/nutrition/summary?from=2026-10-01&to=2026-10-07");
    expect(res.status).toBe(200);
    const summary = NutritionSummarySchema.parse(await res.json());
    expect(summary).toMatchObject({ from: "2026-10-01", to: "2026-10-07", days: 7, daysLogged: 2, incomplete: true });
    const kcal100 = (await food(rice)).nutrientsPer100g.energy_kcal!;
    const energy = summary.nutrients.find((n) => n.key === "energy_kcal")!;
    expect(energy.total).toBeCloseTo(kcal100 * 2 * 3, 6);
    expect(energy.averagePerLoggedDay).toBeCloseTo((kcal100 * 2 * 3) / 2, 6);
    expect(energy.status).toBe("known");

    expect((await hal.request("/v1/nutrition/summary?from=2026-10-07&to=2026-10-01")).status).toBe(400);
    expect((await hal.request("/v1/nutrition/summary?from=2025-01-01&to=2026-10-01")).status).toBe(400);
  });

  it("includes goals in the account download", async () => {
    const hal = await signIn();
    await batch(hal, [put(uuid(), null, { period: "week", kind: "between", min: 700, max: 900, endDate: "2026-12-31" })]);
    const data = await (await hal.request("/v1/me/export")).json();
    expect(data.goals).toEqual([expect.objectContaining(goalBody({ period: "week", kind: "between", min: 700, max: 900, endDate: "2026-12-31" }))]);
  });
});

describe("issue reports", () => {
  const report = (extra: Record<string, unknown> = {}) => ({
    id: uuid(),
    kind: "bug",
    message: "Save failed after swapping broccoli",
    activity: [{ at: new Date().toISOString(), event: "Opened a recipe" }, { at: new Date().toISOString(), event: "Save failed" }],
    context: { route: "/recipe/x", appVersion: "test", deviceClass: "phone", online: true, requestIds: ["req-1"], error: { message: "boom token sk-abcdefghijklmnopqrstuv", stack: "at save (app.js:1:1)" } },
    screenshot: null,
    ...extra,
  });
  // 1×1 PNG test fixture.
  const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

  it("accepts a report from a signed-in person, idempotently, and redacts secrets", async () => {
    const body = report({ screenshot: PNG });
    const first = await alice.request("/v1/feedback", { method: "POST", json: body });
    expect(first.status).toBe(201);
    const again = await alice.request("/v1/feedback", { method: "POST", json: body });
    expect(again.status).toBe(200);
    expect((await again.json()).duplicate).toBe(true);
    const { rows } = await pool.query("select user_id, context, screenshot_type, length(screenshot) as n, status from feedback_reports where id = $1", [body.id]);
    expect(rows[0]).toMatchObject({ screenshot_type: "image/png", status: "new" });
    expect(rows[0].n).toBeGreaterThan(0);
    expect(rows[0].context.error.message).toBe("boom token [removed]");
  });

  it("accepts a report from the sign-in screen without an account", async () => {
    const res = await call("/v1/feedback", { method: "POST", json: report() });
    expect(res.status).toBe(201);
  });

  it("rejects spoofed or oversized screenshots and empty messages", async () => {
    const fake = await call("/v1/feedback", { method: "POST", json: report({ screenshot: "data:image/png;base64,PHN2Zz48L3N2Zz4=" }) });
    expect(fake.status).toBe(400);
    const svg = await call("/v1/feedback", { method: "POST", json: report({ screenshot: "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=" }) });
    expect(svg.status).toBe(400);
    expect((await call("/v1/feedback", { method: "POST", json: report({ message: " " }) })).status).toBe(400);
  });

  it("does not let someone else reuse a report id", async () => {
    const body = report();
    await alice.request("/v1/feedback", { method: "POST", json: body });
    expect((await bob.request("/v1/feedback", { method: "POST", json: body })).status).toBe(409);
  });
});

describe("request safety", () => {
  it("rejects cross-site origins and non-JSON bodies on mutations", async () => {
    const evil = await alice.request("/v1/recipes", { method: "POST", json: { title: "x", servings: 1, ingredients: [] }, headers: { origin: "https://evil.example" } });
    expect(evil.status).toBe(403);
    const form = await alice.request("/v1/recipes", { method: "POST", body: "title=x", headers: { "content-type": "application/x-www-form-urlencoded" } });
    expect(form.status).toBe(415);
  });

  it("keeps unreleased chef features off server-side, even with forged client flags", async () => {
    const res = await alice.request("/v1/chef/orders", { method: "POST", json: { flags: { chef: true } }, headers: { "x-feature-chef": "on" } });
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("feature_disabled");
  });

  it("does not expose the dev mailbox outside local/test", async () => {
    // Guarded by config.isLocal; this run is APP_ENV=test so it is reachable here.
    expect((await call("/v1/dev/mailbox")).status).toBe(200);
  });
});

describe("rate limiting", () => {
  it("answers 429 with Retry-After once a client exceeds its budget", async () => {
    const { Hono } = await import("hono");
    const { rateLimit } = await import("../src/lib/http.ts");
    const { config } = await import("../src/config.ts");
    const mini = new Hono();
    mini.use("*", async (c, next) => { c.set("user" as never, null as never); await next(); });
    mini.use("*", rateLimit("test", 1, 60));
    mini.get("/x", (c) => c.text("ok"));
    mini.onError((err, c) => c.json({ code: (err as { code?: string }).code }, (err as { status?: number }).status as 429));
    const max = Math.round(1 * config.rateLimitMultiplier);
    const hit = () => mini.request("/x", { headers: { "x-forwarded-for": "203.0.113.9" } });
    for (let i = 0; i < max; i++) expect((await hit()).status).toBe(200);
    const limited = await hit();
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
    // Another client is unaffected.
    expect((await mini.request("/x", { headers: { "x-forwarded-for": "203.0.113.10" } })).status).toBe(200);
  });
});

describe("recipe description", () => {
  it("is stored, returned, synced and limited to 500 characters", async () => {
    const created = await alice.request("/v1/recipes", { method: "POST", json: { title: "Described", description: "  Bright and quick.  ", servings: 1, ingredients: [] } });
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as { id: string };
    expect((await (await alice.request(`/v1/recipes/${id}`)).json()).description).toBe("Bright and quick.");
    const changes = await (await alice.request("/v1/sync/changes?cursor=0&limit=500")).json();
    expect(JSON.stringify(changes)).toContain("Bright and quick.");
    // Recipes saved without one read back as an empty description.
    const plain = (await (await alice.request("/v1/recipes", { method: "POST", json: { title: "Plain", servings: 1, ingredients: [] } })).json()) as { id: string };
    expect((await (await alice.request(`/v1/recipes/${plain.id}`)).json()).description).toBe("");
    expect((await alice.request("/v1/recipes", { method: "POST", json: { title: "Long", description: "x".repeat(501), servings: 1, ingredients: [] } })).status).toBe(400);
  });
});

describe("recipe share links", () => {
  async function shareable(client: Client, extra: Record<string, unknown> = {}) {
    return (await (await client.request("/v1/recipes", {
      method: "POST",
      json: { title: "Rice bowl", description: "A warm bowl for busy nights.", servings: 2, method: "Secret family step.", ingredients: [ingredient(rice, 300), ingredient(oil, 10, { role: "cooking_oil" })], ...extra },
    })).json()) as { id: string; version: number };
  }

  it("publishes a snapshot with only the reviewed fields, readable without signing in", async () => {
    const r = await shareable(alice);
    const res = await alice.request(`/v1/recipes/${r.id}/share`, { method: "POST", json: { includeMethod: false } });
    expect(res.status).toBe(201);
    const share = ShareSchema.parse(await res.json());
    expect(share.url).toMatch(new RegExp(`/s/${share.shareId}$`));
    expect(share.recipeVersion).toBe(1);

    const pub = await call(`/v1/shared/${share.shareId}`);
    expect(pub.status).toBe(200);
    expect(pub.headers.get("cache-control")).toBe("no-store");
    const text = await pub.text();
    const shared = SharedRecipeSchema.parse(JSON.parse(text));
    expect(shared.title).toBe("Rice bowl");
    expect(shared.description).toBe("A warm bowl for busy nights.");
    expect(shared.method).toBeNull();
    expect(shared.ingredients[0]!.name).toMatch(/^Rice, white/);
    expect(shared.nutrition.disclosures.map((d) => d.code)).toContain("oil_discard_not_measured");
    // Nothing about the owner or their other data.
    expect(text).not.toContain(alice.email);
    expect(text).not.toContain("Secret family step");
    expect(Object.keys(JSON.parse(text)).sort()).toEqual(["description", "expiresAt", "image", "ingredients", "method", "nutrientNames", "nutrition", "servings", "shareId", "sharedAt", "source", "title"]);

    const withMethod = await (await alice.request(`/v1/recipes/${r.id}/share`, { method: "POST", json: { includeMethod: true } })).json();
    expect((await (await call(`/v1/shared/${withMethod.shareId}`)).json()).method).toBe("Secret family step.");
  });

  it("keeps the shared version when the recipe is edited later", async () => {
    const r = await shareable(alice);
    const share = await (await alice.request(`/v1/recipes/${r.id}/share`, { method: "POST", json: { includeMethod: false } })).json();
    await alice.request(`/v1/recipes/${r.id}`, { method: "PUT", headers: { "if-match": '"v1"' }, json: { title: "Renamed privately", servings: 2, ingredients: [] } });
    expect((await (await call(`/v1/shared/${share.shareId}`)).json()).title).toBe("Rice bowl");
  });

  it("revokes links: the snapshot is erased and the link stops working", async () => {
    const r = await shareable(alice);
    const share = await (await alice.request(`/v1/recipes/${r.id}/share`, { method: "POST", json: { includeMethod: true } })).json();
    const listed = await (await alice.request(`/v1/shares?recipeId=${r.id}`)).json();
    expect(listed.shares.map((s: { shareId: string }) => s.shareId)).toEqual([share.shareId]);

    expect((await bob.request(`/v1/shares/${share.shareId}`, { method: "DELETE" })).status).toBe(404);
    expect((await call(`/v1/shared/${share.shareId}`)).status).toBe(200);

    expect((await alice.request(`/v1/shares/${share.shareId}`, { method: "DELETE" })).status).toBe(204);
    expect((await call(`/v1/shared/${share.shareId}`)).status).toBe(404);
    expect((await call(`/s/${share.shareId}`)).status).toBe(404);
    const { rows } = await pool.query("select snapshot from share_snapshots where id = $1", [share.shareId]);
    expect(rows[0].snapshot).toEqual({});
    expect((await (await alice.request(`/v1/shares?recipeId=${r.id}`)).json()).shares).toEqual([]);
  });

  it("ends a recipe's links when the recipe is deleted", async () => {
    const r = await shareable(alice);
    const share = await (await alice.request(`/v1/recipes/${r.id}/share`, { method: "POST", json: { includeMethod: false } })).json();
    expect((await alice.request(`/v1/recipes/${r.id}`, { method: "DELETE", headers: { "if-match": '"v1"' } })).status).toBe(204);
    expect((await call(`/v1/shared/${share.shareId}`)).status).toBe(404);
  });

  it("expires links that were given an expiry", async () => {
    const r = await shareable(alice);
    const share = await (await alice.request(`/v1/recipes/${r.id}/share`, { method: "POST", json: { includeMethod: false, expiresInDays: 7 } })).json();
    expect(share.expiresAt).not.toBeNull();
    await pool.query("update share_snapshots set expires_at = now() - interval '1 second' where id = $1", [share.shareId]);
    expect((await call(`/v1/shared/${share.shareId}`)).status).toBe(404);
  });

  it("only lets the owner share, and needs a session", async () => {
    const r = await shareable(alice);
    expect((await bob.request(`/v1/recipes/${r.id}/share`, { method: "POST", json: { includeMethod: false } })).status).toBe(404);
    expect((await call(`/v1/recipes/${r.id}/share`, { method: "POST", json: { includeMethod: false } })).status).toBe(401);
    expect((await call(`/v1/shared/${uuid()}`)).status).toBe(404);
    expect((await call("/v1/shared/not-a-uuid")).status).toBe(400);
  });

  it("serves an escaped link preview page that sends people to the app", async () => {
    const r = await shareable(alice, { title: '<script>alert("x")</script> & co' });
    const share = await (await alice.request(`/v1/recipes/${r.id}/share`, { method: "POST", json: { includeMethod: false } })).json();
    const page = await call(`/s/${share.shareId}`);
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; co");
    expect(html).toContain(`/#/shared/${share.shareId}`);
    expect(html).not.toContain(alice.email);
  });
});

describe("privacy notice consent", () => {
  it("records agreement to the current notice version, append-only", async () => {
    const hal = await signIn();
    const me = await (await hal.request("/v1/me")).json();
    expect(me.privacy).toEqual({ currentVersion: PRIVACY_NOTICE.version, acceptedVersion: null });

    expect((await hal.request("/v1/me/consent", { method: "POST", json: { noticeVersion: "1999-01-01", adultConfirmed: true } })).status).toBe(409);
    expect((await hal.request("/v1/me/consent", { method: "POST", json: { noticeVersion: PRIVACY_NOTICE.version, adultConfirmed: false } })).status).toBe(400);
    expect((await call("/v1/me/consent", { method: "POST", json: { noticeVersion: PRIVACY_NOTICE.version, adultConfirmed: true } })).status).toBe(401);

    const ok = await hal.request("/v1/me/consent", { method: "POST", json: { noticeVersion: PRIVACY_NOTICE.version, adultConfirmed: true } });
    expect(ok.status).toBe(201);
    expect((await ok.json()).acceptedVersion).toBe(PRIVACY_NOTICE.version);
    expect((await (await hal.request("/v1/me")).json()).privacy.acceptedVersion).toBe(PRIVACY_NOTICE.version);

    const { rows } = await pool.query("select n.content_sha256, n.review_status from privacy_notices n where version = $1", [PRIVACY_NOTICE.version]);
    expect(rows[0].content_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(rows[0].review_status).toBe("draft");
    const exported = await (await hal.request("/v1/me/export")).json();
    expect(exported.privacyConsents).toEqual([expect.objectContaining({ noticeVersion: PRIVACY_NOTICE.version, action: "accepted", adultConfirmed: true })]);
  });
});

describe("maintenance", () => {
  it("prunes idempotency records after the retention period and expired sessions, never live ones", async () => {
    const ivy = await signIn();
    const opId = uuid();
    await ivy.request("/v1/sync/batch", { method: "POST", json: { protocol: 1, operations: [{ opId, type: "recipe.put", entityId: uuid(), baseVersion: null, body: { title: "Old op", servings: 1, ingredients: [] } }] } });
    const recent = uuid();
    await ivy.request("/v1/sync/batch", { method: "POST", json: { protocol: 1, operations: [{ opId: recent, type: "recipe.put", entityId: uuid(), baseVersion: null, body: { title: "New op", servings: 1, ingredients: [] } }] } });
    await pool.query(`update sync_operations set created_at = now() - interval '31 days' where op_id = $1`, [opId]);
    const expiredUser = await signIn();
    await pool.query(`update "sessions" set "expiresAt" = now() - interval '1 minute' where "userId" = (select id from "users" where email = $1)`, [expiredUser.email]);

    const result = await runMaintenance();
    expect(result!.syncOperations).toBeGreaterThanOrEqual(1);
    expect(result!.sessions).toBeGreaterThanOrEqual(1);
    const left = await pool.query("select op_id from sync_operations where op_id = any($1)", [[opId, recent]]);
    expect(left.rows.map((r) => r.op_id)).toEqual([recent]);
    expect((await ivy.request("/v1/me")).status).toBe(200);
    expect((await expiredUser.request("/v1/me")).status).toBe(401);
  });
});

describe("data export", () => {
  it("downloads everything stored about the account and nothing about anyone else", async () => {
    const gus = await signIn();
    const r = await (await gus.request("/v1/recipes", { method: "POST", json: { title: "Gus rice", servings: 1, ingredients: [ingredient(rice, 100)] } })).json();
    await gus.request(`/v1/recipes/${r.id}`, { method: "PUT", headers: { "if-match": '"v1"' }, json: { title: "Gus rice v2", servings: 1, ingredients: [ingredient(rice, 120)] } });
    const ops = [
      { opId: uuid(), type: "plan.put", entityId: uuid(), baseVersion: null, body: { date: "2026-10-20", slot: "dinner", recipeId: r.id, title: "Gus rice v2", servings: 1 } },
      { opId: uuid(), type: "log.create", entityId: uuid(), body: { plannedMealId: null, recipeId: r.id, recipe: { title: "Gus rice v2", servings: 1, ingredients: [ingredient(rice, 120)] }, servings: 1, slot: "lunch", localDate: "2026-10-19", eatenAt: "2026-10-19T12:00:00-03:00" } },
    ];
    expect((await gus.request("/v1/sync/batch", { method: "POST", json: { protocol: 1, operations: ops } })).status).toBe(200);
    await gus.request(`/v1/recipes/${r.id}/share`, { method: "POST", json: { includeMethod: false } });
    await gus.request("/v1/feedback", { method: "POST", json: { id: uuid(), kind: "feedback", message: "Lovely", activity: [], context: { route: "/you", appVersion: "test", deviceClass: "desktop", online: true, requestIds: [], error: null }, screenshot: null } });

    expect((await call("/v1/me/export")).status).toBe(401);
    const res = await gus.request("/v1/me/export");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toMatch(/^attachment; filename="better-plate-export-\d{4}-\d{2}-\d{2}\.json"$/);
    const text = await res.text();
    const data = JSON.parse(text);
    expect(data.format).toBe("betterplate.export/1");
    expect(data.account.email).toBe(gus.email);
    expect(data.linkedSignIns).toEqual([]);
    expect(data.sessions.length).toBeGreaterThan(0);
    expect(data.recipes.map((x: { title: string }) => x.title)).toEqual(["Gus rice v2"]);
    expect(data.recipeRevisions.map((x: { version: number }) => x.version)).toEqual([1, 2]);
    expect(data.plannedMeals).toHaveLength(1);
    expect(data.mealsEaten).toHaveLength(1);
    expect(data.mealsEaten[0].nutrition.catalogVersion).toMatch(/^usda-sr-legacy-/);
    expect(data.shareLinks).toHaveLength(1);
    expect(data.issueReports.map((x: { message: string }) => x.message)).toEqual(["Lovely"]);
    // Nothing about other accounts, and no secrets.
    expect(text).not.toContain(alice.email);
    expect(text).not.toMatch(/"token"|"password"|accessToken|refreshToken/);
  });
});

describe("account deletion", () => {
  it("deletes the account and cascades personal data", async () => {
    const erin = await signIn();
    const r = await (await erin.request("/v1/recipes", { method: "POST", json: { title: "Bye", servings: 1, ingredients: [] } })).json();
    expect((await erin.request("/v1/me", { method: "DELETE" })).status).toBe(204);
    expect((await erin.request("/v1/me")).status).toBe(401);
    const { rows } = await pool.query("select count(*)::int as n from recipes where id = $1", [r.id]);
    expect(rows[0].n).toBe(0);
  });
});

describe("Google sign-in", () => {
  it("lists the enabled sign-in methods", async () => {
    const res = await call("/v1/sign-in-methods");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ methods: ["google", "email_code"] });
  });

  it("redirects to Google with our callback and minimal scopes", async () => {
    const res = await call("/v1/auth/sign-in/social", {
      method: "POST",
      json: { provider: "google", callbackURL: "http://localhost:3000/", errorCallbackURL: "http://localhost:3000/?signin=failed" },
    });
    expect(res.status).toBe(200);
    const { url, redirect } = await res.json();
    expect(redirect).toBe(true);
    const target = new URL(url);
    expect(target.origin).toBe("https://accounts.google.com");
    expect(target.searchParams.get("client_id")).toBe("test-client.apps.googleusercontent.com");
    expect(target.searchParams.get("redirect_uri")).toBe("http://localhost:4000/v1/auth/callback/google");
    expect(target.searchParams.get("scope")?.split(" ").sort()).toEqual(["email", "openid", "profile"]);
    expect(target.searchParams.get("state")).toBeTruthy();
    expect(target.searchParams.get("code_challenge")).toBeTruthy();
  });

  it("refuses a callback URL on another origin", async () => {
    const res = await call("/v1/auth/sign-in/social", { method: "POST", json: { provider: "google", callbackURL: "https://evil.example/" } });
    expect(res.status).toBe(403);
  });
});
