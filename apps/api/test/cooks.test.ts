import { afterAll, beforeAll, describe, expect, it } from "vitest";
import sharp from "sharp";
import {
  CookMealSchema,
  CookReceiptSchema,
  CookStatementSchema,
  CookTargetsSchema,
  MyCooksSchema,
  GroupCookedMealsSchema,
  type CookMeal,
  type CookReceipt,
} from "@betterplate/contracts";
import { config } from "../src/config.ts";
import { pool } from "../src/db/pool.ts";
import { devOutbox } from "../src/lib/mailer.ts";
import { spreadTax } from "../src/modules/cooks/billing.ts";
import { call, type Client, findFood, signIn } from "./helpers.ts";

/**
 * Cook profile: who a cook may cook for and what they may know of them, meals with recipes,
 * receipts, time and costs, statements that freeze what was billed, and shares that hold only the
 * parts the cook switched on. Receipts are read by the fake model (a labelled fixture).
 */
const uuid = () => crypto.randomUUID();
const house = config.house as { apiKey: string; dailyImports: number; monthlyBudgetUsd: number; allowedEmails: "*" | Set<string> };
const features = config.features as { cookProfile: boolean; cookClientInvites: boolean };
const saved = { ...house };

let cook: Client;
let chicken: string;
let rice: string;
let photo: string;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ok = async (res: Response | Promise<Response>, status = 200): Promise<any> => {
  const r = await res;
  if (r.status !== status) throw new Error(`expected ${status}, got ${r.status}: ${await r.text()}`);
  return r.json();
};
const me = async (client: Client) => (await (await client.request("/v1/me")).json()).id as string;

async function setUp(client: Client, body: Record<string, unknown> = {}) {
  return ok(client.request("/v1/cook", { method: "PUT", json: { businessName: "Test fixture kitchen", hourlyRateCents: 3000, ...body } }));
}
async function recipe(client: Client, title = "Chicken and rice") {
  const res = await ok(
    client.request("/v1/recipes", {
      method: "POST",
      json: { title, servings: 2, description: "Weeknight dinner", method: "Cook the chicken to 74 °C.", ingredients: [
        { id: uuid(), foodId: chicken, quantity: 400, unit: "g", role: "ingredient" },
        { id: uuid(), foodId: rice, quantity: 200, unit: "g", role: "ingredient" },
      ] },
    }),
    201,
  );
  return res.id as string;
}
async function client(c: Client, name: string, notes = "") {
  return (await ok(c.request("/v1/cook/clients", { method: "POST", json: { name, notes } }), 201)) as { id: string };
}
async function meal(c: Client, target: Record<string, unknown>, extra: Record<string, unknown> = {}): Promise<CookMeal> {
  return CookMealSchema.parse(await ok(c.request("/v1/cook/meals", { method: "POST", json: { id: uuid(), name: "Dinner", cookedOn: "2026-11-20", target, ...extra } }), 201));
}

beforeAll(async () => {
  cook = await signIn();
  Object.assign(house, { apiKey: "fake-local-house", dailyImports: 50, monthlyBudgetUsd: 1000, allowedEmails: new Set([cook.email.toLowerCase()]) });
  chicken = await findFood("Chicken, broiler or fryers, breast, skinless, boneless, meat only, raw");
  rice = await findFood("Rice, white, long-grain, regular, raw, enriched");
  photo = (await sharp({ create: { width: 600, height: 1400, channels: 3, background: { r: 255, g: 255, b: 250 } } }).jpeg().toBuffer()).toString("base64");
});
afterAll(async () => {
  Object.assign(house, saved);
  features.cookProfile = true;
  features.cookClientInvites = true;
  await pool.end();
});

describe("cook profile", () => {
  it("lets the app send PATCH from its own origin (meal and statement edits)", async () => {
    const res = await call("/v1/cook/meals/00000000-0000-4000-8000-000000000000", { method: "OPTIONS", headers: { "access-control-request-method": "PATCH", "access-control-request-headers": "content-type" } });
    expect(res.headers.get("access-control-allow-methods") ?? "").toContain("PATCH");
  });

  it("is behind its flag, and needs setting up before anything else", async () => {
    const someone = await signIn();
    expect((await call("/v1/cook")).status).toBe(401);
    expect((await (await someone.request("/v1/me")).json()).features.cookProfile).toBe(true);
    expect((await ok(someone.request("/v1/cook"))).profile).toBeNull();
    expect((await someone.request("/v1/cook/clients")).status).toBe(409);
    features.cookProfile = false;
    try {
      expect((await someone.request("/v1/cook")).status).toBe(404);
      expect((await (await someone.request("/v1/me")).json()).features.cookProfile).toBe(false);
    } finally {
      features.cookProfile = true;
    }
    const state = await setUp(someone);
    expect(state.profile).toMatchObject({ businessName: "Test fixture kitchen", currency: "USD", hourlyRateCents: 3000, flatFeeCents: null });
  });

  it("lists who I can cook for, with only what I may know of each", async () => {
    const owner = await signIn();
    const kai = await signIn();
    await setUp(owner);
    await setUp(kai);
    const group = await ok(owner.request("/v1/groups", { method: "POST", json: { name: "Test fixture house", myName: "Ana" } }), 201);
    const link = await ok(owner.request(`/v1/groups/${group.id}/invites`, { method: "POST", json: { role: "member" } }), 201);
    await ok(kai.request(`/v1/invites/${link.id}/accept`, { method: "POST", json: { myName: "Kai" } }));
    const kaiId = await me(kai);
    await ok(kai.request("/v1/sync/batch", { method: "POST", json: { protocol: 1, operations: [
      { opId: uuid(), type: "prefs.put", entityId: kaiId, baseVersion: null, body: { allergyAnswer: "listed", allergens: ["peanut"], likes: [], dislikes: [], notes: "No coriander" } },
    ] } }));
    await client(owner, "Test client Rosa", "Shellfish allergy");

    const mine = CookTargetsSchema.parse(await ok(owner.request("/v1/cook/targets"))).targets;
    expect(mine.map((t) => t.key.split(":")[0])).toEqual(["me", "group", "member", "client"]);
    const g = mine.find((t) => t.kind === "group")!;
    expect(g.info).toMatchObject({ allergens: ["peanut"], anonymous: false });
    expect(g.info.people.map((p) => p.name)).toEqual(["Ana", "Kai"]);
    expect(mine.find((t) => t.kind === "member")!.info.people[0]).toMatchObject({ name: "Kai", allergens: ["peanut"], notes: "No coriander" });
    expect(mine.find((t) => t.kind === "client")!.info.people[0]).toMatchObject({ allergyAnswer: "unknown", notes: "Shellfish allergy" });

    // A plain member cooking for the group sees the allergens combined, and no names.
    const theirs = CookTargetsSchema.parse(await ok(kai.request("/v1/cook/targets"))).targets;
    expect(theirs.map((t) => t.kind)).toEqual(["me", "group"]);
    expect(theirs[1]!.info).toEqual({ allergens: ["peanut"], people: [], anonymous: true });
    // ...and can't start a meal for one member of it.
    const ana = (await pool.query<{ id: string }>("select id from group_members where group_id = $1 and display_name = 'Ana'", [group.id])).rows[0]!;
    expect((await kai.request("/v1/cook/meals", { method: "POST", json: { id: uuid(), name: "x", cookedOn: "2026-11-20", target: { kind: "member", memberId: ana.id } } })).status).toBe(404);
    // Nobody can cook "for" someone else's client.
    const rosa = mine.find((t) => t.kind === "client")!;
    expect((await kai.request("/v1/cook/meals", { method: "POST", json: { id: uuid(), name: "x", cookedOn: "2026-11-20", target: { kind: "client", clientId: rosa.clientId } } })).status).toBe(404);
  });
});

describe("cooked meals", () => {
  it("keeps the recipe as cooked, counts time, prices the pantry from my list and adds it all up", async () => {
    await setUp(cook);
    const rosa = await client(cook, "Test client Rosa");
    const recipeId = await recipe(cook);
    const m = await meal(cook, { kind: "client", clientId: rosa.id }, { recipeId, servings: 4 });
    expect(m.target).toMatchObject({ kind: "client", name: "Test client Rosa" });
    expect(m.hourlyRateCents).toBe(3000);
    // Scaled to four servings from a two-serving recipe.
    expect(m.recipes[0]!.ingredients.map((i) => i.grams)).toEqual([800, 400]);
    expect(m.totals).toMatchObject({ groceriesCents: 0, unpricedIngredients: 2, totalCents: 0 });

    // Editing the recipe later doesn't change what was cooked.
    const r = await ok(cook.request(`/v1/recipes/${recipeId}`));
    await ok(cook.request(`/v1/recipes/${recipeId}`, { method: "PUT", headers: { "if-match": `"v${r.version}"` }, json: { title: "Renamed", servings: 2, description: "", method: "", ingredients: r.ingredients.slice(0, 1) } }));

    expect((await cook.request(`/v1/cook/prices/${encodeURIComponent(rice)}`, { method: "PUT", json: { centsPerKg: 450 } })).status).toBe(204);
    await ok(cook.request(`/v1/cook/meals/${m.id}/timer`, { method: "POST", json: { action: "start" } }));
    expect((await ok(cook.request(`/v1/cook/meals/${m.id}`))).timerRunning).toBe(true);
    await ok(cook.request(`/v1/cook/meals/${m.id}/expenses`, { method: "POST", json: { label: "Parking", amountCents: 500 } }));
    const after = CookMealSchema.parse(await ok(cook.request(`/v1/cook/meals/${m.id}`, { method: "PATCH", json: { cookingMinutes: 90, shoppingMinutes: 20, travelMinutes: 10 } })));
    expect(after.recipes[0]!.title).toBe("Chicken and rice");
    expect(after.recipes[0]!.ingredients).toHaveLength(2);
    expect(after.timerRunning).toBe(false);
    expect(after.recipes[0]!.ingredients.find((i) => i.foodId === rice)).toMatchObject({ source: "price_list", costCents: 180 });
    // 120 minutes at $30/h = $60; rice 400 g at $4.50/kg = $1.80; parking $5. No tax on services.
    expect(after.totals).toMatchObject({ pantryCents: 180, unpricedIngredients: 1, expensesCents: 500, minutes: { cooking: 90, shopping: 20, travel: 10, total: 120 }, timeCents: 6000, totalCents: 6680 });

    const list = await ok(cook.request(`/v1/cook/meals/${m.id}/shopping-list`));
    expect(list.items.find((i: { foodId: string }) => i.foodId === rice)).toMatchObject({ grams: 400, bought: false, estimateCents: 180 });
    expect(list.estimateCents).toBe(180);
  });

  it("reads a receipt, makes every line go to a meal or personal, checks the sum, spreads the tax and learns prices", async () => {
    const rosa = await client(cook, "Test client Rosa 2");
    const m = await meal(cook, { kind: "client", clientId: rosa.id }, { recipeId: await recipe(cook) });
    const read = await cook.request("/v1/cook/receipts/read", { method: "POST", json: { image: photo } });
    expect(read.status).toBe(201);
    const draft = CookReceiptSchema.parse(await read.json());
    expect(draft).toMatchObject({ store: "Test fixture: Corner Market", purchasedOn: "2026-11-20", taxCents: 120, totalCents: 2527, status: "draft", hasImage: true, differenceCents: 0 });
    expect(draft.lines.map((l) => l.priceCents)).toEqual([649, 329, 899, 80, 450]);
    expect(draft.lines[0]!.foodId).toMatch(/^fdc:/);
    expect(draft.lines[4]!.foodId).toBeNull();

    const body = (r: CookReceipt, patch: (l: CookReceipt["lines"][number], i: number) => Partial<CookReceipt["lines"][number]>) => ({
      store: r.store, purchasedOn: r.purchasedOn, subtotalCents: r.subtotalCents, taxCents: r.taxCents, totalCents: r.totalCents,
      lines: r.lines.map((l, i) => ({ id: l.id, text: l.text, priceCents: l.priceCents, foodId: l.foodId, grams: l.grams, mealId: l.mealId, personal: l.personal, ...patch(l, i) })),
    });
    const unassigned = await cook.request(`/v1/cook/receipts/${draft.id}/confirm`, { method: "POST" });
    expect(unassigned.status).toBe(422);
    expect((await unassigned.json()).error.code).toBe("lines_unassigned");

    // Paper towels are personal; the rest is for the meal. A typo in one price breaks the sum.
    // The cook also picks the exact foods the recipe uses for the chicken and rice lines.
    const foodFor = [chicken, rice];
    const typo = CookReceiptSchema.parse(await ok(cook.request(`/v1/cook/receipts/${draft.id}`, { method: "PUT", json: body(draft, (l, i) => (i === 4 ? { personal: true } : { mealId: m.id, priceCents: i === 0 ? 659 : l.priceCents, foodId: foodFor[i] ?? l.foodId })) })));
    expect(typo.differenceCents).toBe(10);
    const mismatch = await cook.request(`/v1/cook/receipts/${draft.id}/confirm`, { method: "POST" });
    expect((await mismatch.json()).error.code).toBe("receipt_mismatch");
    await ok(cook.request(`/v1/cook/receipts/${draft.id}`, { method: "PUT", json: body(typo, (l, i) => (i === 0 ? { priceCents: 649 } : {})) }));
    const confirmed = CookReceiptSchema.parse(await ok(cook.request(`/v1/cook/receipts/${draft.id}/confirm`, { method: "POST" })));
    expect(confirmed.status).toBe("confirmed");
    expect(confirmed.lines.reduce((s, l) => s + l.taxCents, 0)).toBe(120);

    const priced = CookMealSchema.parse(await ok(cook.request(`/v1/cook/meals/${m.id}`)));
    const billedTax = confirmed.lines.filter((l) => !l.personal).reduce((s, l) => s + l.taxCents, 0);
    expect(priced.totals.receiptCents).toBe(649 + 329 + 899 + 80 + billedTax);
    expect(priced.receiptLines).toHaveLength(4);
    // Chicken and rice are on the receipt now, so they're not priced again from the list.
    expect(priced.recipes[0]!.ingredients.every((i) => i.source === "receipt")).toBe(true);
    const prices = await ok(cook.request("/v1/cook/prices"));
    expect(prices.prices.find((p: { foodId: string }) => p.foodId === chicken)).toMatchObject({ source: "receipt", centsPerKg: 1300.6 });

    const img = await cook.request(`/v1/cook/receipts/${draft.id}/image`);
    expect(img.status).toBe(200);
    expect(img.headers.get("content-type")).toBe("image/webp");
    expect((await (await signIn()).request(`/v1/cook/receipts/${draft.id}/image`)).status).toBe(409);
  });

  it("spreads tax so the shares add up exactly", () => {
    expect(spreadTax(120, [649, 329, 899, 80, 450])).toEqual([32, 16, 45, 4, 23]);
    expect(spreadTax(100, [1, 1, 1]).reduce((a, b) => a + b, 0)).toBe(100);
    expect(spreadTax(0, [500])).toEqual([0]);
    expect(spreadTax(10, [-200, 300])).toEqual([0, 10]);
  });
});

describe("statements and sharing", () => {
  it("adds meals up for one client, freezes them when sent, never bills a meal twice, and voids", async () => {
    const lee = await client(cook, "Test client Lee");
    const other = await client(cook, "Test client Ola");
    const a = await meal(cook, { kind: "client", clientId: lee.id });
    const b = await meal(cook, { kind: "client", clientId: lee.id }, { name: "=HYPERLINK(\"x\")" });
    const c = await meal(cook, { kind: "client", clientId: other.id });
    await ok(cook.request(`/v1/cook/meals/${a.id}`, { method: "PATCH", json: { cookingMinutes: 60 } }));
    await ok(cook.request(`/v1/cook/meals/${b.id}`, { method: "PATCH", json: { cookingMinutes: 30 } }));
    const mixed = await cook.request("/v1/cook/statements", { method: "POST", json: { id: uuid(), title: "Mixed", mealIds: [a.id, c.id] } });
    expect(mixed.status).toBe(422);

    const id = uuid();
    const st = CookStatementSchema.parse(await ok(cook.request("/v1/cook/statements", { method: "POST", json: { id, title: "November", mealIds: [a.id, b.id] } }), 201));
    expect(st).toMatchObject({ status: "draft", target: { kind: "client", name: "Test client Lee" }, totals: { timeCents: 4500, totalCents: 4500, minutes: 90 } });
    expect((await cook.request("/v1/cook/statements", { method: "POST", json: { id: uuid(), title: "Again", mealIds: [a.id] } })).status).toBe(409);

    const sent = CookStatementSchema.parse(await ok(cook.request(`/v1/cook/statements/${id}/send`, { method: "POST" })));
    expect(sent.status).toBe("sent");
    const locked = await cook.request(`/v1/cook/meals/${a.id}`, { method: "PATCH", json: { cookingMinutes: 600 } });
    expect(locked.status).toBe(409);
    expect((await locked.json()).error.code).toBe("meal_locked");
    expect((await cook.request(`/v1/cook/meals/${a.id}`, { method: "DELETE" })).status).toBe(409);
    expect((await cook.request(`/v1/cook/statements/${id}`, { method: "DELETE" })).status).toBe(409);

    const csv = await (await cook.request(`/v1/cook/statements/${id}/csv`)).text();
    expect(csv.split("\r\n")[0]).toBe("Date,Meal,Recipes,Groceries,Minutes,Time,Other costs,Fee,Total,Currency");
    // A meal name can't become a spreadsheet formula.
    expect(csv).toContain(`"'=HYPERLINK(""x"")"`);
    expect(csv).toContain(",Total,,0.00,90,45.00,0.00,0.00,45.00,USD");

    expect((await ok(cook.request(`/v1/cook/statements/${id}/paid`, { method: "POST" }))).status).toBe("paid");
    expect((await ok(cook.request(`/v1/cook/statements/${id}/void`, { method: "POST" }))).status).toBe("void");
    await ok(cook.request(`/v1/cook/meals/${a.id}`, { method: "PATCH", json: { cookingMinutes: 45 } }));
    expect((await cook.request("/v1/cook/statements", { method: "POST", json: { id: uuid(), title: "Redo", mealIds: [a.id, b.id] } })).status).toBe(201);
  });

  it("shares only the parts switched on, by link and with the linked client, who sees all their history", async () => {
    const email = `client-${uuid()}@example.test`;
    const pat = await client(cook, "Test client Pat");
    const recipeId = await recipe(cook, "Lentil soup");
    const basic = await meal(cook, { kind: "client", clientId: pat.id }, { name: "Soup night", recipeId });
    const quiet = await meal(cook, { kind: "client", clientId: pat.id }, { name: "Unshared lunch" });
    await ok(cook.request(`/v1/cook/meals/${basic.id}`, { method: "PATCH", json: { cookingMinutes: 60 } }));

    const share = await ok(cook.request(`/v1/cook/meals/${basic.id}/share`, { method: "PUT", json: { parts: { groceries: false, time: false, totals: false }, link: true } }));
    expect(share.linkUrl).toMatch(/\/#\/cooked\/[0-9a-f-]{36}$/);
    expect(share.audience).toEqual({ client: false, group: false });
    const token = share.linkUrl.split("/").pop();
    const pub = await ok(call(`/v1/cooked/${token}`));
    expect(pub.meal).toMatchObject({ name: "Soup night", cookName: "Test fixture kitchen", recipes: [{ title: "Lentil soup", description: "Weeknight dinner", servings: 2 }], groceries: null, time: null, totals: null });
    // No prices or minutes anywhere in a basic share.
    expect(JSON.stringify(pub)).not.toMatch(/Cents|minutes/);

    const withTime = await ok(cook.request(`/v1/cook/meals/${basic.id}/share`, { method: "PUT", json: { parts: { groceries: false, time: true, totals: false }, link: true } }));
    expect(withTime.linkUrl).toBe(share.linkUrl);
    expect((await ok(call(`/v1/cooked/${token}`))).meal.time).toEqual({ minutes: 60, costCents: 3000 });

    // Invite Pat; only their own verified email can accept, and only once.
    const patUser = await signIn(email);
    const invited = await ok(cook.request(`/v1/cook/clients/${pat.id}/invite`, { method: "POST", json: { email } }));
    expect(invited.inviteEmail).toBe(email);
    expect(devOutbox(email).some((m) => m.subject.includes("Test fixture kitchen invited you"))).toBe(true);
    expect((await cook.request(`/v1/cook/clients/${pat.id}/invite`, { method: "POST", json: { email } })).status).toBe(429);
    const stranger = await signIn();
    expect((await stranger.request(`/v1/me/cook-invites/${pat.id}/accept`, { method: "POST" })).status).toBe(404);
    const invites = await ok(patUser.request("/v1/me/cook-invites"));
    expect(invites.invites).toEqual([expect.objectContaining({ id: pat.id, cookName: "Test fixture kitchen", clientName: "Test client Pat" })]);
    expect((await patUser.request(`/v1/me/cook-invites/${pat.id}/accept`, { method: "POST" })).status).toBe(204);
    expect((await ok(cook.request(`/v1/cook/meals/${basic.id}/share`))).audience.client).toBe(true);

    // History: every meal cooked for them, including one shared before they joined and one never shared.
    const mine = MyCooksSchema.parse(await ok(patUser.request("/v1/me/cooks"))).cooks[0]!;
    expect(mine.meals.map((m) => [m.name, m.shared ? "shared" : "not shared"])).toEqual(
      expect.arrayContaining([["Soup night", "shared"], ["Unshared lunch", "not shared"]]),
    );
    expect(mine.meals.find((m) => m.id === quiet.id)!.shared).toBeNull();
    expect(mine.meals.find((m) => m.id === basic.id)!.shared!.groceries).toBeNull();

    // A shared statement, from the statement as sent.
    const sid = uuid();
    await ok(cook.request("/v1/cook/statements", { method: "POST", json: { id: sid, title: "Pat, November", mealIds: [basic.id, quiet.id] } }), 201);
    expect((await cook.request(`/v1/cook/statements/${sid}/share`, { method: "PUT", json: { parts: { groceries: false, time: false, totals: true }, link: false } })).status).toBe(409);
    await ok(cook.request(`/v1/cook/statements/${sid}/send`, { method: "POST" }));
    await ok(cook.request(`/v1/cook/statements/${sid}/share`, { method: "PUT", json: { parts: { groceries: false, time: false, totals: true }, link: false } }));
    const st = MyCooksSchema.parse(await ok(patUser.request("/v1/me/cooks"))).cooks[0]!.statements[0]!;
    // The pantry is priced from what this cook paid on earlier receipts.
    const asSent = CookStatementSchema.parse(await ok(cook.request(`/v1/cook/statements/${sid}`)));
    expect(asSent.totals.timeCents).toBe(3000);
    expect(st).toMatchObject({ title: "Pat, November", status: "sent", totals: { totalCents: asSent.totals.totalCents } });
    expect(st.meals.every((m) => m.time === null && m.groceries === null)).toBe(true);

    // Stopping sharing kills the link; unlinking ends the history.
    expect((await cook.request(`/v1/cook/meals/${basic.id}/share`, { method: "DELETE" })).status).toBe(204);
    expect((await call(`/v1/cooked/${token}`)).status).toBe(404);
    expect((await patUser.request(`/v1/me/cooks/${pat.id}`, { method: "DELETE" })).status).toBe(204);
    expect((await ok(patUser.request("/v1/me/cooks"))).cooks).toEqual([]);
  });

  it("shows a group the basics, its admins the money, and lets the owner keep members from sharing", async () => {
    const owner = await signIn();
    const member = await signIn();
    await setUp(owner);
    await setUp(member, { businessName: "" });
    const group = await ok(owner.request("/v1/groups", { method: "POST", json: { name: "Test fixture flat", myName: "Owner" } }), 201);
    const link = await ok(owner.request(`/v1/groups/${group.id}/invites`, { method: "POST", json: { role: "member" } }), 201);
    await ok(member.request(`/v1/invites/${link.id}/accept`, { method: "POST", json: { myName: "Mel" } }));

    const byOwner = await meal(owner, { kind: "group", groupId: group.id }, { name: "Sunday roast" });
    await ok(owner.request(`/v1/cook/meals/${byOwner.id}`, { method: "PATCH", json: { cookingMinutes: 120 } }));
    await ok(owner.request(`/v1/cook/meals/${byOwner.id}/share`, { method: "PUT", json: { parts: { groceries: true, time: true, totals: true }, link: false } }));
    const asMember = GroupCookedMealsSchema.parse(await ok(member.request(`/v1/groups/${group.id}/cooked-meals`)));
    expect(asMember.meals[0]!.meal).toMatchObject({ name: "Sunday roast", groceries: null, time: null, totals: null });
    const asOwner = GroupCookedMealsSchema.parse(await ok(owner.request(`/v1/groups/${group.id}/cooked-meals`)));
    expect(asOwner.meals[0]!.meal.totals!.totalCents).toBe(6000);

    // A plain member's meal for the group goes to the owner and admins only.
    const byMember = await meal(member, { kind: "group", groupId: group.id }, { name: "Mel's curry" });
    await ok(member.request(`/v1/cook/meals/${byMember.id}/share`, { method: "PUT", json: { parts: { groceries: false, time: false, totals: false }, link: false } }));
    expect((await ok(owner.request(`/v1/groups/${group.id}/cooked-meals`))).meals.map((m: { meal: { name: string } }) => m.meal.name)).toContain("Mel's curry");
    expect((await member.request(`/v1/groups/${group.id}/cook-settings`, { method: "PUT", json: { memberShares: false } })).status).toBe(403);
    await ok(owner.request(`/v1/groups/${group.id}/cook-settings`, { method: "PUT", json: { memberShares: false } }));
    expect((await ok(owner.request(`/v1/groups/${group.id}/cooked-meals`))).meals.map((m: { meal: { name: string } }) => m.meal.name)).not.toContain("Mel's curry");
    const refused = await member.request(`/v1/cook/meals/${byMember.id}/share`, { method: "PUT", json: { parts: { groceries: false, time: false, totals: false }, link: false } });
    expect(refused.status).toBe(403);
    expect((await refused.json()).error.code).toBe("member_shares_off");
  });
});
