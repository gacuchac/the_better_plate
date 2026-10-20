import { createHash, randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { config } from "../src/config.ts";
import { pool } from "../src/db/pool.ts";
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

    // The app sees the change through its normal sync feed.
    const changes = await (await alice.request("/v1/sync/changes?cursor=0")).json();
    expect(JSON.stringify(changes)).toContain(recipeId);
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
