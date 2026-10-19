import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getMigrations } from "better-auth/db/migration";
import { RecipeSchema, SyncBatchResponseSchema, SyncChangesResponseSchema } from "@betterplate/contracts";
import { authOptions } from "../src/auth.ts";
import { pool } from "../src/db/pool.ts";
import { generateOpenApi } from "../src/openapi-cli.ts";
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
  });

  it("searches, looks up and batch-looks-up foods", async () => {
    const search = await (await call("/v1/foods?query=broccoli")).json();
    expect(search.foods.map((f: { description: string }) => f.description)).toContain("Broccoli, raw");
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
