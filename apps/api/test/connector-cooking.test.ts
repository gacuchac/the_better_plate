import { createHash, randomBytes } from "node:crypto";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { config } from "../src/config.ts";
import { pool } from "../src/db/pool.ts";
import { call, type Client, findFood, signIn } from "./helpers.ts";

// Cooking for others and recipes from photos through the connector, the way Claude or ChatGPT
// would call them. Photos are read by the fake model (labelled fixtures in fake-vision.ts).
const MCP = "http://localhost:4000/mcp";
const REDIRECT = "https://claude.ai/api/mcp/auth_callback";
const ALL = "kitchen:read kitchen:write cooking:read cooking:write offline_access";
const house = config.house as { apiKey: string; dailyImports: number; monthlyBudgetUsd: number; allowedEmails: "*" | Set<string> };
const features = config.features as { cookProfile: boolean; recipePhotoImport: boolean };
const saved = { ...house };

let alice: Client;
let bob: Client;
let clientId: string;
let photo: string;
let chicken: string;

const b64url = (b: Buffer) => b.toString("base64url");

beforeAll(async () => {
  [alice, bob] = await Promise.all([signIn(), signIn()]);
  Object.assign(house, { apiKey: "fake-local-house", dailyImports: 50, monthlyBudgetUsd: 1000, allowedEmails: new Set([alice.email.toLowerCase(), bob.email.toLowerCase()]) });
  photo = (await sharp({ create: { width: 600, height: 1400, channels: 3, background: { r: 255, g: 255, b: 250 } } }).jpeg().toBuffer()).toString("base64");
  chicken = await findFood("Chicken, broiler or fryers, breast, skinless, boneless, meat only, raw");
  const res = await call("/v1/auth/oauth2/register", {
    method: "POST",
    headers: { origin: "" },
    json: { client_name: "Claude", redirect_uris: [REDIRECT], token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token"], response_types: ["code"] },
  });
  expect(res.status).toBe(201);
  clientId = (await res.json()).client_id;
});
afterAll(async () => {
  Object.assign(house, saved);
  features.cookProfile = true;
  features.recipePhotoImport = true;
  await pool.end();
});

async function connect(person: Client, scope = ALL) {
  const verifier = b64url(randomBytes(32));
  const challenge = b64url(createHash("sha256").update(verifier).digest());
  const params = new URLSearchParams({ response_type: "code", client_id: clientId, redirect_uri: REDIRECT, scope, state: "s", code_challenge: challenge, code_challenge_method: "S256", resource: MCP });
  const authorize = await person.request(`/v1/auth/oauth2/authorize?${params}`, { redirect: "manual", headers: { accept: "text/html" } });
  const location = authorize.headers.get("location")!;
  let back: URL;
  if (location.startsWith(REDIRECT)) back = new URL(location);
  else {
    const consent = await person.request("/v1/auth/oauth2/consent", { method: "POST", json: { accept: true, oauth_query: location.split("#/connect?")[1]! } });
    expect(consent.status).toBe(200);
    back = new URL((await consent.json()).url);
  }
  const token = await call("/v1/auth/oauth2/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", origin: "" },
    body: new URLSearchParams({ grant_type: "authorization_code", code: back.searchParams.get("code")!, redirect_uri: REDIRECT, client_id: clientId, code_verifier: verifier, resource: MCP }).toString(),
  });
  expect(token.status).toBe(200);
  return ((await token.json()) as { access_token: string }).access_token;
}

let rpcId = 0;
async function rpc(token: string, method: string, params: Record<string, unknown> = {}) {
  const res = await call("/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", "mcp-protocol-version": "2025-06-18", origin: "", authorization: `Bearer ${token}` },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params }),
  });
  expect(res.status).toBe(200);
  return (await res.json()).result;
}
async function tool(token: string, name: string, args: Record<string, unknown> = {}) {
  const result = await rpc(token, "tools/call", { name, arguments: args });
  const text = result.content[0].text as string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { isError: !!result.isError, text, data: result.isError ? null : (JSON.parse(text) as any) };
}
async function ok(token: string, name: string, args: Record<string, unknown> = {}) {
  const r = await tool(token, name, args);
  if (r.isError) throw new Error(`${name} failed: ${r.text}`);
  return r.data;
}

describe("connector: cooking for others", () => {
  it("runs a cook's whole week: profile, client, meal, receipt photo, prices, statement and a shared link", async () => {
    const token = await connect(alice);
    const init = await rpc(token, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } });
    expect(init.instructions).toContain("Cooking for others");
    const tools = (await rpc(token, "tools/list")).tools as { name: string; annotations: { destructiveHint?: boolean; readOnlyHint?: boolean; openWorldHint?: boolean } }[];
    const names = tools.map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(["read_recipe_photo", "set_cook_profile", "start_cooked_meal", "read_receipt_photo", "get_receipt_photo", "create_statement", "share_cooked", "list_my_cooks"]));
    expect(names).not.toContain("download_statement_csv");
    expect(tools.find((t) => t.name === "delete_cooked_meal")!.annotations.destructiveHint).toBe(true);
    expect(tools.find((t) => t.name === "invite_cook_client")!.annotations.openWorldHint).toBe(true);
    expect(tools.find((t) => t.name === "list_receipts")!.annotations.readOnlyHint).toBe(true);

    // The profile: a later change keeps what it doesn't mention.
    await ok(token, "set_cook_profile", { businessName: "Test fixture kitchen", hourlyRateCents: 3000, flatFeeCents: 1000 });
    const profile = await ok(token, "set_cook_profile", { businessName: "Test fixture kitchen 2" });
    expect(profile.profile).toMatchObject({ businessName: "Test fixture kitchen 2", hourlyRateCents: 3000, flatFeeCents: 1000, currency: "USD" });

    const added = await ok(token, "save_cook_client", { name: "Test client Rosa", notes: "No peanuts." });
    const changed = await ok(token, "save_cook_client", { clientId: added.id, hourlyRateCents: 4000 });
    expect(changed).toMatchObject({ name: "Test client Rosa", notes: "No peanuts.", hourlyRateCents: 4000 });
    const targets = await ok(token, "list_cook_targets");
    expect(targets.targets.map((t: { name: string }) => t.name)).toContain("Test client Rosa");

    const recipe = await ok(token, "save_recipe", { title: "Connector cook chicken", servings: 2, ingredients: [{ foodId: chicken, grams: 400, cooking: { state: "cooked", method: "grilled" } }], method: "Grill to 74 °C (165 °F)." });
    const meal = await ok(token, "start_cooked_meal", { name: "Rosa's dinner", cookedOn: "2026-11-20", target: { kind: "client", clientId: added.id }, recipeId: recipe.recipeId, servings: 2 });
    expect(meal.recipes).toHaveLength(1);
    await ok(token, "update_cooked_meal", { mealId: meal.id, cookingMinutes: 45, shoppingMinutes: 15 });
    await ok(token, "add_meal_cost", { mealId: meal.id, label: "Parking", amountCents: 500 });

    // A receipt photo, as base64: every line goes to the meal but the paper towels.
    const draft = await ok(token, "read_receipt_photo", { imageBase64: photo });
    expect(draft).toMatchObject({ store: "Test fixture: Corner Market", status: "draft", hasImage: true });
    const lines = draft.lines.map((l: { id: string; text: string; priceCents: number; foodId: string | null; grams: number | null }, i: number) =>
      i === draft.lines.length - 1 ? { ...l, mealId: null, personal: true } : { ...l, foodId: i === 0 ? chicken : l.foodId, mealId: meal.id, personal: false },
    );
    const assigned = await ok(token, "update_receipt", { receiptId: draft.id, lines });
    expect(assigned.store).toBe("Test fixture: Corner Market");
    expect(assigned.differenceCents).toBe(0);
    expect((await ok(token, "confirm_receipt", { receiptId: draft.id })).status).toBe("confirmed");
    const prices = await ok(token, "list_ingredient_prices");
    expect(prices.prices.map((p: { foodId: string }) => p.foodId)).toContain(chicken);

    // The saved photo comes back as an image, not text.
    const photoResult = await rpc(token, "tools/call", { name: "get_receipt_photo", arguments: { receiptId: draft.id } });
    expect(photoResult.isError).toBeFalsy();
    expect(photoResult.content[0]).toMatchObject({ type: "image", mimeType: expect.stringMatching(/^image\//) });
    expect(Buffer.from(photoResult.content[0].data, "base64").length).toBeGreaterThan(100);

    const full = await ok(token, "get_cooked_meal", { mealId: meal.id });
    expect(full.totals.totalCents).toBeGreaterThan(full.totals.groceriesCents);
    expect((await ok(token, "list_cooked_meals", { unbilled: true })).meals.map((m: { id: string }) => m.id)).toContain(meal.id);

    const statement = await ok(token, "create_statement", { title: "Test statement", mealIds: [meal.id] });
    expect(statement.status).toBe("draft");
    expect((await ok(token, "set_statement_status", { statementId: statement.id, status: "sent" })).status).toBe("sent");
    const shared = await ok(token, "share_cooked", { kind: "statement", id: statement.id, parts: { groceries: true, time: false, totals: true }, link: true });
    expect(shared.linkUrl).toMatch(/^http/);
    expect((await ok(token, "get_cook_sharing", { kind: "statement", id: statement.id })).parts).toMatchObject({ groceries: true, time: false });
    expect(await ok(token, "stop_cook_sharing", { kind: "statement", id: statement.id })).toMatchObject({ shared: false });
    const locked = await tool(token, "delete_cooked_meal", { mealId: meal.id });
    expect(locked.isError).toBe(true);
  });

  it("reads a recipe from a photo into a draft that saves nothing until save_recipe", async () => {
    const token = await connect(alice);
    const before = (await ok(token, "list_recipes")).recipes.length;
    const draft = await ok(token, "read_recipe_photo", { imageBase64: photo, rightsConfirmed: true });
    expect(draft).toMatchObject({ title: "Test fixture: lemon chicken with rice", saved: false });
    expect(draft.lines.find((l: { original: string }) => l.original.startsWith("500 g chicken")).foodId).toMatch(/^fdc:/);
    expect(draft.lines.find((l: { original: string }) => l.original.includes("moon dust")).foodId).toBeNull();
    expect((await ok(token, "list_recipes")).recipes.length).toBe(before);
    const twoSources = await tool(token, "read_recipe_photo", { imageBase64: photo, imageUrl: "https://example.com/a.jpg", rightsConfirmed: true });
    expect(twoSources.text).toContain("exactly one");
  });

  it("needs the cooking permissions: a kitchen-only connection can't read clients, and read can't write", async () => {
    const kitchenOnly = await connect(bob, "kitchen:read kitchen:write");
    const refused = await tool(kitchenOnly, "list_cook_clients");
    expect(refused.isError).toBe(true);
    expect(refused.text).toContain("cooking:read");
    const readOnly = await connect(bob, "cooking:read");
    expect((await tool(readOnly, "get_cook_profile")).isError).toBe(false);
    const write = await tool(readOnly, "save_cook_client", { name: "Nope" });
    expect(write.text).toContain("cooking:write");
    expect((await tool(readOnly, "read_recipe_photo", { imageBase64: photo, rightsConfirmed: true })).text).toContain("kitchen:write");
  });

  it("keeps cooks apart: one person's token can't reach another's receipts or meals", async () => {
    const aliceToken = await connect(alice);
    const receipts = (await ok(aliceToken, "list_receipts")).receipts as { id: string }[];
    expect(receipts.length).toBeGreaterThan(0);
    const bobToken = await connect(bob);
    await ok(bobToken, "set_cook_profile", { businessName: "Test fixture other kitchen" });
    const theirs = await tool(bobToken, "get_receipt", { receiptId: receipts[0]!.id });
    expect(theirs.isError).toBe(true);
    expect((await rpc(bobToken, "tools/call", { name: "get_receipt_photo", arguments: { receiptId: receipts[0]!.id } })).isError).toBe(true);
    const meals = (await ok(aliceToken, "list_cooked_meals")).meals as { id: string }[];
    expect((await tool(bobToken, "update_cooked_meal", { mealId: meals[0]!.id, notes: "x" })).isError).toBe(true);
  });

  it("lists no cooking tools while the cook profile is off, and no photo reader while photo import is off", async () => {
    const token = await connect(alice);
    features.cookProfile = false;
    features.recipePhotoImport = false;
    try {
      const names = ((await rpc(token, "tools/list")).tools as { name: string }[]).map((t) => t.name);
      expect(names).toContain("save_recipe");
      expect(names).not.toContain("start_cooked_meal");
      expect(names).not.toContain("read_recipe_photo");
    } finally {
      features.cookProfile = true;
      features.recipePhotoImport = true;
    }
  });
});
