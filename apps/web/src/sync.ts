import type { MealLog, MealLogBody, PlannedMeal, PlannedMealBody, Recipe, RecipeBody, SyncOperation, SyncResult } from "@betterplate/contracts";
import { MAX_SYNC_OPS } from "@betterplate/contracts";
import { track } from "./activity.ts";
import { ApiRequestError, NetworkError, api } from "./api.ts";
import type { LocalLog, LocalPlan, LocalRecipe, OutboxOp, UserDatabase } from "./localdb.ts";

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
    track("Saved a recipe on this device");
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
  private op(entityId: string, type: OutboxOp["type"], baseVersion: number | null, body?: OutboxOp["body"]): OutboxOp {
    return { opId: uuid(), entityId, type, baseVersion, body, createdAt: now(), seq: this.seqCounter++ };
  }

  // ---------- meals: plans (editable) and eaten logs (create-only) ----------

  async listPlans(): Promise<LocalPlan[]> {
    return (await this.db.getAll("plans")).filter((p) => !p.deleted);
  }

  async listLogs(): Promise<LocalLog[]> {
    return (await this.db.getAll("logs")).filter((l) => !l.deleted);
  }

  /** Saves a plan locally and queues one coalesced operation for it. */
  async savePlan(id: string, body: PlannedMealBody): Promise<void> {
    const tx = this.db.transaction(["plans", "outbox"], "readwrite");
    const existing = await tx.objectStore("plans").get(id);
    for (const op of await tx.objectStore("outbox").index("byEntity").getAll(id)) {
      if (!this.inFlight.has(op.opId)) await tx.objectStore("outbox").delete(op.opId);
    }
    const base = existing?.serverVersion ?? null;
    await tx.objectStore("outbox").put(this.op(id, "plan.put", base, body));
    await tx.objectStore("plans").put({
      id,
      body,
      serverVersion: base,
      state: existing?.state === "conflict" ? "conflict" : "pending",
      conflictServer: existing?.state === "conflict" ? existing.conflictServer : undefined,
      updatedAt: now(),
    });
    await tx.done;
    this.changed();
  }

  async deletePlan(id: string): Promise<void> {
    const tx = this.db.transaction(["plans", "outbox"], "readwrite");
    const existing = await tx.objectStore("plans").get(id);
    for (const op of await tx.objectStore("outbox").index("byEntity").getAll(id)) {
      if (!this.inFlight.has(op.opId)) await tx.objectStore("outbox").delete(op.opId);
    }
    if (!existing || existing.serverVersion === null) await tx.objectStore("plans").delete(id);
    else {
      await tx.objectStore("outbox").put(this.op(id, "plan.delete", existing.serverVersion));
      await tx.objectStore("plans").put({ ...existing, deleted: true, state: "pending", updatedAt: now() });
    }
    await tx.done;
    track("Removed a planned meal");
    this.changed();
  }

  /** Records food eaten. Every call is a separate event; logs are never coalesced. */
  async logMeal(body: MealLogBody): Promise<string> {
    const id = uuid();
    const tx = this.db.transaction(["logs", "outbox"], "readwrite");
    await tx.objectStore("outbox").put(this.op(id, "log.create", null, body));
    await tx.objectStore("logs").put({ id, body, state: "pending", createdAt: now() });
    await tx.done;
    track("Marked a meal as eaten");
    this.changed();
    return id;
  }

  /** Retracts a log ("I didn't eat this"). An unsent log is simply dropped. */
  async deleteLog(id: string): Promise<void> {
    track("Removed a meal from eaten");
    const tx = this.db.transaction(["logs", "outbox"], "readwrite");
    const existing = await tx.objectStore("logs").get(id);
    const ops = await tx.objectStore("outbox").index("byEntity").getAll(id);
    const unsentCreate = ops.find((o) => o.type === "log.create" && !this.inFlight.has(o.opId));
    if (unsentCreate) {
      await tx.objectStore("outbox").delete(unsentCreate.opId);
      await tx.objectStore("logs").delete(id);
    } else if (existing) {
      await tx.objectStore("outbox").put(this.op(id, "log.delete", null));
      await tx.objectStore("logs").put({ ...existing, deleted: true, state: "pending" });
    }
    await tx.done;
    this.changed();
  }

  async resolvePlanConflict(id: string, choice: "mine" | "cloud"): Promise<void> {
    const local = await this.db.get("plans", id);
    if (!local || local.state !== "conflict") return;
    const server = local.conflictServer ?? null;
    if (choice === "mine") {
      if (server) {
        await this.db.put("plans", { ...local, serverVersion: server.version, state: "pending", conflictServer: undefined });
        await this.savePlan(id, local.body);
      } else {
        await this.db.delete("plans", id);
        await this.savePlan(uuid(), local.body);
      }
      return;
    }
    const tx = this.db.transaction(["plans", "outbox"], "readwrite");
    for (const op of await tx.objectStore("outbox").index("byEntity").getAll(id)) await tx.objectStore("outbox").delete(op.opId);
    if (server) await tx.objectStore("plans").put(planFromServer(server));
    else await tx.objectStore("plans").delete(id);
    await tx.done;
    this.emit();
    this.schedule();
  }

  private changed() {
    this.setStatus("saved-local");
    this.schedule();
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

  /**
   * Picks up changes made elsewhere (a connected Claude or ChatGPT) without flashing the status
   * chip. Pending local work goes through a normal sync instead.
   */
  async pullQuietly() {
    if (this.running || this.status === "signed-out") return;
    if (typeof navigator !== "undefined" && navigator.onLine === false) return;
    if (await this.pendingCount()) return void this.syncNow();
    try {
      await this.pull(false);
    } catch {
      // The next regular sync reports any problem.
    }
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
      const needs = (s: string) => s === "conflict" || s === "rejected";
      const attention =
        (await this.db.getAll("recipes")).some((r) => needs(r.state)) ||
        (await this.db.getAll("plans")).some((p) => needs(p.state)) ||
        (await this.db.getAll("logs")).some((l) => needs(l.state));
      this.lastSyncedAt = now();
      this.setStatus(attention ? "attention" : pending ? "saved-local" : "synced");
    } catch (err) {
      track(err instanceof NetworkError ? "Sync paused: no connection" : "Sync failed");
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
          operations: ops.map(toWire),
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
    const tx = this.db.transaction(["recipes", "plans", "logs", "outbox"], "readwrite");
    const outbox = tx.objectStore("outbox");
    const sent = await outbox.get(result.opId);
    await outbox.delete(result.opId);
    const later = await outbox.index("byEntity").getAll(result.entityId);
    const kind = sent?.type.split(".")[0] ?? "recipe";

    if (kind === "log") {
      const logs = tx.objectStore("logs");
      const local = await logs.get(result.entityId);
      if (local) {
        if (result.status === "applied") {
          if (local.deleted && later.length === 0) await logs.delete(local.id);
          else if (!local.deleted) await logs.put({ ...local, state: "synced" });
        } else if (result.status === "rejected") {
          await logs.put({ ...local, deleted: false, state: "rejected", rejection: result.error?.message ?? "Rejected" });
        }
      }
      await tx.done;
      return;
    }

    // Recipes and plans share versioned semantics.
    const store = kind === "plan" ? tx.objectStore("plans") : tx.objectStore("recipes");
    const local = (await store.get(result.entityId)) as LocalRecipe | LocalPlan | undefined;
    if (result.status === "applied") {
      // Later local edits were made on top of this content: rebase them on the new version.
      for (const op of later) await outbox.put({ ...op, baseVersion: result.version });
      if (local) {
        if (local.deleted && later.length === 0) await store.delete(local.id);
        else await store.put({ ...local, serverVersion: result.version, state: later.length ? "pending" : "synced" } as never);
      }
    } else if (result.status === "conflict") {
      for (const op of later) await outbox.delete(op.opId);
      const server = kind === "plan" ? (result.serverPlannedMeal ?? null) : (result.server ?? null);
      if (local) await store.put({ ...local, deleted: false, state: "conflict", conflictServer: server } as never);
    } else if (result.status === "rejected") {
      for (const op of later) await outbox.delete(op.opId);
      if (local) await store.put({ ...local, state: "rejected", rejection: result.error?.message ?? "Rejected" } as never);
    }
    await tx.done;
  }

  private async pull(emitAlways = true) {
    let changed = false;
    let cursor = ((await this.db.get("meta", "cursor")) as string | undefined) ?? "0";
    for (let guard = 0; guard < 100; guard++) {
      const page = await this.client.changes(cursor);
      const tx = this.db.transaction(["recipes", "plans", "logs", "meta"], "readwrite");
      if (page.changes.length) changed = true;
      for (const change of page.changes) {
        if (change.entity === "recipe") {
          const local = await tx.objectStore("recipes").get(change.entityId);
          // Never overwrite unsynced local work; the push step surfaces any conflict.
          if (local && local.state !== "synced") continue;
          if (change.deleted || !change.recipe) await tx.objectStore("recipes").delete(change.entityId);
          else await tx.objectStore("recipes").put(fromServer(change.recipe));
        } else if (change.entity === "planned_meal") {
          const local = await tx.objectStore("plans").get(change.entityId);
          if (local && local.state !== "synced") continue;
          if (change.deleted || !change.plannedMeal) await tx.objectStore("plans").delete(change.entityId);
          else await tx.objectStore("plans").put(planFromServer(change.plannedMeal));
        } else {
          const local = await tx.objectStore("logs").get(change.entityId);
          if (local && local.state !== "synced") continue;
          if (change.deleted || !change.mealLog) await tx.objectStore("logs").delete(change.entityId);
          else await tx.objectStore("logs").put(logFromServer(change.mealLog));
        }
      }
      cursor = page.cursor;
      await tx.objectStore("meta").put(cursor, "cursor");
      await tx.done;
      if (!page.hasMore) break;
    }
    if (emitAlways || changed) this.emit();
  }

  /** Unsynced work as a downloadable JSON document (for export before sign-out). */
  async exportUnsynced() {
    const recipes = (await this.db.getAll("recipes")).filter((r) => r.state !== "synced");
    const plannedMeals = (await this.db.getAll("plans")).filter((p) => p.state !== "synced");
    const eatenMeals = (await this.db.getAll("logs")).filter((l) => l.state !== "synced");
    return { exportedAt: now(), format: "betterplate.unsynced/2", recipes, plannedMeals, eatenMeals };
  }
}

export function fromServer(r: Recipe): LocalRecipe {
  return {
    id: r.id,
    body: { title: r.title, description: r.description ?? "", servings: r.servings, ingredients: r.ingredients, method: r.method, image: r.image ?? null },
    serverVersion: r.version,
    state: "synced",
    updatedAt: r.updatedAt,
  };
}

export function planFromServer(p: PlannedMeal): LocalPlan {
  const { id, version, createdAt: _c, updatedAt, ...body } = p;
  return { id, body, serverVersion: version, state: "synced", updatedAt };
}

export function logFromServer(l: MealLog): LocalLog {
  const { id, createdAt, nutrition, eaten: _e, ...body } = l;
  return { id, body, nutrition, state: "synced", createdAt };
}

/** Outbox record → wire operation (protocol 1). */
function toWire(o: OutboxOp): SyncOperation {
  switch (o.type) {
    case "recipe.put":
      return { opId: o.opId, type: o.type, entityId: o.entityId, baseVersion: o.baseVersion, body: o.body as RecipeBody };
    case "plan.put":
      return { opId: o.opId, type: o.type, entityId: o.entityId, baseVersion: o.baseVersion, body: o.body as PlannedMealBody };
    case "recipe.delete":
    case "plan.delete":
      return { opId: o.opId, type: o.type, entityId: o.entityId, baseVersion: o.baseVersion };
    case "log.create":
      return { opId: o.opId, type: o.type, entityId: o.entityId, body: o.body as MealLogBody };
    case "log.delete":
      return { opId: o.opId, type: o.type, entityId: o.entityId };
  }
}
