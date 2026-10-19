import type { Recipe, RecipeBody, SyncResult } from "@betterplate/contracts";
import { MAX_SYNC_OPS } from "@betterplate/contracts";
import { ApiRequestError, NetworkError, api } from "./api.ts";
import type { LocalRecipe, OutboxOp, UserDatabase } from "./localdb.ts";

/**
 * Status words shown to people (PRODUCT.md §6): never claim "Synced" before the server
 * has acknowledged every queued change.
 */
export type SyncStatus = "saved-local" | "syncing" | "synced" | "attention" | "offline" | "signed-out";

type Api = Pick<typeof api, "syncBatch" | "changes">;

const uuid = () => crypto.randomUUID();
const now = () => new Date().toISOString();

export class SyncEngine {
  private inFlight = new Set<string>();
  private running: Promise<void> | null = null;
  private again = false;
  private debounce: ReturnType<typeof setTimeout> | null = null;
  private listeners = new Set<() => void>();
  status: SyncStatus = "saved-local";
  lastSyncedAt: string | null = null;

  constructor(
    readonly db: UserDatabase,
    private readonly client: Api = api,
  ) {}

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit() {
    for (const fn of this.listeners) fn();
  }

  private setStatus(status: SyncStatus) {
    this.status = status;
    this.emit();
  }

  // ---------- local writes (always succeed offline) ----------

  async listRecipes(): Promise<LocalRecipe[]> {
    const all = await this.db.getAllFromIndex("recipes", "byUpdated");
    return all.filter((r) => !r.deleted).reverse();
  }

  getRecipe(id: string) {
    return this.db.get("recipes", id);
  }

  async pendingCount(): Promise<number> {
    return this.db.count("outbox");
  }

  /** Saves locally and queues one coalesced operation for the recipe. */
  async saveRecipe(id: string, body: RecipeBody): Promise<LocalRecipe> {
    const tx = this.db.transaction(["recipes", "outbox"], "readwrite");
    const existing = await tx.objectStore("recipes").get(id);
    const ops = await tx.objectStore("outbox").index("byEntity").getAll(id);
    // Coalesce superseded edits that have not been sent yet.
    for (const op of ops) if (!this.inFlight.has(op.opId)) await tx.objectStore("outbox").delete(op.opId);
    const base = existing?.serverVersion ?? null;
    await tx.objectStore("outbox").put(this.op(id, "recipe.put", base, body));
    const record: LocalRecipe = {
      id,
      body,
      serverVersion: base,
      state: existing?.state === "conflict" ? "conflict" : "pending",
      conflictServer: existing?.state === "conflict" ? existing.conflictServer : undefined,
      updatedAt: now(),
    };
    await tx.objectStore("recipes").put(record);
    await tx.done;
    this.setStatus("saved-local");
    this.schedule();
    return record;
  }

  async deleteRecipe(id: string): Promise<void> {
    const tx = this.db.transaction(["recipes", "outbox"], "readwrite");
    const existing = await tx.objectStore("recipes").get(id);
    for (const op of await tx.objectStore("outbox").index("byEntity").getAll(id)) {
      if (!this.inFlight.has(op.opId)) await tx.objectStore("outbox").delete(op.opId);
    }
    if (!existing || existing.serverVersion === null) {
      await tx.objectStore("recipes").delete(id);
    } else {
      await tx.objectStore("outbox").put(this.op(id, "recipe.delete", existing.serverVersion));
      await tx.objectStore("recipes").put({ ...existing, deleted: true, state: "pending", updatedAt: now() });
    }
    await tx.done;
    this.setStatus("saved-local");
    this.schedule();
  }

  private seqCounter = Date.now() * 1000;
  private op(entityId: string, type: OutboxOp["type"], baseVersion: number | null, body?: RecipeBody): OutboxOp {
    return { opId: uuid(), entityId, type, baseVersion, body, createdAt: now(), seq: this.seqCounter++ };
  }

  // ---------- conflict resolution (explicit choice, never silent) ----------

  async resolveConflict(id: string, choice: "mine" | "cloud" | "both"): Promise<string | null> {
    const local = await this.db.get("recipes", id);
    if (!local || local.state !== "conflict") return null;
    const server = local.conflictServer ?? null;
    let copyId: string | null = null;

    if (choice === "mine") {
      if (server) {
        await this.db.put("recipes", { ...local, serverVersion: server.version, state: "pending", conflictServer: undefined });
        await this.saveRecipe(id, local.body);
      } else {
        // Deleted on the other device: keep mine as a new recipe.
        copyId = uuid();
        await this.db.delete("recipes", id);
        await this.saveRecipe(copyId, local.body);
      }
      return copyId;
    }

    if (choice === "both") {
      copyId = uuid();
      await this.saveRecipe(copyId, { ...local.body, title: `${local.body.title} (this device)`.slice(0, 120) });
    }
    // "cloud" (and the original side of "both"): take the server copy.
    const tx = this.db.transaction(["recipes", "outbox"], "readwrite");
    for (const op of await tx.objectStore("outbox").index("byEntity").getAll(id)) await tx.objectStore("outbox").delete(op.opId);
    if (server) await tx.objectStore("recipes").put(fromServer(server));
    else await tx.objectStore("recipes").delete(id);
    await tx.done;
    this.emit();
    this.schedule();
    return copyId;
  }

  // ---------- network ----------

  /** Debounced sync after meaningful changes. */
  schedule(delayMs = 1500) {
    if (this.debounce) clearTimeout(this.debounce);
    this.debounce = setTimeout(() => void this.syncNow(), delayMs);
  }

  /** Push queued operations, then pull remote changes. Safe to call repeatedly. */
  syncNow(): Promise<void> {
    if (this.running) {
      this.again = true;
      return this.running;
    }
    this.running = (async () => {
      do {
        this.again = false;
        await this.cycle();
      } while (this.again);
    })().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async cycle() {
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      this.setStatus((await this.pendingCount()) ? "offline" : this.status === "synced" ? "synced" : "offline");
      return;
    }
    this.setStatus("syncing");
    try {
      await this.push();
      await this.pull();
      const pending = await this.pendingCount();
      const attention = (await this.db.getAll("recipes")).some((r) => r.state === "conflict" || r.state === "rejected");
      this.lastSyncedAt = now();
      this.setStatus(attention ? "attention" : pending ? "saved-local" : "synced");
    } catch (err) {
      if (err instanceof ApiRequestError && err.status === 401) this.setStatus("signed-out");
      else if (err instanceof NetworkError) this.setStatus("offline");
      else this.setStatus("attention");
    }
  }

  private async push() {
    for (let guard = 0; guard < 50; guard++) {
      const ops = (await this.db.getAllFromIndex("outbox", "bySeq")).slice(0, MAX_SYNC_OPS);
      if (ops.length === 0) return;
      ops.forEach((o) => this.inFlight.add(o.opId));
      let results: SyncResult[];
      try {
        const res = await this.client.syncBatch({
          protocol: 1,
          operations: ops.map((o) =>
            o.type === "recipe.put"
              ? { opId: o.opId, type: o.type, entityId: o.entityId, baseVersion: o.baseVersion, body: o.body! }
              : { opId: o.opId, type: o.type, entityId: o.entityId, baseVersion: o.baseVersion },
          ),
        });
        results = res.results;
      } finally {
        ops.forEach((o) => this.inFlight.delete(o.opId));
      }
      let retry = false;
      for (const result of results) {
        if (result.status === "retry") retry = true;
        else await this.applyResult(result);
      }
      if (retry) return;
    }
  }

  private async applyResult(result: SyncResult) {
    const tx = this.db.transaction(["recipes", "outbox"], "readwrite");
    const outbox = tx.objectStore("outbox");
    const recipes = tx.objectStore("recipes");
    await outbox.delete(result.opId);
    const later = await outbox.index("byEntity").getAll(result.entityId);
    const local = await recipes.get(result.entityId);

    if (result.status === "applied") {
      // Later local edits were made on top of this content: rebase them on the new version.
      for (const op of later) await outbox.put({ ...op, baseVersion: result.version });
      if (local) {
        if (local.deleted && later.length === 0) await recipes.delete(local.id);
        else await recipes.put({ ...local, serverVersion: result.version, state: later.length ? "pending" : "synced" });
      }
    } else if (result.status === "conflict") {
      for (const op of later) await outbox.delete(op.opId);
      if (local) await recipes.put({ ...local, deleted: false, state: "conflict", conflictServer: result.server ?? null });
    } else if (result.status === "rejected") {
      for (const op of later) await outbox.delete(op.opId);
      if (local) await recipes.put({ ...local, state: "rejected", rejection: result.error?.message ?? "Rejected" });
    }
    await tx.done;
  }

  private async pull() {
    let cursor = ((await this.db.get("meta", "cursor")) as string | undefined) ?? "0";
    for (let guard = 0; guard < 100; guard++) {
      const page = await this.client.changes(cursor);
      const tx = this.db.transaction(["recipes", "meta"], "readwrite");
      for (const change of page.changes) {
        const local = await tx.objectStore("recipes").get(change.entityId);
        // Never overwrite unsynced local work; the push step surfaces any conflict.
        if (local && local.state !== "synced") continue;
        if (change.deleted || !change.recipe) await tx.objectStore("recipes").delete(change.entityId);
        else await tx.objectStore("recipes").put(fromServer(change.recipe));
      }
      cursor = page.cursor;
      await tx.objectStore("meta").put(cursor, "cursor");
      await tx.done;
      if (!page.hasMore) break;
    }
    this.emit();
  }

  /** Unsynced work as a downloadable JSON document (for export before sign-out). */
  async exportUnsynced() {
    const recipes = (await this.db.getAll("recipes")).filter((r) => r.state !== "synced");
    return { exportedAt: now(), format: "betterplate.unsynced/1", recipes };
  }
}

export function fromServer(r: Recipe): LocalRecipe {
  return {
    id: r.id,
    body: { title: r.title, servings: r.servings, ingredients: r.ingredients, method: r.method },
    serverVersion: r.version,
    state: "synced",
    updatedAt: r.updatedAt,
  };
}
