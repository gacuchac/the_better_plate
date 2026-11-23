import { createHash, randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LINK_AREAS, PRIVACY_NOTICE, type LinkAccess, type LinkArea } from "@betterplate/contracts";
import { config } from "../src/config.ts";
import { pool } from "../src/db/pool.ts";
import { call, type Client, findFood, signIn } from "./helpers.ts";

// An assistant connected to Ben's account acting in Ann's, once she linked it to him (ADR-015):
// every tool takes account, only what Ann shared works, and changes go into her activity log.
const MCP = "http://localhost:4000/mcp";
const REDIRECT = "https://claude.ai/api/mcp/auth_callback";
const KITCHEN = "kitchen:read kitchen:write cooking:read cooking:write offline_access";
const ALL = `${KITCHEN} accounts:linked`;

let clientId: string;
let rice: string;

const perms = (areas: Partial<Record<LinkArea, LinkAccess>>, aiApps: boolean) => ({ areas: Object.fromEntries(LINK_AREAS.map((a) => [a, areas[a] ?? "off"])), aiApps });
async function agree(c: Client) {
  expect((await c.request("/v1/me/consent", { method: "POST", json: { noticeVersion: PRIVACY_NOTICE.version, adultConfirmed: true } })).status).toBe(201);
}
const meId = async (c: Client): Promise<string> => (await (await c.request("/v1/me")).json()).id;

beforeAll(async () => {
  rice = await findFood("Rice, white, long-grain, regular, enriched, cooked");
  const res = await call("/v1/auth/oauth2/register", {
    method: "POST",
    headers: { origin: "" },
    json: { client_name: "Claude", redirect_uris: [REDIRECT], token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token"], response_types: ["code"] },
  });
  expect(res.status).toBe(201);
  clientId = (await res.json()).client_id;
});
afterAll(() => pool.end());

const b64url = (b: Buffer) => b.toString("base64url");

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

describe("connector: linked accounts", () => {
  it("acts in a linked account only where its owner shared it and allowed AI apps, and logs each change", async () => {
    const [ann, ben] = await Promise.all([signIn(), signIn()]);
    await Promise.all([agree(ann), agree(ben)]);
    const annId = await meId(ann);
    const sent = await ann.request("/v1/linked-accounts", { method: "POST", json: { email: ben.email, permissions: perms({ recipes: "change", plans: "view" }, false) } });
    const { id: linkId } = await sent.json();
    expect((await ben.request(`/v1/linked-accounts/${linkId}/accept`, { method: "POST" })).status).toBe(200);
    const ingredients = [{ foodId: rice, grams: 150, cooking: { state: "raw" } }];

    // A connection approved without linked accounts: every tool offers account, none may use it.
    const plain = await connect(ben, KITCHEN);
    const init = await rpc(plain, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } });
    expect(init.instructions).toContain("list_accounts");
    const tools = (await rpc(plain, "tools/list")).tools as { name: string; inputSchema: { properties: Record<string, unknown> } }[];
    for (const t of tools.filter((x) => x.name !== "list_accounts")) expect(Object.keys(t.inputSchema.properties), t.name).toContain("account");
    expect(tools.map((t) => t.name)).toEqual(expect.arrayContaining(["list_accounts", "save_recipe", "get_cook_profile", "upload_recipe_photo"]));
    expect((await tool(plain, "list_accounts")).text).toContain("accounts:linked");
    expect((await tool(plain, "list_recipes", { account: annId })).text).toContain("accounts:linked");

    // Allowed, but Ann hasn't let AI apps in yet.
    const token = await connect(ben, ALL);
    const accounts = await ok(token, "list_accounts");
    expect(accounts.yours.accountId).toBe(await meId(ben));
    expect(accounts.linked).toEqual([expect.objectContaining({ accountId: annId, email: ann.email, aiAppsAllowed: false, shared: { recipes: "change", plans: "view" } })]);
    expect((await tool(token, "list_recipes", { account: annId })).text).toContain("hasn't allowed AI apps");

    expect((await ann.request(`/v1/linked-accounts/${linkId}`, { method: "PATCH", json: { permissions: perms({ recipes: "change", plans: "view" }, true) } })).status).toBe(200);
    const saved = await ok(token, "save_recipe", { account: annId, title: "Ann's rice", servings: 2, ingredients });
    expect((await pool.query("select user_id from recipes where id = $1", [saved.recipeId])).rows[0].user_id).toBe(annId);
    expect((await ok(token, "list_recipes", { account: annId })).recipes.map((r: { id: string }) => r.id)).toContain(saved.recipeId);
    // Without account, Ben's own kitchen.
    expect((await ok(token, "list_recipes")).recipes).toEqual([]);
    expect((await ok(token, "search_foods", { account: annId, query: "rice" })).foods.length).toBeGreaterThan(0);

    // Plans are view only, what she ate and her goals aren't shared, cooking for others is hers alone.
    const today = new Date().toISOString().slice(0, 10);
    expect((await tool(token, "plan_meal", { account: annId, recipeId: saved.recipeId, date: today, slot: "dinner", servings: 1 })).text).toContain("view only");
    expect((await tool(token, "log_meal", { account: annId, recipeId: saved.recipeId, date: today, slot: "dinner", servings: 1 })).text).toContain("isn't shared");
    expect((await tool(token, "list_goals", { account: annId })).text).toContain("isn't shared");
    expect(await ok(token, "get_day", { account: annId, date: today })).toMatchObject({ planned: [], eaten: [], notShared: "eaten" });
    expect((await tool(token, "get_cook_profile", { account: annId })).text).toMatch(/^Only .* can do this/);
    expect((await tool(token, "list_recipes", { account: crypto.randomUUID() })).text).toContain("don't have access");

    // Ann sees who did it, through which app.
    const log = (await (await ann.request("/v1/linked-accounts/activity")).json()).entries;
    expect(log.find((e: { action: string }) => e.action === "recipe.save")).toMatchObject({ via: "connector", appName: "Claude", targetId: saved.recipeId, actor: { name: ben.email } });
    expect(log.filter((e: { via: string }) => e.via === "connector")).toHaveLength(1);

    // Turning AI apps off, or ending the link, takes effect on the next call.
    expect((await ann.request(`/v1/linked-accounts/${linkId}`, { method: "PATCH", json: { permissions: perms({ recipes: "change" }, false) } })).status).toBe(200);
    expect((await tool(token, "get_recipe", { account: annId, recipeId: saved.recipeId })).text).toContain("hasn't allowed AI apps");
    expect((await ann.request(`/v1/linked-accounts/${linkId}`, { method: "DELETE" })).status).toBe(204);
    expect((await tool(token, "get_recipe", { account: annId, recipeId: saved.recipeId })).text).toContain("don't have access");
    expect((await ok(token, "list_accounts")).linked).toEqual([]);
  });

  it("offers neither account nor list_accounts while the feature is off", async () => {
    const features = config.features as { linkedAccounts: boolean };
    const ben = await signIn();
    const token = await connect(ben, KITCHEN);
    features.linkedAccounts = false;
    try {
      const tools = (await rpc(token, "tools/list")).tools as { name: string; inputSchema: { properties?: Record<string, unknown> } }[];
      expect(tools.map((t) => t.name)).not.toContain("list_accounts");
      expect(tools.filter((t) => "account" in (t.inputSchema.properties ?? {}))).toEqual([]);
    } finally {
      features.linkedAccounts = true;
    }
  });
});
