import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  AllergenSchema,
  FoodPreferencesSchema,
  GroupDetailSchema,
  MealFeedbackSchema,
  ShoppingListSchema,
  SyncBatchResponseSchema,
  SyncChangesResponseSchema,
} from "@betterplate/contracts";
import { ALLERGENS } from "@betterplate/nutrition";
import { pool } from "../src/db/pool.ts";
import { type Client, findFood, signIn } from "./helpers.ts";

const uuid = () => crypto.randomUUID();
const ingredient = (foodId: string, quantity: number, extra: Record<string, unknown> = {}) => ({ id: uuid(), foodId, quantity, unit: "g", role: "ingredient", ...extra });

let rice: string;
let broccoli: string;
let peanuts: string;
let oil: string;
let spinach: string;

beforeAll(async () => {
  rice = await findFood("Rice, white, long-grain, regular, enriched, cooked");
  broccoli = await findFood("Broccoli, raw");
  peanuts = await findFood("Peanuts, all types, raw");
  oil = await findFood("Oil, olive, salad or cooking");
  spinach = await findFood("Spinach, raw");
});
afterAll(() => pool.end());

async function batch(client: Client, operations: unknown[]) {
  const res = await client.request("/v1/sync/batch", { method: "POST", json: { protocol: 1, operations } });
  expect(res.status).toBe(200);
  return SyncBatchResponseSchema.parse(await res.json()).results;
}

async function changes(client: Client, cursor = "0") {
  const res = await client.request(`/v1/sync/changes?cursor=${cursor}&limit=500`);
  expect(res.status).toBe(200);
  return SyncChangesResponseSchema.parse(await res.json());
}

async function saveRecipe(client: Client, body: Record<string, unknown>) {
  const id = uuid();
  const [r] = await batch(client, [{ opId: uuid(), type: "recipe.put", entityId: id, baseVersion: null, body: { description: "", method: "", ...body } }]);
  expect(r!.status).toBe("applied");
  return id;
}

const planOp = (entityId: string, recipeId: string, body: Record<string, unknown> = {}, baseVersion: number | null = null) => ({
  opId: uuid(), type: "plan.put", entityId, baseVersion, body: { date: "2026-11-02", slot: "dinner", recipeId, title: "Rice bowl", servings: 2, ...body },
});

const prefsOp = (entityId: string, body: Record<string, unknown>, baseVersion: number | null = null) => ({
  opId: uuid(), type: "prefs.put", entityId, baseVersion, body: { allergyAnswer: "none", allergens: [], likes: [], dislikes: [], notes: "", ...body },
});

const me = async (client: Client) => (await (await client.request("/v1/me")).json()).id as string;

async function createGroup(owner: Client, name = "The Garcias", myName = "Mom") {
  const res = await owner.request("/v1/groups", { method: "POST", json: { name, myName } });
  expect(res.status).toBe(201);
  return GroupDetailSchema.parse(await res.json());
}

async function invite(admin: Client, groupId: string, role: "admin" | "member") {
  const res = await admin.request(`/v1/groups/${groupId}/invites`, { method: "POST", json: { role } });
  expect(res.status).toBe(201);
  return (await res.json()) as { id: string; url: string; role: string };
}

async function join(client: Client, token: string, myName: string) {
  const res = await client.request(`/v1/invites/${token}/accept`, { method: "POST", json: { myName } });
  expect(res.status).toBe(200);
  return GroupDetailSchema.parse(await res.json());
}

describe("shopping list", () => {
  it("adds up planned meals in grams, scaled to servings planned, from the recipe as it is now", async () => {
    const ana = await signIn();
    const bowl = await saveRecipe(ana, { title: "Rice bowl", servings: 2, ingredients: [ingredient(rice, 300), ingredient(broccoli, 100), ingredient(oil, 10, { role: "cooking_oil", oilDiscardedGrams: 4 })] });
    const plain = await saveRecipe(ana, { title: "Plain rice", servings: 1, ingredients: [ingredient(rice, 150)] });
    await batch(ana, [planOp(uuid(), bowl, { servings: 4 }), planOp(uuid(), plain, { date: "2026-11-03", servings: 1, title: "Plain rice" }), planOp(uuid(), plain, { date: "2026-12-30", title: "Plain rice" })]);
    const res = await ana.request("/v1/shopping-list?from=2026-11-01&to=2026-11-07");
    expect(res.status).toBe(200);
    const list = ShoppingListSchema.parse(await res.json());
    expect(list.plans).toBe(2);
    const item = (id: string) => list.items.find((i) => i.foodId === id)!;
    expect(item(rice).grams).toBeCloseTo(600 + 150, 6);
    expect(item(rice).preparedForm).toBe(true);
    expect(item(rice).recipes).toEqual(["Rice bowl", "Plain rice"]);
    expect(item(broccoli).grams).toBeCloseTo(200, 6);
    // Oil: what goes in the pan is bought, including what is later discarded.
    expect(item(oil)).toMatchObject({ grams: 20, oil: true });
  });

  it("lists plans whose recipe is gone, bounds the range and needs a session", async () => {
    const ana = await signIn();
    await batch(ana, [planOp(uuid(), uuid(), { title: "Old soup" })]);
    const list = await (await ana.request("/v1/shopping-list?from=2026-11-02&to=2026-11-02")).json();
    expect(list.missing).toEqual([expect.objectContaining({ title: "Old soup", date: "2026-11-02" })]);
    expect(list.items).toEqual([]);
    expect((await ana.request("/v1/shopping-list?from=2026-11-01&to=2026-12-31")).status).toBe(400);
    expect((await (await signIn()).request(`/v1/shopping-list?from=2026-11-01&to=2026-11-02&groupId=${uuid()}`)).status).toBe(404);
  });
});

describe("food preferences and meal feedback", () => {
  it("records what people tell us about allergies, synced and versioned", async () => {
    const bo = await signIn();
    const id = await me(bo);
    const [first] = await batch(bo, [prefsOp(id, { allergyAnswer: "listed", allergens: ["peanut", "sesame"], dislikes: [spinach], likes: [broccoli] })]);
    expect(first).toMatchObject({ status: "applied", version: 1 });
    const stale = await batch(bo, [prefsOp(id, { allergyAnswer: "none" }, null)]);
    expect(stale[0]).toMatchObject({ status: "conflict", serverPreferences: expect.objectContaining({ allergens: ["peanut", "sesame"] }) });
    const { preferences } = await (await bo.request("/v1/preferences")).json();
    expect(FoodPreferencesSchema.array().parse(preferences)).toEqual([expect.objectContaining({ id, allergyAnswer: "listed", dislikes: [spinach], profileId: null })]);
    const feed = await changes(bo);
    expect(feed.changes.find((c) => c.entity === "preferences")?.preferences?.allergens).toEqual(["peanut", "sesame"]);
  });

  it("accepts 'none' and 'prefer not to say', and rejects mismatched answers, unknown foods and other people", async () => {
    const bo = await signIn();
    const id = await me(bo);
    expect((await batch(bo, [prefsOp(id, { allergyAnswer: "prefer_not" })]))[0]!.status).toBe("applied");
    const bad = await bo.request("/v1/sync/batch", { method: "POST", json: { protocol: 1, operations: [prefsOp(id, { allergyAnswer: "none", allergens: ["milk"] })] } });
    expect(bad.status).toBe(400);
    const empty = await bo.request("/v1/sync/batch", { method: "POST", json: { protocol: 1, operations: [prefsOp(id, { allergyAnswer: "listed", allergens: [] })] } });
    expect(empty.status).toBe(400);
    expect((await batch(bo, [prefsOp(id, { likes: ["fdc:999999999"] }, 1)]))[0]).toMatchObject({ status: "rejected", error: { code: "unknown_food" } });
    const other = await me(await signIn());
    expect((await batch(bo, [prefsOp(other, {})]))[0]).toMatchObject({ status: "rejected" });
    expect((await batch(bo, [prefsOp(uuid(), { profileId: uuid() })]))[0]).toMatchObject({ status: "rejected", error: { code: "not_found" } });
  });

  it("keeps the allergen list equal in the contract and the tagging rules", () => {
    expect([...AllergenSchema.options]).toEqual([...ALLERGENS]);
  });

  it("takes feedback on a logged meal, removes it with the log, and never on someone else's meal", async () => {
    const cy = await signIn();
    const logId = uuid();
    await batch(cy, [{
      opId: uuid(), type: "log.create", entityId: logId,
      body: { plannedMealId: null, recipeId: null, recipe: { title: "Green rice", servings: 1, ingredients: [ingredient(rice, 200), ingredient(spinach, 50)] }, servings: 1, slot: "lunch", localDate: "2026-11-02", eatenAt: "2026-11-02T12:00:00-03:00" },
    }]);
    const fb = (body: Record<string, unknown>, base: number | null = null, entityId = logId) => ({ opId: uuid(), type: "feedback.put", entityId, baseVersion: base, body: { rating: "disliked", comment: "Didn't like the spinach", dislikedFoodIds: [spinach], ...body } });
    expect((await batch(cy, [fb({})]))[0]).toMatchObject({ status: "applied", version: 1 });
    expect((await batch(cy, [fb({ rating: "liked", comment: "Better the second time" }, 1)]))[0]).toMatchObject({ status: "applied", version: 2 });
    const { feedback } = await (await cy.request("/v1/meal-feedback")).json();
    expect(MealFeedbackSchema.array().parse(feedback)).toEqual([expect.objectContaining({ id: logId, rating: "liked", dislikedFoodIds: [spinach] })]);
    expect((await batch(await signIn(), [fb({})]))[0]).toMatchObject({ status: "rejected", error: { code: "not_found" } });
    await batch(cy, [{ opId: uuid(), type: "log.delete", entityId: logId }]);
    expect((await (await cy.request("/v1/meal-feedback")).json()).feedback).toEqual([]);
    const feed = await changes(cy);
    expect(feed.changes.filter((c) => c.entity === "meal_feedback").at(-1)).toMatchObject({ deleted: true, feedback: null });
    expect((await batch(cy, [fb({}, 3)]))[0]).toMatchObject({ status: "rejected", error: { code: "log_removed" } });
  });
});

describe("groups", () => {
  it("invites by single-use links, with roles, and shows chosen names, never emails", async () => {
    const mom = await signIn();
    const nutri = await signIn();
    const kid = await signIn();
    const outsider = await signIn();
    const group = await createGroup(mom);
    expect(group.role).toBe("owner");

    const adminLink = await invite(mom, group.id, "admin");
    expect(adminLink.url).toMatch(new RegExp(`/#/join/${adminLink.id}$`));
    const preview = await (await nutri.request(`/v1/invites/${adminLink.id}`)).json();
    expect(preview).toMatchObject({ groupName: "The Garcias", role: "admin", invitedBy: "Mom" });
    const joined = await join(nutri, adminLink.id, "Dr. Lee");
    expect(joined.role).toBe("admin");
    // Single use.
    expect((await outsider.request(`/v1/invites/${adminLink.id}/accept`, { method: "POST", json: { myName: "X" } })).status).toBe(404);

    // Admins invite members but not admins; members invite no one.
    expect((await nutri.request(`/v1/groups/${group.id}/invites`, { method: "POST", json: { role: "admin" } })).status).toBe(403);
    const memberLink = await invite(nutri, group.id, "member");
    const detail = await join(kid, memberLink.id, "Sam");
    expect(detail.invites).toEqual([]);
    expect((await kid.request(`/v1/groups/${group.id}/invites`, { method: "POST", json: { role: "member" } })).status).toBe(403);
    const again = await kid.request(`/v1/invites/${(await invite(mom, group.id, "member")).id}/accept`, { method: "POST", json: { myName: "Sam again" } });
    expect(again.status).toBe(409);

    const seen = JSON.stringify(detail);
    for (const c of [mom, nutri, kid]) expect(seen).not.toContain(c.email);
    expect(detail.members.map((m) => [m.name, m.role])).toEqual([["Mom", "owner"], ["Dr. Lee", "admin"], ["Sam", "member"]]);

    // Outsiders can't tell the group exists.
    expect((await outsider.request(`/v1/groups/${group.id}`)).status).toBe(404);
    expect((await outsider.request(`/v1/groups/${group.id}/meals?from=2026-11-01&to=2026-11-07`)).status).toBe(404);
    // Members don't see the whole group's meals.
    expect((await kid.request(`/v1/groups/${group.id}/meals?from=2026-11-01&to=2026-11-07`)).status).toBe(403);
  });

  it("lets admins plan a member's meals: members see them, can't change them, and propose their own for approval", async () => {
    const mom = await signIn();
    const nutri = await signIn();
    const teen = await signIn();
    const group = await createGroup(mom);
    await join(nutri, (await invite(mom, group.id, "admin")).id, "Dr. Lee");
    const joined = await join(teen, (await invite(mom, group.id, "member")).id, "Sam");
    const sam = joined.members.find((m) => m.name === "Sam")!;

    // The teen lists a peanut allergy themselves.
    await batch(teen, [prefsOp(await me(teen), { allergyAnswer: "listed", allergens: ["peanut"] })]);

    // The nutritionist puts a recipe in the group and plans it for the teen.
    const satay = await saveRecipe(nutri, { title: "Peanut satay rice", servings: 2, ingredients: [ingredient(rice, 300), ingredient(peanuts, 60)] });
    const copy = await nutri.request(`/v1/groups/${group.id}/recipes`, { method: "POST", json: { recipeId: satay } });
    expect(copy.status).toBe(201);
    const groupRecipe = await copy.json();
    expect(groupRecipe.groupId).toBe(group.id);

    const res = await nutri.request(`/v1/groups/${group.id}/plans`, { method: "POST", json: { memberId: sam.id, date: "2026-11-02", slot: "dinner", recipeId: groupRecipe.id, servings: 1 } });
    expect(res.status).toBe(201);
    const { plan, alert } = await res.json();
    // An alert, never a block.
    expect(alert).toMatchObject({ matches: ["peanut"], rulesVersion: expect.stringMatching(/^allergen-rules-/) });
    expect(plan).toMatchObject({ status: "planned", groupId: group.id, plannedBy: "Dr. Lee", title: "Peanut satay rice" });

    // It reaches the teen's kitchen through sync, with the group's recipe.
    const feed = await changes(teen);
    expect(feed.changes.find((c) => c.entity === "planned_meal" && c.entityId === plan.id)?.plannedMeal).toMatchObject({ plannedBy: "Dr. Lee", status: "planned" });
    expect(feed.changes.find((c) => c.entity === "recipe" && c.entityId === groupRecipe.id)?.recipe?.title).toBe("Peanut satay rice");

    // The teen can't change or remove it, nor edit the group's recipe.
    const [edit] = await batch(teen, [planOp(plan.id, groupRecipe.id, { servings: 3 }, plan.version)]);
    expect(edit).toMatchObject({ status: "rejected", error: { code: "managed_by_group" } });
    const [del] = await batch(teen, [{ opId: uuid(), type: "plan.delete", entityId: plan.id, baseVersion: plan.version }]);
    expect(del).toMatchObject({ status: "rejected", error: { code: "managed_by_group" } });
    const [recipeEdit] = await batch(teen, [{ opId: uuid(), type: "recipe.put", entityId: groupRecipe.id, baseVersion: groupRecipe.version, body: { title: "Mine now", description: "", servings: 1, ingredients: [], method: "" } }]);
    expect(recipeEdit).toMatchObject({ status: "rejected", error: { code: "read_only" } });

    // Their own plan waits for approval, and stays off the shopping list until approved.
    const ownPlan = uuid();
    const own = await saveRecipe(teen, { title: "Toast", servings: 1, ingredients: [ingredient(broccoli, 80)] });
    expect((await batch(teen, [planOp(ownPlan, own, { title: "Toast", date: "2026-11-03" })]))[0]).toMatchObject({ status: "applied" });
    const mine = await (await teen.request("/v1/meals?from=2026-11-03&to=2026-11-03")).json();
    expect(mine.planned[0]).toMatchObject({ id: ownPlan, status: "proposed" });
    const list = await (await teen.request("/v1/shopping-list?from=2026-11-01&to=2026-11-07")).json();
    expect(list).toMatchObject({ awaitingApproval: 1, plans: 1 });

    // Members can't approve; admins can. Approval is version-bumped and synced.
    expect((await teen.request(`/v1/groups/${group.id}/plans/${ownPlan}/approve`, { method: "POST" })).status).toBe(403);
    const approved = await (await mom.request(`/v1/groups/${group.id}/plans/${ownPlan}/approve`, { method: "POST" })).json();
    expect(approved).toMatchObject({ status: "planned", version: 2 });
    expect((await mom.request(`/v1/groups/${group.id}/plans/${ownPlan}/approve`, { method: "POST" })).status).toBe(409);

    // The teen eats the planned meal and says how it went; admins see it all.
    const logId = uuid();
    await batch(teen, [
      { opId: uuid(), type: "log.create", entityId: logId, body: { plannedMealId: plan.id, recipeId: groupRecipe.id, recipe: { title: groupRecipe.title, servings: 2, ingredients: groupRecipe.ingredients }, servings: 1, slot: "dinner", localDate: "2026-11-02", eatenAt: "2026-11-02T20:00:00-03:00" } },
      { opId: uuid(), type: "feedback.put", entityId: logId, baseVersion: null, body: { rating: "disliked", comment: "Too dry", dislikedFoodIds: [rice] } },
    ]);
    const meals = await (await nutri.request(`/v1/groups/${group.id}/meals?from=2026-11-01&to=2026-11-07`)).json();
    const samMeals = meals.members.find((m: { memberId: string }) => m.memberId === sam.id);
    expect(samMeals.preferences.allergens).toEqual(["peanut"]);
    expect(samMeals.planned.map((p: { id: string }) => p.id).sort()).toEqual([plan.id, ownPlan].sort());
    expect(samMeals.eaten).toHaveLength(1);
    expect(samMeals.feedback[0]).toMatchObject({ id: logId, comment: "Too dry" });

    // Group shopping list (admins): everyone's planned meals.
    const groupList = await (await mom.request(`/v1/shopping-list?from=2026-11-01&to=2026-11-07&groupId=${group.id}`)).json();
    expect(groupList.items.find((i: { foodId: string }) => i.foodId === peanuts).grams).toBeCloseTo(30, 6);
    expect((await teen.request(`/v1/shopping-list?from=2026-11-01&to=2026-11-07&groupId=${group.id}`)).status).toBe(404);
  });

  it("two admins editing the same plan: the second gets the current copy instead of overwriting", async () => {
    const mom = await signIn();
    const dad = await signIn();
    const group = await createGroup(mom);
    await join(dad, (await invite(mom, group.id, "admin")).id, "Dad");
    const recipeId = await saveRecipe(mom, { title: "Rice", servings: 1, ingredients: [ingredient(rice, 100)] });
    const gr = await (await mom.request(`/v1/groups/${group.id}/recipes`, { method: "POST", json: { recipeId } })).json();
    const detail = await (await mom.request(`/v1/groups/${group.id}`)).json();
    const momMember = detail.members.find((m: { name: string }) => m.name === "Mom");
    const { plan } = await (await dad.request(`/v1/groups/${group.id}/plans`, { method: "POST", json: { memberId: momMember.id, date: "2026-11-04", slot: "lunch", recipeId: gr.id, servings: 1 } })).json();
    const put = (client: Client, servings: number, version: number) =>
      client.request(`/v1/groups/${group.id}/plans/${plan.id}`, { method: "PUT", headers: { "if-match": `"v${version}"` }, json: { date: "2026-11-04", slot: "lunch", recipeId: gr.id, servings } });
    expect((await put(mom, 2, 1)).status).toBe(200);
    const late = await put(dad, 3, 1);
    expect(late.status).toBe(412);
    expect((await late.json()).error.details.server).toMatchObject({ servings: 2, version: 2 });
    expect((await mom.request(`/v1/groups/${group.id}/plans/${plan.id}`, { method: "PUT", json: { date: "2026-11-04", slot: "lunch", recipeId: gr.id, servings: 1 } })).status).toBe(428);
    // Plans must use the group's recipes.
    const personal = await saveRecipe(dad, { title: "Dad's own", servings: 1, ingredients: [ingredient(rice, 100)] });
    expect((await dad.request(`/v1/groups/${group.id}/plans`, { method: "POST", json: { memberId: momMember.id, date: "2026-11-04", slot: "lunch", recipeId: personal, servings: 1 } })).status).toBe(422);
    expect((await dad.request(`/v1/groups/${group.id}/plans/${plan.id}`, { method: "DELETE", headers: { "if-match": '"v1"' } })).status).toBe(412);
    expect((await dad.request(`/v1/groups/${group.id}/plans/${plan.id}`, { method: "DELETE", headers: { "if-match": '"v2"' } })).status).toBe(204);
  });

  it("keeps kids as profiles in the parent's kitchen: no login, planned by admins, logged by the parent, apart from the parent's own totals", async () => {
    const mom = await signIn();
    const nutri = await signIn();
    const group = await createGroup(mom);
    await join(nutri, (await invite(mom, group.id, "admin")).id, "Dr. Lee");
    const kidId = uuid();
    const withKid = GroupDetailSchema.parse(await (await mom.request(`/v1/groups/${group.id}/profiles`, { method: "POST", json: { id: kidId, name: "Lucy" } })).json());
    const lucy = withKid.members.find((m) => m.kind === "profile")!;
    expect(lucy).toMatchObject({ name: "Lucy", role: "member", ownedByMe: true, userId: null, profileId: kidId });

    // The nutritionist records Lucy's allergy, as the family told them.
    const prefRes = await nutri.request(`/v1/groups/${group.id}/members/${lucy.id}/preferences`, { method: "PUT", json: { allergyAnswer: "listed", allergens: ["milk"], likes: [], dislikes: [spinach], notes: "" } });
    expect(prefRes.status).toBe(200);
    expect(await prefRes.json()).toMatchObject({ id: kidId, profileId: kidId, allergens: ["milk"] });
    // People record their own preferences.
    const momMember = withKid.members.find((m) => m.name === "Mom")!;
    expect((await nutri.request(`/v1/groups/${group.id}/members/${momMember.id}/preferences`, { method: "PUT", json: { allergyAnswer: "none", allergens: [], likes: [], dislikes: [], notes: "" } })).status).toBe(422);

    const recipeId = await saveRecipe(nutri, { title: "Broccoli rice", servings: 1, ingredients: [ingredient(rice, 100), ingredient(broccoli, 50)] });
    const gr = await (await nutri.request(`/v1/groups/${group.id}/recipes`, { method: "POST", json: { recipeId } })).json();
    const { plan, alert } = await (await nutri.request(`/v1/groups/${group.id}/plans`, { method: "POST", json: { memberId: lucy.id, date: "2026-11-05", slot: "lunch", recipeId: gr.id, servings: 1 } })).json();
    expect(alert.matches).toEqual([]);
    expect(plan).toMatchObject({ profileId: kidId });

    // It lands in mom's kitchen (the profile's), with the profile and its preferences.
    const feed = await changes(mom);
    expect(feed.changes.find((c) => c.entity === "profile")?.profile).toMatchObject({ id: kidId, name: "Lucy" });
    expect(feed.changes.find((c) => c.entity === "planned_meal" && c.entityId === plan.id)?.plannedMeal?.profileId).toBe(kidId);
    expect(feed.changes.find((c) => c.entity === "preferences" && c.entityId === kidId)?.preferences?.allergens).toEqual(["milk"]);

    // Mom logs what Lucy ate on her own device; it stays out of mom's own meals and totals.
    await batch(mom, [{ opId: uuid(), type: "log.create", entityId: uuid(), body: { plannedMealId: plan.id, recipeId: gr.id, recipe: { title: gr.title, servings: 1, ingredients: gr.ingredients }, servings: 1, slot: "lunch", localDate: "2026-11-05", eatenAt: "2026-11-05T12:00:00-03:00", profileId: kidId } }]);
    const momOwn = await (await mom.request("/v1/meals?from=2026-11-05&to=2026-11-05")).json();
    expect(momOwn).toMatchObject({ planned: [], eaten: [] });
    const lucyMeals = await (await mom.request(`/v1/meals?from=2026-11-05&to=2026-11-05&profileId=${kidId}`)).json();
    expect(lucyMeals.planned).toHaveLength(1);
    expect(lucyMeals.eaten).toHaveLength(1);
    const summary = await (await mom.request("/v1/nutrition/summary?from=2026-11-05&to=2026-11-05")).json();
    expect(summary.daysLogged).toBe(0);
    // Only the owner logs for a profile, and only the owner reads its meals directly.
    const [notTheirs] = await batch(nutri, [{ opId: uuid(), type: "log.create", entityId: uuid(), body: { plannedMealId: null, recipeId: null, recipe: { title: "x", servings: 1, ingredients: [] }, servings: 1, slot: "lunch", localDate: "2026-11-05", eatenAt: "2026-11-05T12:00:00-03:00", profileId: kidId } }]);
    expect(notTheirs).toMatchObject({ status: "rejected", error: { code: "not_found" } });
    expect((await nutri.request(`/v1/meals?from=2026-11-05&to=2026-11-05&profileId=${kidId}`)).status).toBe(404);

    // A profile's own shopping list.
    const kidList = await (await mom.request(`/v1/shopping-list?from=2026-11-01&to=2026-11-07&profileId=${kidId}`)).json();
    expect(kidList.items.map((i: { foodId: string }) => i.foodId).sort()).toEqual([rice, broccoli].sort());

    // Deleting the profile erases everything recorded for it; devices get a tombstone.
    const cursor = (await changes(mom)).cursor;
    expect((await mom.request(`/v1/profiles/${kidId}`, { method: "DELETE" })).status).toBe(204);
    const after = await changes(mom, cursor);
    expect(after.changes.find((c) => c.entity === "profile")).toMatchObject({ entityId: kidId, deleted: true, profile: null });
    const counts = await pool.query(
      "select (select count(*) from planned_meals where profile_id = $1) + (select count(*) from consumption_events where profile_id = $1) + (select count(*) from food_preferences where profile_id = $1) as n",
      [kidId],
    );
    expect(Number(counts.rows[0].n)).toBe(0);
    expect((await (await mom.request(`/v1/groups/${group.id}`)).json()).members.some((m: { kind: string }) => m.kind === "profile")).toBe(false);
  });

  it("shares group recipes with every member, lets admins edit them, and sends them to people who join later", async () => {
    const owner = await signIn();
    const admin = await signIn();
    const late = await signIn();
    const outsider = await signIn();
    const group = await createGroup(owner, "Clinic", "Dr. Lee");
    await join(admin, (await invite(owner, group.id, "admin")).id, "Assistant");
    const original = await saveRecipe(owner, { title: "Lentil soup", servings: 4, ingredients: [ingredient(rice, 200)] });
    const gr = await (await owner.request(`/v1/groups/${group.id}/recipes`, { method: "POST", json: { recipeId: original } })).json();

    // Another admin edits it through the ordinary recipe API.
    const put = await admin.request(`/v1/recipes/${gr.id}`, { method: "PUT", headers: { "if-match": `"v${gr.version}"` }, json: { title: "Lentil soup, less rice", description: "", servings: 4, ingredients: [ingredient(rice, 150)], method: "" } });
    expect(put.status).toBe(200);
    expect(await put.json()).toMatchObject({ groupId: group.id, version: gr.version + 1 });
    // The owner's original stays theirs and unchanged.
    expect((await (await owner.request(`/v1/recipes/${original}`)).json()).title).toBe("Lentil soup");
    expect((await outsider.request(`/v1/recipes/${gr.id}`)).status).toBe(404);

    // Someone joining later gets the group's recipes after their own cursor.
    const cursor = (await changes(late)).cursor;
    await join(late, (await invite(owner, group.id, "member")).id, "Pat");
    const feed = await changes(late, cursor);
    expect(feed.changes.find((c) => c.entity === "recipe" && c.entityId === gr.id)?.recipe).toMatchObject({ title: "Lentil soup, less rice", groupId: group.id });
    expect((await late.request(`/v1/groups/${group.id}/recipes`)).status).toBe(200);
    expect((await late.request(`/v1/recipes/${gr.id}`, { method: "PUT", headers: { "if-match": '"v2"' }, json: { title: "x", description: "", servings: 1, ingredients: [], method: "" } })).status).toBe(403);
  });

  it("leaving keeps planned meals as the person's own; ending a group returns recipes to their creators", async () => {
    const owner = await signIn();
    const admin = await signIn();
    const member = await signIn();
    const group = await createGroup(owner, "Team");
    await join(admin, (await invite(owner, group.id, "admin")).id, "Coach");
    const joined = await join(member, (await invite(owner, group.id, "member")).id, "Kai");
    const kai = joined.members.find((m) => m.name === "Kai")!;
    const recipeId = await saveRecipe(admin, { title: "Oats", servings: 1, ingredients: [ingredient(broccoli, 100)] });
    const gr = await (await admin.request(`/v1/groups/${group.id}/recipes`, { method: "POST", json: { recipeId } })).json();
    const { plan } = await (await admin.request(`/v1/groups/${group.id}/plans`, { method: "POST", json: { memberId: kai.id, date: "2026-11-06", slot: "breakfast", recipeId: gr.id, servings: 1 } })).json();

    // Only the owner removes others; the owner can't leave.
    expect((await admin.request(`/v1/groups/${group.id}/members/${kai.id}`, { method: "DELETE" })).status).toBe(403);
    const ownerMember = joined.members.find((m) => m.role === "owner")!;
    expect((await owner.request(`/v1/groups/${group.id}/members/${ownerMember.id}`, { method: "DELETE" })).status).toBe(403);
    expect((await member.request(`/v1/groups/${group.id}/members/${kai.id}`, { method: "DELETE" })).status).toBe(204);
    const mine = await (await member.request("/v1/meals?from=2026-11-06&to=2026-11-06")).json();
    expect(mine.planned[0]).toMatchObject({ id: plan.id, groupId: null });
    // Now theirs to change.
    expect((await batch(member, [planOp(plan.id, gr.id, { date: "2026-11-06", servings: 2 }, mine.planned[0].version)]))[0]!.status).toBe("applied");
    expect((await (await member.request("/v1/recipes")).json()).recipes.some((r: { id: string }) => r.id === gr.id)).toBe(false);

    // Admins can't end the group; the owner can, and the recipe returns to its creator.
    expect((await admin.request(`/v1/groups/${group.id}`, { method: "DELETE" })).status).toBe(403);
    const cursor = (await changes(admin)).cursor;
    expect((await owner.request(`/v1/groups/${group.id}`, { method: "DELETE" })).status).toBe(204);
    const back = await changes(admin, cursor);
    expect(back.changes.find((c) => c.entity === "recipe" && c.entityId === gr.id)?.recipe).toMatchObject({ groupId: null, title: "Oats" });
    expect((await (await admin.request("/v1/groups")).json()).groups).toEqual([]);
  });

  it("shows a group recipe's photo to members only, and includes groups and preferences in the download", async () => {
    const owner = await signIn();
    const member = await signIn();
    const outsider = await signIn();
    const group = await createGroup(owner, "Photo club", "Ana");
    await join(member, (await invite(owner, group.id, "member")).id, "Ben");
    // A 1x1 PNG uploaded by the owner, put on a recipe copied into the group.
    const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    const up = await owner.request("/v1/images/upload", { method: "POST", json: { data: png, alt: "Bowl", rightsConfirmed: true } });
    expect(up.status).toBe(201);
    const image = await up.json();
    const recipeId = await saveRecipe(owner, { title: "Bowl", servings: 1, ingredients: [ingredient(rice, 100)], image });
    const gr = await (await owner.request(`/v1/groups/${group.id}/recipes`, { method: "POST", json: { recipeId } })).json();
    expect(gr.image?.id).toBe(image.id);
    expect((await member.request(`/v1/images/${image.id}`)).status).toBe(200);
    expect((await outsider.request(`/v1/images/${image.id}`)).status).toBe(404);

    await batch(member, [prefsOp(await me(member), { allergyAnswer: "listed", allergens: ["egg"] })]);
    const exported = await (await member.request("/v1/me/export")).json();
    expect(exported.foodPreferences[0].allergens).toEqual(["egg"]);
    expect(exported.groups).toEqual([expect.objectContaining({ name: "Photo club", role: "member", nameInGroup: "Ben" })]);
  });

  it("ends the groups an account owns when it is deleted, keeping other members' recipes", async () => {
    const owner = await signIn();
    const admin = await signIn();
    const group = await createGroup(owner, "Short-lived");
    await join(admin, (await invite(owner, group.id, "admin")).id, "Helper");
    const recipeId = await saveRecipe(admin, { title: "Helper's rice", servings: 1, ingredients: [ingredient(rice, 100)] });
    const gr = await (await admin.request(`/v1/groups/${group.id}/recipes`, { method: "POST", json: { recipeId } })).json();
    expect((await owner.request("/v1/me", { method: "DELETE" })).status).toBe(204);
    expect((await (await admin.request("/v1/groups")).json()).groups).toEqual([]);
    expect((await (await admin.request(`/v1/recipes/${gr.id}`)).json())).toMatchObject({ groupId: null, title: "Helper's rice" });
  });
});
