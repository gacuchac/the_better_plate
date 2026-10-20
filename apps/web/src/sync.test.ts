import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import type { Recipe, SyncBatchRequest, SyncBatchResponse, SyncChangesResponse, SyncResult } from "@betterplate/contracts";
import { NetworkError } from "./api.ts";
import { openUserDb } from "./localdb.ts";
import { SyncEngine } from "./sync.ts";

const body = (title: string) => ({ title, description: "", servings: 1, ingredients: [], method: "" });

/** In-memory stand-in for the API that follows protocol 1 semantics. */
function fakeServer() {
  const store = new Map<string, Recipe>();
  const logs = new Map<string, unknown>();
  const plans = new Map<string, { version: number; title: string }>();
  const seen = new Map<string, SyncResult>();
  const batches: SyncBatchRequest[] = [];
  let offline = false;
  let seq = 0;
  const log: { seq: number; id: string }[] = [];
  return {
    store,
    logs,
    plans,
    batches,
    setOffline: (v: boolean) => (offline = v),
    client: {
      async syncBatch(req: SyncBatchRequest): Promise<SyncBatchResponse> {
        if (offline) throw new NetworkError("offline");
        batches.push(structuredClone(req));
        const results = req.operations.map((op): SyncResult => {
          const prior = seen.get(op.opId);
          if (prior) return { ...prior, replayed: true };
          const ok = (version: number | null): SyncResult => ({ opId: op.opId, entityId: op.entityId, status: "applied", replayed: false, version });
          if (op.type === "log.create") {
            logs.set(op.entityId, op.body);
            seen.set(op.opId, ok(null));
            return ok(null);
          }
          if (op.type === "log.delete") {
            logs.delete(op.entityId);
            return ok(null);
          }
          if (op.type === "plan.put" || op.type === "plan.delete") {
            const cur = plans.get(op.entityId);
            if ((cur?.version ?? null) !== op.baseVersion) return { opId: op.opId, entityId: op.entityId, status: "conflict", replayed: false, version: cur?.version ?? null, serverPlannedMeal: null };
            if (op.type === "plan.delete") plans.delete(op.entityId);
            else plans.set(op.entityId, { version: (cur?.version ?? 0) + 1, title: op.body.title });
            return ok((cur?.version ?? 0) + 1);
          }
          const cur = store.get(op.entityId) ?? null;
          let r: SyncResult;
          if ((cur?.version ?? null) !== op.baseVersion) r = { opId: op.opId, entityId: op.entityId, status: "conflict", replayed: false, version: cur?.version ?? null, server: cur };
          else if (op.type === "recipe.delete") {
            store.delete(op.entityId);
            r = { opId: op.opId, entityId: op.entityId, status: "applied", replayed: false, version: (cur?.version ?? 0) + 1 };
          } else {
            if (op.type !== "recipe.put") throw new Error(`unexpected ${op.type}`);
            const version = (cur?.version ?? 0) + 1;
            store.set(op.entityId, { id: op.entityId, ...op.body, groupId: null, version, createdAt: "", updatedAt: "", nutrition: null });
            log.push({ seq: ++seq, id: op.entityId });
            r = { opId: op.opId, entityId: op.entityId, status: "applied", replayed: false, version };
          }
          seen.set(op.opId, r);
          return r;
        });
        return { protocol: 1, results };
      },
      async changes(cursor: string): Promise<SyncChangesResponse> {
        if (offline) throw new NetworkError("offline");
        const after = log.filter((l) => l.seq > Number(cursor));
        return {
          changes: after.map((l) => ({ entity: "recipe", entityId: l.id, seq: String(l.seq), deleted: !store.has(l.id), recipe: store.get(l.id) ?? null })),
          cursor: String(after.at(-1)?.seq ?? cursor),
          hasMore: false,
        };
      },
    },
  };
}

async function engineFor(server: ReturnType<typeof fakeServer>) {
  const db = await openUserDb(crypto.randomUUID());
  return new SyncEngine(db, server.client);
}

describe("SyncEngine", () => {
  it("saves offline, reports it honestly, and syncs on reconnect", async () => {
    const server = fakeServer();
    const engine = await engineFor(server);
    server.setOffline(true);
    const id = crypto.randomUUID();
    await engine.saveRecipe(id, body("Soup"));
    await engine.syncNow();
    expect(engine.status).toBe("offline");
    expect((await engine.getRecipe(id))!.state).toBe("pending");
    server.setOffline(false);
    await engine.syncNow();
    expect(engine.status).toBe("synced");
    expect((await engine.getRecipe(id))!).toMatchObject({ state: "synced", serverVersion: 1 });
    expect(server.store.get(id)!.title).toBe("Soup");
  });

  it("coalesces unsent edits into one operation", async () => {
    const server = fakeServer();
    const engine = await engineFor(server);
    const id = crypto.randomUUID();
    server.setOffline(true);
    await engine.saveRecipe(id, body("a"));
    await engine.saveRecipe(id, body("ab"));
    await engine.saveRecipe(id, body("abc"));
    expect(await engine.pendingCount()).toBe(1);
    server.setOffline(false);
    await engine.syncNow();
    expect(server.batches[0]!.operations).toHaveLength(1);
    expect(server.store.get(id)).toMatchObject({ title: "abc", version: 1 });
  });

  it("surfaces conflicts and resolves only by explicit choice", async () => {
    const server = fakeServer();
    const engine = await engineFor(server);
    const id = crypto.randomUUID();
    await engine.saveRecipe(id, body("Base"));
    await engine.syncNow();
    // Another device edits the recipe.
    server.store.set(id, { ...server.store.get(id)!, title: "Other device", version: 2 });
    await engine.saveRecipe(id, body("This device"));
    await engine.syncNow();
    const local = (await engine.getRecipe(id))!;
    expect(engine.status).toBe("attention");
    expect(local.state).toBe("conflict");
    expect(local.body.title).toBe("This device");
    expect(server.store.get(id)!.title).toBe("Other device");

    const copyId = await engine.resolveConflict(id, "both");
    await engine.syncNow();
    expect((await engine.getRecipe(id))!.body.title).toBe("Other device");
    expect(server.store.get(copyId!)!.title).toBe("This device (this device)");
    expect(engine.status).toBe("synced");
  });

  it("keep mine rebases on the server version", async () => {
    const server = fakeServer();
    const engine = await engineFor(server);
    const id = crypto.randomUUID();
    await engine.saveRecipe(id, body("Base"));
    await engine.syncNow();
    server.store.set(id, { ...server.store.get(id)!, title: "Remote", version: 2 });
    await engine.saveRecipe(id, body("Mine"));
    await engine.syncNow();
    await engine.resolveConflict(id, "mine");
    await engine.syncNow();
    expect(server.store.get(id)).toMatchObject({ title: "Mine", version: 3 });
  });

  it("pulls remote recipes but never overwrites pending local work", async () => {
    const server = fakeServer();
    const a = await engineFor(server);
    const b = await engineFor(server);
    const id = crypto.randomUUID();
    await a.saveRecipe(id, body("From A"));
    await a.syncNow();
    await b.syncNow();
    expect((await b.getRecipe(id))!.body.title).toBe("From A");
    server.setOffline(true);
    await b.saveRecipe(id, body("B offline edit"));
    server.setOffline(false);
    await a.saveRecipe(id, body("A edit"));
    await a.syncNow();
    await b.syncNow();
    expect((await b.getRecipe(id))!.state).toBe("conflict");
    expect((await b.getRecipe(id))!.body.title).toBe("B offline edit");
  });

  it("deletes with a tombstone op, and drops never-synced recipes locally", async () => {
    const server = fakeServer();
    const engine = await engineFor(server);
    const local = crypto.randomUUID();
    server.setOffline(true);
    await engine.saveRecipe(local, body("Draft"));
    await engine.deleteRecipe(local);
    expect(await engine.pendingCount()).toBe(0);
    server.setOffline(false);
    const id = crypto.randomUUID();
    await engine.saveRecipe(id, body("Keep"));
    await engine.syncNow();
    await engine.deleteRecipe(id);
    await engine.syncNow();
    expect(server.store.has(id)).toBe(false);
    expect(await engine.getRecipe(id)).toBeUndefined();
  });
});

describe("SyncEngine meals", () => {
  const meal = (title: string) => ({
    plannedMealId: null, recipeId: null, recipe: { title, servings: 1, ingredients: [] }, servings: 1,
    slot: "lunch" as const, localDate: "2026-10-19", eatenAt: "2026-10-19T12:00:00Z",
  });
  const plan = (title: string) => ({ date: "2026-10-20", slot: "dinner" as const, recipeId: crypto.randomUUID(), title, servings: 1 });

  it("never coalesces separate eaten meals, even the same recipe twice offline", async () => {
    const server = fakeServer();
    const engine = await engineFor(server);
    server.setOffline(true);
    await engine.logMeal(meal("Toast"));
    await engine.logMeal(meal("Toast"));
    expect(await engine.pendingCount()).toBe(2);
    expect((await engine.listLogs()).every((l) => l.state === "pending")).toBe(true);
    server.setOffline(false);
    await engine.syncNow();
    expect(server.logs.size).toBe(2);
    expect((await engine.listLogs()).every((l) => l.state === "synced")).toBe(true);
    expect(engine.status).toBe("synced");
  });

  it("drops an unsent log locally and retracts a synced one with a tombstone op", async () => {
    const server = fakeServer();
    const engine = await engineFor(server);
    server.setOffline(true);
    const draft = await engine.logMeal(meal("Oops"));
    await engine.deleteLog(draft);
    expect(await engine.pendingCount()).toBe(0);
    server.setOffline(false);
    const kept = await engine.logMeal(meal("Lunch"));
    await engine.syncNow();
    await engine.deleteLog(kept);
    expect(await engine.listLogs()).toEqual([]);
    await engine.syncNow();
    expect(server.logs.has(kept)).toBe(false);
    expect(server.batches.at(-1)!.operations[0]!.type).toBe("log.delete");
  });

  it("coalesces unsent plan edits and keeps plans apart from logs", async () => {
    const server = fakeServer();
    const engine = await engineFor(server);
    const id = crypto.randomUUID();
    server.setOffline(true);
    await engine.savePlan(id, plan("a"));
    await engine.savePlan(id, plan("ab"));
    expect(await engine.pendingCount()).toBe(1);
    server.setOffline(false);
    await engine.syncNow();
    expect(server.plans.get(id)).toMatchObject({ version: 1, title: "ab" });
    expect(await engine.listLogs()).toEqual([]);
  });

  it("surfaces a plan conflict and resolves only by explicit choice", async () => {
    const server = fakeServer();
    const engine = await engineFor(server);
    const id = crypto.randomUUID();
    await engine.savePlan(id, plan("Base"));
    await engine.syncNow();
    server.plans.set(id, { version: 2, title: "Elsewhere" });
    await engine.savePlan(id, plan("Here"));
    await engine.syncNow();
    expect(engine.status).toBe("attention");
    expect((await engine.listPlans())[0]!.state).toBe("conflict");
    await engine.resolvePlanConflict(id, "cloud");
    expect(await engine.listPlans()).toEqual([]);
  });
});
