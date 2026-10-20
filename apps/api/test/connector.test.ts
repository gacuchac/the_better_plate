import { createHash, randomBytes } from "node:crypto";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { config } from "../src/config.ts";
import { pool } from "../src/db/pool.ts";
import { photoDownloads } from "../src/modules/connector.ts";
import { PublicFetchError } from "../src/lib/public-fetch.ts";
import { call, type Client, signIn } from "./helpers.ts";

// The whole connector path as Claude or ChatGPT would run it: discovery, dynamic client
// registration, authorization with PKCE and consent, token exchange, then MCP tool calls.
const MCP = "http://localhost:4000/mcp";
const REDIRECT = "https://claude.ai/api/mcp/auth_callback";
const today = new Date().toISOString().slice(0, 10);

let alice: Client;
let bob: Client;
let clientId: string;

beforeAll(async () => {
  [alice, bob] = await Promise.all([signIn(), signIn()]);
});
afterAll(() => pool.end());

const b64url = (b: Buffer) => b.toString("base64url");

async function register(name = "Claude") {
  const res = await call("/v1/auth/oauth2/register", {
    method: "POST",
    headers: { origin: "" },
    json: { client_name: name, redirect_uris: [REDIRECT], token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token"], response_types: ["code"] },
  });
  expect(res.status).toBe(201);
  return (await res.json()).client_id as string;
}

/** Runs authorize → consent → token for a signed-in person; returns the tokens. */
async function connect(person: Client, scope = "kitchen:read kitchen:write offline_access", id = clientId) {
  const verifier = b64url(randomBytes(32));
  const challenge = b64url(createHash("sha256").update(verifier).digest());
  const state = b64url(randomBytes(8));
  const params = new URLSearchParams({ response_type: "code", client_id: id, redirect_uri: REDIRECT, scope, state, code_challenge: challenge, code_challenge_method: "S256", resource: MCP });
  const authorize = await person.request(`/v1/auth/oauth2/authorize?${params}`, { redirect: "manual", headers: { accept: "text/html" } });
  expect(authorize.status).toBe(302);
  const location = authorize.headers.get("location")!;
  let back: URL;
  if (location.startsWith(REDIRECT)) {
    // Already approved for these permissions: straight back to the client.
    back = new URL(location);
  } else {
    // The consent screen is the web app's #/connect route; the signed query rides inside the hash.
    expect(location).toMatch(new RegExp(`^${config.publicAppUrl}/#/connect\\?`));
    const oauthQuery = location.split("#/connect?")[1]!;
    expect(new URLSearchParams(oauthQuery).get("client_id")).toBe(id);
    const consent = await person.request("/v1/auth/oauth2/consent", { method: "POST", json: { accept: true, oauth_query: oauthQuery } });
    expect(consent.status).toBe(200);
    back = new URL((await consent.json()).url);
  }
  expect(`${back.origin}${back.pathname}`).toBe(REDIRECT);
  expect(back.searchParams.get("state")).toBe(state);

  const token = await call("/v1/auth/oauth2/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", origin: "" },
    body: new URLSearchParams({ grant_type: "authorization_code", code: back.searchParams.get("code")!, redirect_uri: REDIRECT, client_id: id, code_verifier: verifier, resource: MCP }).toString(),
  });
  expect(token.status).toBe(200);
  return (await token.json()) as { access_token: string; refresh_token?: string; scope: string; expires_in: number };
}

let rpcId = 0;
async function mcp(token: string | null, method: string, params: Record<string, unknown> = {}) {
  const headers: Record<string, string> = { "content-type": "application/json", accept: "application/json, text/event-stream", "mcp-protocol-version": "2025-06-18", origin: "" };
  if (token) headers.authorization = `Bearer ${token}`;
  return call("/mcp", { method: "POST", headers, body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params }) });
}

async function tool(token: string, name: string, args: Record<string, unknown> = {}) {
  const res = await mcp(token, "tools/call", { name, arguments: args });
  expect(res.status).toBe(200);
  const { result } = await res.json();
  const text = result.content[0].text as string;
  return { isError: !!result.isError, text, data: result.isError ? null : JSON.parse(text) };
}

describe("Claude/ChatGPT connector (MCP with OAuth)", () => {
  it("publishes where to sign in, and asks for it on the MCP endpoint", async () => {
    const prm = await (await call("/.well-known/oauth-protected-resource/mcp")).json();
    expect(prm).toMatchObject({ resource: MCP, authorization_servers: ["http://localhost:4000/v1/auth"], scopes_supported: expect.arrayContaining(["kitchen:read", "kitchen:write"]) });
    const as = await (await call("/.well-known/oauth-authorization-server/v1/auth")).json();
    expect(as).toMatchObject({ issuer: "http://localhost:4000/v1/auth", code_challenge_methods_supported: expect.arrayContaining(["S256"]) });
    expect(as.registration_endpoint).toBe("http://localhost:4000/v1/auth/oauth2/register");

    const res = await mcp(null, "initialize");
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toContain('resource_metadata="http://localhost:4000/.well-known/oauth-protected-resource/mcp"');
    expect((await mcp("not-a-token", "tools/list")).status).toBe(401);
  });

  it("registers a client, then signs in with PKCE and consent", async () => {
    clientId = await register();
    const tokens = await connect(alice);
    expect(tokens.scope.split(" ")).toEqual(expect.arrayContaining(["kitchen:read", "kitchen:write"]));
    expect(tokens.access_token.split(".")).toHaveLength(3);
    expect(tokens.expires_in).toBeLessThanOrEqual(900);
    expect(tokens.refresh_token).toBeTruthy();

    // The person's data export lists the connection, never the tokens.
    const exported = await (await alice.request("/v1/me/export")).json();
    expect(exported.connectedApps).toEqual([expect.objectContaining({ name: "Claude", redirectUris: [REDIRECT], scopes: expect.arrayContaining(["kitchen:write"]) })]);
    expect(JSON.stringify(exported)).not.toContain(tokens.access_token.slice(-20));
  });

  it("lists the kitchen tools and builds, plans and logs a recipe that the app then syncs", async () => {
    const { access_token: token } = await connect(alice);
    const init = await mcp(token, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } });
    expect(init.status).toBe(200);
    expect((await init.json()).result.instructions).toContain("Never invent food ids");
    const tools = (await (await mcp(token, "tools/list")).json()).result.tools as { name: string; annotations: { destructiveHint?: boolean } }[];
    expect(tools.map((t) => t.name)).toEqual(expect.arrayContaining(["search_foods", "save_recipe", "log_meal", "get_day", "delete_recipe"]));
    expect(tools.find((t) => t.name === "delete_recipe")!.annotations.destructiveHint).toBe(true);

    const found = await tool(token, "search_foods", { query: "chicken breast raw" });
    const chicken = found.data.foods[0].id as string;
    expect(chicken).toMatch(/^fdc:\d+$/);
    const saved = await tool(token, "save_recipe", { title: "Connector chicken", description: "Simple and juicy.", servings: 2, ingredients: [{ foodId: chicken, grams: 300 }], method: "Cook to 165°F." });
    expect(saved.data.estimatedPerServing.find((n: { key: string }) => n.key === "protein").amount).toBeGreaterThan(0);
    const recipeId = saved.data.recipeId as string;
    expect((await tool(token, "get_recipe", { recipeId })).data.description).toBe("Simple and juicy.");

    expect((await tool(token, "save_recipe", { title: "Bad", servings: 1, ingredients: [{ foodId: "fdc:999999999", grams: 10 }] })).isError).toBe(true);
    expect((await tool(token, "plan_meal", { recipeId, date: today, slot: "dinner", servings: 1 })).data.planned).toBe(true);
    expect((await tool(token, "log_meal", { recipeId, date: today, slot: "dinner", servings: 1 })).data.loggedAsEaten).toBe(true);
    expect((await tool(token, "log_meal", { recipeId, date: "2999-01-01", slot: "dinner", servings: 1 })).isError).toBe(true);
    const day = (await tool(token, "get_day", { date: today })).data;
    expect(day.eaten).toHaveLength(1);
    expect(day.planned).toHaveLength(1);
    expect(day.estimatedEatenTotals.find((t: { key: string }) => t.key === "protein").amount).toBeGreaterThan(0);

    // The person's own photo, as file data; links to private addresses are refused.
    const photo = (await sharp({ create: { width: 800, height: 600, channels: 3, background: "#d8c9a7" } }).jpeg().toBuffer()).toString("base64");
    expect((await tool(token, "upload_recipe_photo", { recipeId, imageBase64: photo })).isError).toBe(true);
    const uploaded = await tool(token, "upload_recipe_photo", { recipeId, imageBase64: photo, alt: "My chicken", rightsConfirmed: true });
    expect(uploaded.data.photo).toBe("uploaded");
    const withPhoto = await (await alice.request(`/v1/recipes/${recipeId}`)).json();
    expect(withPhoto.image).toMatchObject({ kind: "upload", alt: "My chicken", credit: null });
    const local = await tool(token, "upload_recipe_photo", { recipeId, imageUrl: "https://127.0.0.1/photo.jpg", rightsConfirmed: true });
    expect(local.isError).toBe(true);
    expect(local.text).toMatch(/^That link points to a private address\. Ask the person/);

    // The app sees the change through its normal sync feed.
    const changes = await (await alice.request("/v1/sync/changes?cursor=0")).json();
    expect(JSON.stringify(changes)).toContain(recipeId);
  });

  it("takes the person's photo as a chat attachment, link or base64, checks the bytes and confirms where it went", async () => {
    const token = (await connect(alice)).access_token;
    const listed = await (await mcp(token, "tools/list")).json();
    const upload = listed.result.tools.find((t: { name: string }) => t.name === "upload_recipe_photo");
    // ChatGPT reads this to hand over an attached file with an authorized download link.
    expect(upload._meta).toEqual({ "openai/fileParams": ["image"] });
    expect(Object.keys(upload.inputSchema.properties.image.properties).sort()).toEqual(["download_url", "file_id", "file_name", "mime_type"]);

    const { recipeId } = (await tool(token, "save_recipe", { title: "Generated lunch", servings: 1, ingredients: [] })).data;
    const big = await sharp({ create: { width: 2400, height: 1800, channels: 3, background: "#b9764f" } })
      .withExif({ IFD0: { Copyright: "someone", ImageDescription: "secret place" } })
      .png()
      .toBuffer();
    const files = new Map<string, { type: string; body: Buffer }>([
      ["https://files.example.test/generated.png", { type: "image/png", body: big }],
      ["https://files.example.test/page", { type: "text/html; charset=utf-8", body: Buffer.from("<html></html>") }],
      ["https://files.example.test/anim.gif", { type: "application/octet-stream", body: await sharp({ create: { width: 10, height: 10, channels: 3, background: "#000" } }).gif().toBuffer() }],
    ]);
    const original = photoDownloads.fetch;
    photoDownloads.fetch = async (url) => {
      const file = files.get(url);
      if (!file) throw new PublicFetchError("The link answered 404");
      return file;
    };
    try {
      // A chat attachment (ChatGPT file params): downloaded, resized, metadata dropped, verified on the recipe.
      const attached = await tool(token, "upload_recipe_photo", {
        recipeId,
        image: { download_url: "https://files.example.test/generated.png", file_id: "file_abc123", mime_type: "image/png", file_name: "lunch.png" },
        alt: "Lunch bowl",
        rightsConfirmed: true,
      });
      expect(attached.data).toMatchObject({
        recipeId,
        photo: "uploaded",
        verified: true,
        stored: { format: "webp", width: 1600, height: 1200, metadataRemoved: true, private: true },
      });
      expect(JSON.stringify(attached.data)).not.toContain("http");
      const recipe = await (await alice.request(`/v1/recipes/${recipeId}`)).json();
      expect(recipe.image).toMatchObject({ id: attached.data.imageId, kind: "upload", alt: "Lunch bowl" });
      expect(recipe.version).toBe(attached.data.recipeVersion);
      const { rows } = await pool.query("select bytes, upload_source from recipe_images where id = $1", [attached.data.imageId]);
      expect(rows[0].upload_source).toBe("assistant");
      const meta = await sharp(rows[0].bytes).metadata();
      expect([meta.format, meta.exif]).toEqual(["webp", undefined]);
      // Someone else can't load it.
      expect((await bob.request(`/v1/images/${attached.data.imageId}`)).status).toBe(404);

      // AVIF as base64 (and as a data URL) works.
      const avif = (await sharp({ create: { width: 300, height: 200, channels: 3, background: "#7a9" } }).avif().toBuffer()).toString("base64");
      expect((await tool(token, "upload_recipe_photo", { recipeId, imageBase64: `data:image/avif;base64,${avif}`, rightsConfirmed: true })).data.stored).toMatchObject({ width: 300, height: 200 });

      // Actionable refusals.
      const sandbox = await tool(token, "upload_recipe_photo", { recipeId, imageUrl: "/mnt/data/generated.png", rightsConfirmed: true });
      expect(sandbox).toMatchObject({ isError: true });
      expect(sandbox.text).toContain("is a file inside the chat app");
      expect(sandbox.text).toContain("attach the image file to the chat");
      const sandboxB64 = await tool(token, "upload_recipe_photo", { recipeId, imageBase64: "sandbox:/mnt/data/x.png", rightsConfirmed: true });
      expect(sandboxB64.text).toContain("is a file inside the chat app");
      const mobileRef = await tool(token, "upload_recipe_photo", { recipeId, image: { download_url: "chat_upload://image_0", file_id: "chat_upload" }, rightsConfirmed: true });
      expect(mobileRef.text).toContain("is a file inside the chat app");
      expect((await tool(token, "upload_recipe_photo", { recipeId, imageUrl: "https://files.example.test/page", rightsConfirmed: true })).text).toContain("opens a web page");
      expect((await tool(token, "upload_recipe_photo", { recipeId, imageUrl: "https://files.example.test/anim.gif", rightsConfirmed: true })).text).toContain("send a JPEG, PNG, WebP or AVIF image");
      expect((await tool(token, "upload_recipe_photo", { recipeId, imageUrl: "https://files.example.test/doc.pdf", rightsConfirmed: true })).text).toContain("The link answered 404. Ask the person");
      const declared = await tool(token, "upload_recipe_photo", { recipeId, image: { download_url: "https://files.example.test/generated.png", file_id: "f", mime_type: "application/pdf" }, rightsConfirmed: true });
      expect(declared.text).toBe("That file is application/pdf; send a JPEG, PNG, WebP or AVIF image.");
      expect((await tool(token, "upload_recipe_photo", { recipeId, imageBase64: "not base64 at all!", rightsConfirmed: true })).text).toContain("isn't valid base64");
      const cut = big.toString("base64").slice(0, 4000);
      expect((await tool(token, "upload_recipe_photo", { recipeId, imageBase64: cut, rightsConfirmed: true })).text).toContain("often cut off");
      expect((await tool(token, "upload_recipe_photo", { recipeId, rightsConfirmed: true })).text).toContain("Send exactly one of");
      const both = await tool(token, "upload_recipe_photo", { recipeId, imageUrl: "https://files.example.test/generated.png", imageBase64: avif, rightsConfirmed: true });
      expect(both.text).toContain("Send exactly one of");
    } finally {
      photoDownloads.fetch = original;
    }
  });

  it("reads totals and goals, and sets or deletes goals with the person's own numbers", async () => {
    const { access_token: token } = await connect(alice);
    const summary = (await tool(token, "get_summary", { from: today, to: today })).data;
    expect(summary).toMatchObject({ days: 1, daysLogged: 1 });
    expect(summary.nutrients.find((n: { key: string }) => n.key === "protein").total).toBeGreaterThan(0);
    expect((await tool(token, "get_summary", { from: today, to: "1990-01-01" })).isError).toBe(true);

    const set = (await tool(token, "set_goal", { nutrientKey: "protein", kind: "at_least", min: 120, period: "week", startDate: today })).data;
    expect(set).toMatchObject({ saved: true, unit: "g", kind: "at_least", min: 120, max: null, period: "week", endDate: null });
    expect((await tool(token, "set_goal", { nutrientKey: "body_weight", kind: "at_most", max: 80, period: "day" })).isError).toBe(true);
    expect((await tool(token, "set_goal", { nutrientKey: "sodium", kind: "between", min: 3000, max: 2000, period: "day" })).isError).toBe(true);
    const updated = (await tool(token, "set_goal", { goalId: set.goalId, nutrientKey: "protein", kind: "between", min: 100, max: 160, period: "week" })).data;
    expect(updated).toMatchObject({ goalId: set.goalId, startDate: today, min: 100, max: 160 });

    const listed = (await tool(token, "list_goals", { today })).data.goals;
    expect(listed).toEqual([expect.objectContaining({ goalId: set.goalId, kind: "between", state: "active" })]);
    const inApp = await (await alice.request("/v1/goals")).json();
    expect(inApp.goals).toEqual([expect.objectContaining({ id: set.goalId, min: 100, max: 160, version: 2 })]);

    const tools = (await (await mcp(token, "tools/list")).json()).result.tools as { name: string; annotations: { destructiveHint?: boolean } }[];
    expect(tools.find((t) => t.name === "delete_goal")!.annotations.destructiveHint).toBe(true);
    expect((await tool(token, "delete_goal", { goalId: set.goalId })).data.deleted).toBe(true);
    expect((await (await alice.request("/v1/goals")).json()).goals).toEqual([]);
  });

  it("keeps people apart: one person's token can't read or change another's recipes", async () => {
    const aliceToken = (await connect(alice)).access_token;
    const saved = await tool(aliceToken, "save_recipe", { title: "Alice only", servings: 1, ingredients: [] });
    const bobToken = (await connect(bob)).access_token;
    expect((await tool(bobToken, "get_recipe", { recipeId: saved.data.recipeId })).isError).toBe(true);
    expect((await tool(bobToken, "delete_recipe", { recipeId: saved.data.recipeId })).isError).toBe(true);
    expect((await tool(bobToken, "list_recipes")).data.recipes).toEqual([]);
  });

  it("only changes the kitchen with the write permission", async () => {
    const readOnly = (await connect(alice, "kitchen:read")).access_token;
    expect((await tool(readOnly, "list_recipes")).isError).toBe(false);
    const write = await tool(readOnly, "save_recipe", { title: "Nope", servings: 1, ingredients: [] });
    expect(write.isError).toBe(true);
    expect(write.text).toContain("kitchen:write");
  });

  it("stops working at once when the person removes the connection", async () => {
    const id = await register("Removable");
    const { access_token: token } = await connect(alice, undefined, id);
    expect((await tool(token, "list_recipes")).isError).toBe(false);
    expect((await alice.request("/v1/auth/oauth2/delete-consent", { method: "POST", json: { id: (await consentId(alice, id))! } })).status).toBe(200);
    expect((await mcp(token, "tools/list")).status).toBe(401);
  });

  it("is refused server-side when the flag is off", async () => {
    const features = config.features as { connector: boolean };
    features.connector = false;
    try {
      expect((await call("/.well-known/oauth-protected-resource/mcp")).status).toBe(404);
      expect((await mcp("x", "tools/list")).status).toBe(404);
      expect((await call("/v1/auth/oauth2/register", { method: "POST", json: {} })).status).toBe(404);
    } finally {
      features.connector = true;
    }
  });
});

async function consentId(person: Client, id: string): Promise<string | undefined> {
  const list = (await (await person.request("/v1/auth/oauth2/get-consents")).json()) as { id: string; clientId: string }[];
  return list.find((c) => c.clientId === id)?.id;
}
