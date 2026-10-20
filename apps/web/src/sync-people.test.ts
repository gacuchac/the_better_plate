import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import type { SyncBatchRequest, SyncBatchResponse, SyncChange, SyncChangesResponse, SyncResult } from "@betterplate/contracts";
import { openUserDb } from "./localdb.ts";
import { SyncEngine } from "./sync.ts";

/** A scripted server: answers each operation with `answer`, and serves queued changes once. */
function stubServer(answer: (op: SyncBatchRequest["operations"][number]) => Partial<SyncResult> = () => ({})) {
  const batches: SyncBatchRequest[] = [];
  let pending: SyncChange[] = [];
  let cursor = 0;
  return {
    batches,
    push: (...changes: SyncChange[]) => void (pending = [...pending, ...changes]),
    client: {
      async syncBatch(req: SyncBatchRequest): Promise<SyncBatchResponse> {
        batches.push(structuredClone(req));
        return {
          protocol: 1,
          results: req.operations.map((op) => ({ opId: op.opId, entityId: op.entityId, status: "applied", replayed: false, version: 1, ...answer(op) }) as SyncResult),
        };
      },
      async changes(): Promise<SyncChangesResponse> {
        const changes = pending.map((c) => ({ ...c, seq: String(++cursor) }));
        pending = [];
        return { changes, cursor: String(cursor), hasMore: false } as SyncChangesResponse;
      },
    },
  };
}

const engineWith = async (server: ReturnType<typeof stubServer>) => new SyncEngine(await openUserDb(crypto.randomUUID()), server.client);
const prefs = { allergyAnswer: "listed" as const, allergens: ["peanut" as const], likes: [], dislikes: ["fdc:1"], notes: "" };
const recipe = { title: "Rice", servings: 1, ingredients: [] };

describe("SyncEngine: people, preferences and groups", () => {
  it("sends preferences and meal feedback as versioned operations", async () => {
    const server = stubServer();
    const engine = await engineWith(server);
    const me = crypto.randomUUID();
    await engine.savePreferences(me, prefs);
    const logId = await engine.logMeal({ plannedMealId: null, recipeId: null, recipe, servings: 1, slot: "lunch", localDate: "2026-11-02", eatenAt: "2026-11-02T12:00:00-03:00" });
    await engine.saveFeedback(logId, { rating: "disliked", comment: "Too salty", dislikedFoodIds: [] });
    await engine.syncNow();
    const ops = server.batches.flatMap((b) => b.operations);
    expect(ops.map((o) => o.type)).toEqual(["prefs.put", "log.create", "feedback.put"]);
    expect(ops[0]).toMatchObject({ entityId: me, baseVersion: null, body: { allergens: ["peanut"] } });
    expect(await engine.listPreferences()).toEqual([expect.objectContaining({ id: me, state: "synced", serverVersion: 1 })]);
    expect(await engine.listFeedback()).toEqual([expect.objectContaining({ id: logId, state: "synced" })]);
  });

  it("keeps a conflicting preferences edit until the person chooses", async () => {
    const me = crypto.randomUUID();
    const server = stubServer((op) =>
      op.type === "prefs.put" && op.baseVersion === null
        ? { status: "conflict", version: 3, serverPreferences: { id: me, ...prefs, allergens: ["milk"], profileId: null, version: 3, updatedAt: "" } }
        : { version: 4 },
    );
    const engine = await engineWith(server);
    await engine.savePreferences(me, prefs);
    await engine.syncNow();
    expect(engine.status).toBe("attention");
    expect((await engine.listPreferences())[0]).toMatchObject({ state: "conflict", body: { allergens: ["peanut"] } });
    await engine.resolveVersionedConflict("prefs", me, "mine");
    await engine.syncNow();
    expect(server.batches.at(-1)!.operations[0]).toMatchObject({ type: "prefs.put", baseVersion: 3, body: { allergens: ["peanut"] } });
    expect((await engine.listPreferences())[0]).toMatchObject({ state: "synced", serverVersion: 4 });
  });

  it("keeps a profile's meals apart from the account's own", async () => {
    const engine = await engineWith(stubServer());
    const kid = crypto.randomUUID();
    await engine.savePlan(crypto.randomUUID(), { date: "2026-11-02", slot: "lunch", recipeId: crypto.randomUUID(), title: "Mine", servings: 1 });
    await engine.savePlan(crypto.randomUUID(), { date: "2026-11-02", slot: "lunch", recipeId: crypto.randomUUID(), title: "Kid's", servings: 1, profileId: kid });
    expect((await engine.listPlans()).map((p) => p.body.title)).toEqual(["Mine"]);
    expect((await engine.listPlans(kid)).map((p) => p.body.title)).toEqual(["Kid's"]);
    expect(await engine.listAllPlans()).toHaveLength(2);
  });

  it("shows who planned a meal, and brings back a plan the group would not let go", async () => {
    const planId = crypto.randomUUID();
    const recipeId = crypto.randomUUID();
    const server = stubServer((op) => (op.type === "plan.delete" ? { status: "rejected", error: { code: "managed_by_group", message: "Planned by your group" } } : {}));
    server.push({
      entity: "planned_meal", entityId: planId, deleted: false, seq: "0", recipe: null,
      plannedMeal: { id: planId, date: "2026-11-02", slot: "dinner", recipeId, title: "Soup", servings: 1, profileId: null, version: 1, createdAt: "", updatedAt: "", status: "planned", groupId: crypto.randomUUID(), authorId: crypto.randomUUID(), plannedBy: "Dr. Lee" },
    } as SyncChange);
    const engine = await engineWith(server);
    await engine.syncNow();
    const [plan] = await engine.listPlans();
    expect(plan).toMatchObject({ body: { title: "Soup" }, meta: { status: "planned", plannedBy: "Dr. Lee" } });
    expect(plan!.body).not.toHaveProperty("status");
    await engine.deletePlan(planId);
    expect(await engine.listPlans()).toEqual([]);
    await engine.syncNow();
    expect(await engine.listPlans()).toEqual([expect.objectContaining({ id: planId, state: "rejected", deleted: false })]);
  });

  it("removes everything about a deleted profile from the device", async () => {
    const kid = crypto.randomUUID();
    const server = stubServer();
    const engine = await engineWith(server);
    server.push({ entity: "profile", entityId: kid, deleted: false, seq: "0", recipe: null, profile: { id: kid, name: "Lucy", version: 1, createdAt: "2026-10-20T00:00:00Z" } } as SyncChange);
    await engine.syncNow();
    expect(await engine.listProfiles()).toEqual([expect.objectContaining({ name: "Lucy" })]);
    await engine.savePlan(crypto.randomUUID(), { date: "2026-11-02", slot: "lunch", recipeId: crypto.randomUUID(), title: "Kid's", servings: 1, profileId: kid });
    const logId = await engine.logMeal({ plannedMealId: null, recipeId: null, recipe, servings: 1, slot: "lunch", localDate: "2026-11-02", eatenAt: "2026-11-02T12:00:00-03:00", profileId: kid });
    await engine.saveFeedback(logId, { rating: "liked", comment: "", dislikedFoodIds: [] });
    await engine.savePreferences(kid, { ...prefs, profileId: kid });
    await engine.syncNow();
    server.push({ entity: "profile", entityId: kid, deleted: true, seq: "0", recipe: null, profile: null } as SyncChange);
    await engine.syncNow();
    expect(await engine.listProfiles()).toEqual([]);
    expect(await engine.listAllPlans()).toEqual([]);
    expect(await engine.listAllLogs()).toEqual([]);
    expect(await engine.listFeedback()).toEqual([]);
    expect(await engine.listPreferences()).toEqual([]);
  });

  it("lets go of recipes from groups the account is no longer in", async () => {
    const [stay, gone] = [crypto.randomUUID(), crypto.randomUUID()];
    const server = stubServer();
    const r = (groupId: string | null, title: string) => {
      const id = crypto.randomUUID();
      return { entity: "recipe", entityId: id, deleted: false, seq: "0", recipe: { id, groupId, title, description: "", servings: 1, ingredients: [], method: "", image: null, version: 1, createdAt: "", updatedAt: "", nutrition: null } } as SyncChange;
    };
    server.push(r(stay, "Still in group"), r(gone, "Left group"), r(null, "Mine"));
    const engine = await engineWith(server);
    await engine.syncNow();
    expect((await engine.listRecipes()).map((x) => x.body.title).sort()).toEqual(["Left group", "Mine", "Still in group"]);
    await engine.forgetGroupRecipes(new Set([stay]));
    expect((await engine.listRecipes()).map((x) => x.body.title).sort()).toEqual(["Mine", "Still in group"]);
  });
});
