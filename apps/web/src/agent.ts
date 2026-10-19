import { AI_TOOLS, RecipeBodySchema, type AiTurnProvider, type AiToolCall, type AiToolInput, type AiToolName, type AiTurnRequest, type RecipeBody } from "@betterplate/contracts";
import { calculateRecipe, type FoodRecord, type NutrientDefinition } from "@betterplate/nutrition";
import { api, ApiRequestError, NetworkError } from "./api.ts";
import type { RecipeImage } from "@betterplate/contracts";
import { track } from "./activity.ts";
import { getLang, nutrientName, t } from "./i18n.ts";
import { eatenAtFor, localDate, summarizeDay } from "./meals.ts";
import type { SyncEngine } from "./sync.ts";
import { getTargets, saveTargets } from "./targets.ts";
import { searchFoods } from "./ui/FoodPicker.tsx";

/**
 * The AI companion's loop on the device. The server talks to the model with the person's key;
 * every tool call it returns runs here, against the same local stores the screens use, so the
 * person sees each step happen. Reversible steps get an Undo; deleting waits for a tap.
 */

export type StepStatus = "running" | "done" | "failed" | "waiting" | "declined" | "undone";

export interface AgentStep {
  id: string;
  tool: AiToolName | string;
  label: string;
  status: StepStatus;
  detail?: string;
  canUndo: boolean;
}

export type ChatItem =
  | { kind: "user"; id: string; text: string }
  | { kind: "assistant"; id: string; text: string }
  | { kind: "step"; id: string; step: AgentStep }
  | { kind: "notice"; id: string; text: string };

export interface ToolEnv {
  engine: SyncEngine;
  foods: Map<string, FoodRecord>;
  nutrients: NutrientDefinition[];
  accountId: string;
  navigate: (path: string) => void;
}

interface ToolOutcome {
  output: unknown;
  detail?: string;
  undo?: () => Promise<void>;
}

const MAX_STEPS = 24;
const round = (n: number | null) => (n === null ? null : Math.round(n * 10) / 10);
const uid = () => crypto.randomUUID();

function nutritionRows(body: Pick<RecipeBody, "title" | "servings" | "ingredients">, env: ToolEnv) {
  const n = calculateRecipe(body, env.foods, env.nutrients);
  return {
    nutrition: n,
    perServing: n.perServing.map((r) => ({ key: r.key, name: env.nutrients.find((d) => d.key === r.key)?.name ?? r.key, amount: round(r.amount), unit: r.unit, status: r.status })),
  };
}

async function recipeOrThrow(env: ToolEnv, recipeId: string) {
  const r = await env.engine.getRecipe(recipeId);
  if (!r || r.deleted) throw new Error(`No recipe with id ${recipeId}`);
  return r;
}

type Impl<N extends AiToolName> = (input: AiToolInput<N>, env: ToolEnv) => Promise<ToolOutcome>;

const TOOLS: { [N in AiToolName]: Impl<N> } = {
  async navigate({ screen, recipeId, date }, env) {
    const path = screen === "recipe" || screen === "cook" ? (recipeId ? `/${screen}/${recipeId}` : null) : screen === "meals" ? (date ? `/meals/${date}` : "/meals") : `/${screen}`;
    if (!path) throw new Error(`${screen} needs a recipeId`);
    env.navigate(path);
    return { output: { opened: path } };
  },

  async search_foods({ query }, env) {
    const foods = searchFoods(env.foods, query, 8).map((f) => ({ id: f.id, description: f.description, category: f.category }));
    return { output: { foods, note: foods.length ? undefined : "No match on this device; try other USDA words (e.g. 'chicken, breast, raw')." }, detail: t("agent.found", { n: foods.length }) };
  },

  async get_food({ foodId }, env) {
    const f = env.foods.get(foodId);
    if (!f) throw new Error(`No food ${foodId} on this device`);
    const units = new Map(env.nutrients.map((d) => [d.key, d.unit]));
    return {
      output: {
        id: f.id,
        description: f.description,
        per100g: Object.fromEntries(Object.entries(f.nutrientsPer100g).map(([k, v]) => [k, `${v} ${units.get(k) ?? ""}`.trim()])),
        portions: f.portions.slice(0, 8).map((p) => ({ label: p.label, grams: p.gramWeight })),
        source: `${f.source.dataset}, FDC ${f.id.replace("fdc:", "")}`,
      },
    };
  },

  async list_recipes(_input, env) {
    const recipes = (await env.engine.listRecipes()).slice(0, 100).map((r) => ({ id: r.id, title: r.body.title, servings: r.body.servings }));
    return { output: { recipes }, detail: t("agent.found", { n: recipes.length }) };
  },

  async get_recipe({ recipeId }, env) {
    const r = await recipeOrThrow(env, recipeId);
    const { nutrition, perServing } = nutritionRows(r.body, env);
    return {
      output: {
        recipeId,
        title: r.body.title,
        servings: r.body.servings,
        method: r.body.method,
        ingredients: r.body.ingredients.map((i) => {
          const b = nutrition.ingredients.find((x) => x.ingredientId === i.id);
          return { foodId: i.foodId, name: env.foods.get(i.foodId)?.description ?? i.foodId, grams: round(b?.grams ?? null), role: i.role, oilDiscardedGrams: i.oilDiscardedGrams ?? null };
        }),
        estimatedPerServing: perServing,
        disclosures: nutrition.disclosures.map((d) => d.code),
      },
    };
  },

  async save_recipe(input, env) {
    const id = input.recipeId ?? uid();
    const previous = input.recipeId ? await recipeOrThrow(env, input.recipeId) : null;
    for (const i of input.ingredients) if (!env.foods.has(i.foodId)) throw new Error(`Unknown foodId ${i.foodId}; use search_foods`);
    const body = RecipeBodySchema.parse({
      title: input.title,
      servings: input.servings,
      method: input.method,
      // Replacing a recipe keeps its photo.
      image: previous?.body.image ?? null,
      ingredients: input.ingredients.map((i) => ({
        id: uid(),
        foodId: i.foodId,
        quantity: i.grams,
        unit: "g",
        portionIndex: null,
        role: i.role,
        oilDiscardedGrams: i.role === "cooking_oil" ? (i.oilDiscardedGrams ?? null) : null,
      })),
    });
    await env.engine.saveRecipe(id, body);
    track(previous ? "Companion updated a recipe" : "Companion created a recipe");
    const macros = nutritionRows(body, env).perServing.filter((r) => ["energy_kcal", "protein", "carbohydrate", "fat_total"].includes(r.key));
    return {
      output: { recipeId: id, saved: true, estimatedPerServing: macros },
      detail: body.title,
      undo: async () => {
        if (previous) await env.engine.saveRecipe(id, previous.body);
        else await env.engine.deleteRecipe(id);
      },
    };
  },

  async plan_meal({ recipeId, date, slot, servings }, env) {
    const r = await recipeOrThrow(env, recipeId);
    const id = uid();
    await env.engine.savePlan(id, { date, slot, recipeId, title: r.body.title, servings });
    track("Companion planned a meal");
    return { output: { planId: id, planned: true }, detail: r.body.title, undo: () => env.engine.deletePlan(id) };
  },

  async log_meal({ recipeId, date, slot, servings }, env) {
    if (date > localDate()) throw new Error("Can't log a meal on a future day; use plan_meal");
    const r = await recipeOrThrow(env, recipeId);
    // Fulfils an open plan for the same recipe and meal that day, if there is one.
    const logs = await env.engine.listLogs();
    const fulfilled = new Set(logs.map((l) => l.body.plannedMealId));
    const plan = (await env.engine.listPlans()).find((p) => !p.deleted && p.body.date === date && p.body.recipeId === recipeId && p.body.slot === slot && !fulfilled.has(p.id));
    const logId = await env.engine.logMeal({
      plannedMealId: plan?.id ?? null,
      recipeId,
      recipe: { title: r.body.title, servings: r.body.servings, ingredients: r.body.ingredients },
      servings,
      slot,
      localDate: date,
      eatenAt: eatenAtFor(date),
    });
    track("Companion marked a meal as eaten");
    return { output: { logId, loggedAsEaten: true }, detail: r.body.title, undo: () => env.engine.deleteLog(logId) };
  },

  async get_day({ date }, env) {
    const [logs, plans] = await Promise.all([env.engine.listLogs(), env.engine.listPlans()]);
    const day = summarizeDay(date, logs.filter((l) => !l.deleted), plans.filter((p) => !p.deleted), env.foods, env.nutrients);
    return {
      output: {
        date,
        planned: day.plans.map((p) => ({ planId: p.id, title: p.body.title, slot: p.body.slot, servings: p.body.servings })),
        eaten: day.logs.map((l) => ({ logId: l.id, title: l.body.recipe.title, slot: l.body.slot, servings: l.body.servings })),
        estimatedEatenTotals: day.totals?.map((r) => ({ key: r.key, amount: round(r.amount), unit: r.unit, status: r.status })) ?? null,
        note: "Totals count only meals marked as eaten; plans are not included.",
      },
    };
  },

  async set_targets({ targets }, env) {
    const previous = getTargets(env.accountId);
    const merged = new Map(previous.map((p) => [p.key, p]));
    for (const target of targets) {
      const def = env.nutrients.find((d) => d.key === target.key);
      if (!def) throw new Error(`Unknown nutrient key ${target.key}. Keys: ${env.nutrients.map((d) => d.key).join(", ")}`);
      merged.set(def.key, { key: def.key, unit: def.unit, amount: target.amount });
    }
    saveTargets(env.accountId, [...merged.values()]);
    return {
      output: { saved: [...merged.values()] },
      detail: targets.map((x) => nutrientName(x.key, x.key)).join(", "),
      undo: async () => saveTargets(env.accountId, previous),
    };
  },

  async find_photos({ description }) {
    const { results } = await api.searchPhotos(description);
    return {
      output: { photos: results.map((r) => ({ sourceId: r.sourceId, title: r.title, license: r.license, creator: r.creator })), note: results.length ? undefined : "Nothing found; try simpler words." },
      detail: t("agent.found", { n: results.length }),
    };
  },

  async set_recipe_photo({ recipeId, sourceId }, env) {
    const r = await recipeOrThrow(env, recipeId);
    return setImage(env, r.body, recipeId, await api.importPhoto(sourceId, r.body.title));
  },

  async generate_recipe_photo({ recipeId, prompt }, env) {
    const r = await recipeOrThrow(env, recipeId);
    return setImage(env, r.body, recipeId, await api.generateImage(prompt, r.body.title));
  },

  async delete_recipe({ recipeId }, env) {
    const r = await recipeOrThrow(env, recipeId);
    await env.engine.deleteRecipe(recipeId);
    track("Companion deleted a recipe");
    return { output: { deleted: true }, detail: r.body.title };
  },

  async remove_eaten_meal({ logId }, env) {
    const log = (await env.engine.listLogs()).find((l) => l.id === logId && !l.deleted);
    if (!log) throw new Error(`No eaten meal ${logId}`);
    await env.engine.deleteLog(logId);
    return { output: { removed: true }, detail: log.body.recipe.title };
  },
};

async function setImage(env: ToolEnv, body: RecipeBody, recipeId: string, image: RecipeImage): Promise<ToolOutcome> {
  await env.engine.saveRecipe(recipeId, { ...body, image });
  track(image.kind === "generated" ? "Companion generated a recipe image" : "Companion chose a recipe photo");
  return {
    output: { saved: true, kind: image.kind, credit: image.credit ? { title: image.credit.title, creator: image.credit.creator, license: image.credit.license } : null },
    detail: image.credit?.title ?? body.title,
    undo: async () => {
      const now = await env.engine.getRecipe(recipeId);
      if (now && !now.deleted) await env.engine.saveRecipe(recipeId, { ...now.body, image: body.image ?? null });
    },
  };
}

function stepLabel(name: string, input: Record<string, unknown>): string {
  switch (name) {
    case "navigate":
      return t("agent.step.navigate");
    case "search_foods":
      return t("agent.step.search", { query: String(input.query ?? "") });
    case "get_food":
      return t("agent.step.food");
    case "list_recipes":
      return t("agent.step.recipes");
    case "get_recipe":
      return t("agent.step.recipe");
    case "save_recipe":
      return t(input.recipeId ? "agent.step.update" : "agent.step.create");
    case "plan_meal":
      return t("agent.step.plan");
    case "log_meal":
      return t("agent.step.log");
    case "get_day":
      return t("agent.step.day");
    case "set_targets":
      return t("agent.step.targets");
    case "delete_recipe":
      return t("agent.step.delete");
    case "remove_eaten_meal":
      return t("agent.step.removeLog");
    case "find_photos":
      return t("agent.step.findPhotos", { query: String(input.description ?? "") });
    case "set_recipe_photo":
      return t("agent.step.setPhoto");
    case "generate_recipe_photo":
      return t("agent.step.generatePhoto");
    default:
      return t("agent.step.unknown");
  }
}

async function confirmDetail(name: string, input: Record<string, string>, env: ToolEnv): Promise<string | undefined> {
  if (name === "delete_recipe") return (await env.engine.getRecipe(input.recipeId!))?.body.title;
  if (name === "remove_eaten_meal") {
    const log = (await env.engine.listLogs()).find((l) => l.id === input.logId);
    return log ? `${log.body.recipe.title}, ${log.body.localDate}` : undefined;
  }
  return undefined;
}

export class AgentSession {
  items: ChatItem[] = [];
  running = false;
  private conversation: Record<string, unknown>[] = [];
  private undos = new Map<string, () => Promise<void>>();
  private confirms = new Map<string, (ok: boolean) => void>();
  private undone: string[] = [];
  private stopRequested = false;
  private listeners = new Set<() => void>();
  private snapshot: { items: ChatItem[]; running: boolean } = { items: [], running: false };

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  };
  getSnapshot = () => this.snapshot;

  private emit() {
    this.snapshot = { items: [...this.items], running: this.running };
    this.listeners.forEach((fn) => fn());
  }

  private push(item: ChatItem) {
    this.items.push(item);
    this.emit();
  }

  private updateStep(id: string, patch: Partial<AgentStep>) {
    this.items = this.items.map((it) => (it.kind === "step" && it.step.id === id ? { ...it, step: { ...it.step, ...patch } } : it));
    this.emit();
  }

  reset() {
    this.stop();
    this.items = [];
    this.conversation = [];
    this.undos.clear();
    this.undone = [];
    this.emit();
  }

  stop() {
    this.stopRequested = true;
    for (const resolve of this.confirms.values()) resolve(false);
  }

  confirm(stepId: string, ok: boolean) {
    this.confirms.get(stepId)?.(ok);
  }

  async undo(stepId: string) {
    const undo = this.undos.get(stepId);
    if (!undo) return;
    this.undos.delete(stepId);
    await undo();
    const step = this.items.find((i): i is Extract<ChatItem, { kind: "step" }> => i.kind === "step" && i.step.id === stepId)?.step;
    if (step) this.undone.push(`${step.label}${step.detail ? `: ${step.detail}` : ""}`);
    this.updateStep(stepId, { status: "undone", canUndo: false });
    track("Undid a companion step");
  }

  async send(text: string, provider: AiTurnProvider, env: ToolEnv) {
    if (this.running) return;
    this.running = true;
    this.stopRequested = false;
    this.push({ kind: "user", id: uid(), text });
    let input: AiTurnRequest["input"] = {
      type: "message",
      text,
      context: { route: window.location.hash.slice(1) || "/kitchen", today: localDate(), language: getLang(), undone: this.undone.splice(0, 20) },
    };
    try {
      for (let step = 0; ; step++) {
        const res = await api.aiTurn({ provider, conversation: this.conversation, input });
        if (res.text) this.push({ kind: "assistant", id: uid(), text: res.text });
        if (res.done) {
          this.conversation = res.conversation;
          break;
        }
        if (this.stopRequested || step >= MAX_STEPS) {
          // Unanswered tool calls can't stay in the transcript: drop that last reply.
          this.conversation = res.conversation.slice(0, -1);
          this.push({ kind: "notice", id: uid(), text: t(this.stopRequested ? "agent.stopped" : "agent.tooManySteps") });
          break;
        }
        this.conversation = res.conversation;
        const results = [];
        for (const call of res.toolCalls) results.push(await this.runTool(call, env, provider === "house"));
        input = { type: "tool_results", results };
      }
    } catch (err) {
      const message = err instanceof ApiRequestError ? err.message : err instanceof NetworkError ? t("agent.offline") : t("agent.failed");
      this.push({ kind: "notice", id: uid(), text: message });
      // The step that failed never reached the transcript; it stays consistent for the next message.
    } finally {
      this.running = false;
      this.emit();
    }
  }

  private async runTool(call: AiToolCall, env: ToolEnv, openResult = false): Promise<{ id: string; output: string; isError: boolean }> {
    const input = (call.input ?? {}) as Record<string, unknown>;
    const step: AgentStep = { id: uid(), tool: call.name, label: stepLabel(call.name, input), status: "running", canUndo: false };
    this.push({ kind: "step", id: step.id, step });
    const fail = (message: string) => {
      this.updateStep(step.id, { status: "failed", detail: message.slice(0, 160) });
      return { id: call.id, output: message, isError: true };
    };
    const tool = AI_TOOLS[call.name as AiToolName];
    if (call.error || !tool) return fail(call.error ?? `Unknown tool ${call.name}`);
    // Checked on the server too; the device never runs arguments it hasn't validated itself.
    const parsed = tool.input.safeParse(input);
    if (!parsed.success) return fail(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));

    if (tool.confirm) {
      // Name what would be deleted, so the tap is an informed one.
      this.updateStep(step.id, { status: "waiting", detail: await confirmDetail(call.name, parsed.data as Record<string, string>, env) });
      const ok = await new Promise<boolean>((resolve) => this.confirms.set(step.id, resolve));
      this.confirms.delete(step.id);
      if (!ok) {
        this.updateStep(step.id, { status: "declined" });
        return { id: call.id, output: JSON.stringify({ declined: true, note: "The person chose not to do this." }), isError: false };
      }
      this.updateStep(step.id, { status: "running" });
    }

    try {
      const impl = TOOLS[call.name as AiToolName] as Impl<AiToolName>;
      const outcome = await impl(parsed.data as never, env);
      if (outcome.undo) this.undos.set(step.id, outcome.undo);
      this.updateStep(step.id, { status: "done", detail: outcome.detail, canUndo: !!outcome.undo });
      // The included companion has no navigate tool, so the app opens what it changed.
      if (openResult) {
        const date = (parsed.data as { date?: string }).date;
        if (call.name === "save_recipe") env.navigate(`/recipe/${(outcome.output as { recipeId: string }).recipeId}`);
        else if ((call.name === "plan_meal" || call.name === "log_meal") && date) env.navigate(`/meals/${date}`);
      }
      return { id: call.id, output: JSON.stringify(outcome.output).slice(0, 20_000), isError: false };
    } catch (err) {
      return fail((err as Error).message || "That didn't work");
    }
  }
}

/** One conversation per signed-in account, kept in memory only (never stored on the device). */
let current: { accountId: string; session: AgentSession } | null = null;
export function sessionFor(accountId: string): AgentSession {
  if (current?.accountId !== accountId) {
    current?.session.reset();
    current = { accountId, session: new AgentSession() };
  }
  return current.session;
}
export function endSession() {
  current?.session.reset();
  current = null;
}
