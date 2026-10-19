import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import type { Recipe, SyncBatchRequest, SyncBatchResponse, SyncChangesResponse, SyncResult } from "@betterplate/contracts";
import { NetworkError } from "./api.ts";
import { openUserDb } from "./localdb.ts";
import { SyncEngine } from "./sync.ts";

const body = (title: string) => ({ title, servings: 1, ingredients: [], method: "" });

/** In-memory stand-in for the API that follows protocol 1 semantics. */
function fakeServer() {
  const store = new Map<string, Recipe>();
  const seen = new Map<string, SyncResult>();
  const batches: SyncBatchRequest[] = [];
  let offline = false;
  let seq = 0;
  const log: { seq: number; id: string }[] = [];
  return {
    store,
    batches,
    setOffline: (v: boolean) => (offline = v),
    client: {
      async syncBatch(req: SyncBatchRequest): Promise<SyncBatchResponse> {
        if (offline) throw new NetworkError("offline");
        batches.push(structuredClone(req));
        const results = req.operations.map((op): SyncResult => {
          const prior = seen.get(op.opId);
          if (prior) return { ...prior, replayed: true };
          const cur = store.get(op.entityId) ?? null;
          let r: SyncResult;
          if ((cur?.version ?? null) !== op.baseVersion) r = { opId: op.opId, entityId: op.entityId, status: "conflict", replayed: false, version: cur?.version ?? null, server: cur };
          else if (op.type === "recipe.delete") {
            store.delete(op.entityId);
            r = { opId: op.opId, entityId: op.entityId, status: "applied", replayed: false, version: (cur?.version ?? 0) + 1 };
          } else {
            const version = (cur?.version ?? 0) + 1;
            store.set(op.entityId, { id: op.entityId, ...op.body, version, createdAt: "", updatedAt: "", nutrition: null });
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
