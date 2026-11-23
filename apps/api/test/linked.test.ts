import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LINK_AREAS, PRIVACY_NOTICE, type LinkAccess, type LinkArea } from "@betterplate/contracts";
import { pool } from "../src/db/pool.ts";
import { devOutbox } from "../src/lib/mailer.ts";
import { ROUTE_POLICIES } from "../src/modules/linked/policy.ts";
import { runMaintenance } from "../src/jobs.ts";
import { app, call, type Client, findFood, signIn } from "./helpers.ts";

const uuid = () => crypto.randomUUID();
let rice: string;
const ingredient = (foodId: string, quantity: number) => ({ id: uuid(), foodId, quantity, unit: "g", role: "ingredient" });

const perms = (areas: Partial<Record<LinkArea, LinkAccess>> = {}, aiApps = false) => ({
  areas: Object.fromEntries(LINK_AREAS.map((a) => [a, areas[a] ?? "off"])),
  aiApps,
});

async function agree(c: Client) {
  const res = await c.request("/v1/me/consent", { method: "POST", json: { noticeVersion: PRIVACY_NOTICE.version, adultConfirmed: true } });
  expect(res.status).toBe(201);
}

async function meId(c: Client): Promise<string> {
  return (await (await c.request("/v1/me")).json()).id;
}

/** Owner shares with delegate, delegate accepts; returns the link id and a client acting in the owner's account. */
async function link(owner: Client, delegate: Client, areas: Partial<Record<LinkArea, LinkAccess>>) {
  const sent = await owner.request("/v1/linked-accounts", { method: "POST", json: { email: delegate.email, permissions: perms(areas) } });
  expect(sent.status).toBe(201);
  const { id } = await sent.json();
  const accepted = await delegate.request(`/v1/linked-accounts/${id}/accept`, { method: "POST" });
  expect(accepted.status).toBe(200);
  const ownerId = await meId(owner);
  const as: Client = {
    email: delegate.email,
    cookie: delegate.cookie,
    request: (path, init = {}) => delegate.request(path, { ...init, headers: { ...(init.headers as Record<string, string>), "x-act-as": ownerId } }),
  };
  return { id: id as string, ownerId, as };
}

const sync = (c: Client, operations: unknown[]) => c.request("/v1/sync/batch", { method: "POST", json: { protocol: 1, operations } });
const recipeBody = (title: string) => ({ title, servings: 2, ingredients: [ingredient(rice, 150)], method: "" });

beforeAll(async () => {
  rice = await findFood("Rice, white, long-grain, regular, enriched, cooked");
});
afterAll(() => pool.end());

describe("linked accounts: route policy", () => {
  it("gives every route in the API a decision, and names no route that doesn't exist", () => {
    const doc = app.getOpenAPI31Document({ openapi: "3.1.0", info: { title: "t", version: "0" } });
    const routes = Object.entries(doc.paths ?? {}).flatMap(([path, item]) =>
      Object.keys(item as object).filter((m) => ["get", "post", "put", "patch", "delete"].includes(m)).map((m) => `${m.toUpperCase()} ${path}`),
    );
    expect(routes.length).toBeGreaterThan(100);
    expect(routes.filter((r) => !ROUTE_POLICIES[r])).toEqual([]);
    expect(Object.keys(ROUTE_POLICIES).filter((k) => !routes.includes(k))).toEqual([]);
  });
});

describe("linked accounts: requests", () => {
  it("sends a request, accepts it and lets the other person act only through what is shared", async () => {
    const [ann, ben] = await Promise.all([signIn(), signIn()]);
    await Promise.all([agree(ann), agree(ben)]);
    const before = devOutbox(ben.email).length;
    const sent = await ann.request("/v1/linked-accounts", { method: "POST", json: { email: ben.email.toUpperCase(), permissions: perms({ recipes: "change", plans: "view" }) } });
    expect(sent.status).toBe(201);
    const link = await sent.json();
    // Until Ben accepts, Ann sees only the email she typed.
    expect(link).toMatchObject({ direction: "given", status: "requested", person: { id: null, name: null, email: ben.email } });
    expect(devOutbox(ben.email).length).toBe(before + 1);

    const benView = await (await ben.request("/v1/linked-accounts")).json();
    expect(benView.received).toHaveLength(1);
    expect(benView.received[0]).toMatchObject({ id: link.id, status: "requested", permissions: { areas: { recipes: "change", plans: "view", goals: "off" } } });

    // Not active yet: no acting.
    const annId = await meId(ann);
    expect((await ben.request("/v1/recipes", { headers: { "x-act-as": annId } })).status).toBe(403);

    expect((await ben.request(`/v1/linked-accounts/${link.id}/accept`, { method: "POST" })).status).toBe(200);
    const given = (await (await ann.request("/v1/linked-accounts")).json()).given;
    expect(given[0]).toMatchObject({ status: "active", person: { email: ben.email } });
    expect(given[0].person.id).toBeTruthy();

    const as = (path: string, init: RequestInit & { json?: unknown } = {}) => ben.request(path, { ...init, headers: { "x-act-as": annId } });
    const me = await (await as("/v1/me")).json();
    expect(me).toMatchObject({ id: annId, email: ann.email, acting: { linkId: link.id, actor: { email: ben.email } } });

    // recipes: change
    const created = await as("/v1/recipes", { method: "POST", json: { id: uuid(), ...recipeBody("Ben made this for Ann") } });
    expect(created.status).toBe(201);
    const recipe = await created.json();
    const annRecipes = (await (await ann.request("/v1/recipes")).json()).recipes;
    expect(annRecipes.map((r: { id: string }) => r.id)).toContain(recipe.id);
    // Ben's own kitchen is untouched.
    expect((await (await ben.request("/v1/recipes")).json()).recipes).toHaveLength(0);

    // plans: view only; goals: off
    const plan = { opId: uuid(), type: "plan.put", entityId: uuid(), baseVersion: null, body: { date: "2026-11-24", slot: "dinner", recipeId: recipe.id, title: "x", servings: 1 } };
    expect((await (await sync(asClient(ben, annId), [plan])).json()).results[0]).toMatchObject({ status: "rejected", error: { code: "view_only" } });
    const goals = await as("/v1/goals");
    expect(goals.status).toBe(403);
    expect((await goals.json()).error).toMatchObject({ code: "not_shared" });
    const meals = await (await as("/v1/meals?from=2026-11-20&to=2026-11-27")).json();
    expect(meals).toMatchObject({ planned: [], eaten: [] });

    // Owner-only: account, linking (no chaining), publishing.
    expect((await as("/v1/me", { method: "DELETE" })).status).toBe(403);
    expect((await as("/v1/me/export")).status).toBe(403);
    expect((await as("/v1/linked-accounts")).status).toBe(403);
    const chain = await as("/v1/linked-accounts", { method: "POST", json: { email: "third@example.test", permissions: perms({ recipes: "change" }) } });
    expect((await chain.json()).error).toMatchObject({ code: "owner_only" });

    // The activity log: in Ann's account, and in what Ben did.
    const annLog = (await (await ann.request("/v1/linked-accounts/activity")).json()).entries;
    expect(annLog.map((e: { action: string }) => e.action)).toEqual(expect.arrayContaining(["recipe.save", "link.accepted", "link.created"]));
    expect(annLog.find((e: { action: string }) => e.action === "recipe.save")).toMatchObject({ actor: { name: ben.email }, via: "app", targetId: null });
    const benLog = (await (await ben.request("/v1/linked-accounts/activity?who=me")).json()).entries;
    expect(benLog.map((e: { action: string }) => e.action)).toContain("recipe.save");

    // Ann turns recipes off: takes effect on Ben's next request.
    const patched = await ann.request(`/v1/linked-accounts/${link.id}`, { method: "PATCH", json: { permissions: perms({ plans: "view" }) } });
    expect(patched.status).toBe(200);
    expect((await as("/v1/recipes")).status).toBe(403);
    // Only the owner changes toggles.
    expect((await ben.request(`/v1/linked-accounts/${link.id}`, { method: "PATCH", json: { permissions: perms({ recipes: "change" }) } })).status).toBe(404);

    // Ben leaves; nothing works any more.
    expect((await ben.request(`/v1/linked-accounts/${link.id}`, { method: "DELETE" })).status).toBe(204);
    const gone = await as("/v1/meals?from=2026-11-20&to=2026-11-27");
    expect(gone.status).toBe(403);
    expect((await gone.json()).error).toMatchObject({ code: "no_access" });
    expect((await (await ann.request("/v1/linked-accounts")).json()).given).toHaveLength(0);
  });

  it("answers the same for an email with no account, and refuses your own email and duplicates", async () => {
    const ann = await signIn();
    await agree(ann);
    const nobody = `nobody-${uuid()}@example.test`;
    const res = await ann.request("/v1/linked-accounts", { method: "POST", json: { email: nobody, permissions: perms({ recipes: "view" }) } });
    expect(res.status).toBe(201);
    expect(devOutbox(nobody)).toHaveLength(0);
    expect((await ann.request("/v1/linked-accounts", { method: "POST", json: { email: nobody, permissions: perms() } })).status).toBe(409);
    expect((await ann.request("/v1/linked-accounts", { method: "POST", json: { email: ann.email, permissions: perms() } })).status).toBe(400);
  });

  it("needs the current privacy notice to send or accept", async () => {
    const [ann, ben] = await Promise.all([signIn(), signIn()]);
    const res = await ann.request("/v1/linked-accounts", { method: "POST", json: { email: ben.email, permissions: perms() } });
    expect(res.status).toBe(409);
    await agree(ann);
    const { id } = await (await ann.request("/v1/linked-accounts", { method: "POST", json: { email: ben.email, permissions: perms() } })).json();
    expect((await ben.request(`/v1/linked-accounts/${id}/accept`, { method: "POST" })).status).toBe(409);
    await agree(ben);
    expect((await ben.request(`/v1/linked-accounts/${id}/accept`, { method: "POST" })).status).toBe(200);
  });

  it("lets only the person the request was sent to accept it", async () => {
    const [ann, ben, eve] = await Promise.all([signIn(), signIn(), signIn()]);
    await Promise.all([agree(ann), agree(ben), agree(eve)]);
    const { id } = await (await ann.request("/v1/linked-accounts", { method: "POST", json: { email: ben.email, permissions: perms({ recipes: "change" }) } })).json();
    expect((await eve.request(`/v1/linked-accounts/${id}/accept`, { method: "POST" })).status).toBe(404);
    expect((await ann.request(`/v1/linked-accounts/${id}/accept`, { method: "POST" })).status).toBe(404);
    // Someone with no link can't act in the account.
    expect((await eve.request("/v1/recipes", { headers: { "x-act-as": await meId(ann) } })).status).toBe(403);
    expect((await eve.request("/v1/recipes", { headers: { "x-act-as": "not-an-id" } })).status).toBe(400);
  });

  it("lapses an unanswered request", async () => {
    const [ann, ben] = await Promise.all([signIn(), signIn()]);
    await Promise.all([agree(ann), agree(ben)]);
    const { id } = await (await ann.request("/v1/linked-accounts", { method: "POST", json: { email: ben.email, permissions: perms() } })).json();
    await pool.query("update account_links set expires_at = now() - interval '1 minute' where id = $1", [id]);
    expect((await ben.request(`/v1/linked-accounts/${id}/accept`, { method: "POST" })).status).toBe(404);
    await runMaintenance();
    expect((await pool.query("select status from account_links where id = $1", [id])).rows[0].status).toBe("expired");
  });
});

function asClient(delegate: Client, ownerId: string): Client {
  return { ...delegate, request: (path, init = {}) => delegate.request(path, { ...init, headers: { ...(init.headers as Record<string, string>), "x-act-as": ownerId } }) };
}

describe("linked accounts: sync", () => {
  it("pulls only shared areas and applies only shared changes, logging each", async () => {
    const [ann, ben] = await Promise.all([signIn(), signIn()]);
    await Promise.all([agree(ann), agree(ben)]);
    const recipeId = uuid();
    const goalId = uuid();
    const r = await (await sync(ann, [
      { opId: uuid(), type: "recipe.put", entityId: recipeId, baseVersion: null, body: recipeBody("Ann's soup") },
      { opId: uuid(), type: "goal.put", entityId: goalId, baseVersion: null, body: { nutrientKey: "protein", unit: "g", kind: "at_least", min: 100, max: null, period: "day", startDate: "2026-11-01", endDate: null } },
    ])).json();
    expect(r.results.map((x: { status: string }) => x.status)).toEqual(["applied", "applied"]);

    const { as } = await link(ann, ben, { recipes: "view", eaten: "change" });
    const pulled = await (await as.request("/v1/sync/changes")).json();
    const ids = pulled.changes.map((ch: { entityId: string }) => ch.entityId);
    expect(ids).toContain(recipeId);
    expect(ids).not.toContain(goalId);

    const logId = uuid();
    const res = await (await sync(as, [
      { opId: uuid(), type: "recipe.put", entityId: recipeId, baseVersion: 1, body: recipeBody("Renamed by Ben") },
      { opId: uuid(), type: "goal.delete", entityId: goalId, baseVersion: 1 },
      { opId: uuid(), type: "log.create", entityId: logId, body: { plannedMealId: null, recipeId, recipe: { title: "Ann's soup", servings: 2, ingredients: [ingredient(rice, 150)] }, servings: 1, slot: "lunch", localDate: "2026-11-23", eatenAt: "2026-11-23T12:00:00-03:00" } },
    ])).json();
    expect(res.results.map((x: { status: string; error?: { code: string } }) => x.error?.code ?? x.status)).toEqual(["view_only", "not_shared", "applied"]);
    // Written in Ann's account, logged with Ben's name and the record.
    expect((await pool.query("select user_id from consumption_events where id = $1", [logId])).rows[0].user_id).toBe(await meId(ann));
    const log = (await (await ann.request("/v1/linked-accounts/activity")).json()).entries;
    expect(log.find((e: { action: string }) => e.action === "meal.log")).toMatchObject({ targetId: logId, actor: { name: ben.email } });
    expect(log.filter((e: { action: string }) => e.action === "goal.delete")).toHaveLength(0);
  });
});
