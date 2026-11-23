import { OpenAPIHono } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import {
  CookClientInviteSchema,
  CookExpenseBodySchema,
  CookMealCreateSchema,
  CookMealUpdateSchema,
  CookPriceBodySchema,
  CookReceiptBodySchema,
  CookReceiptLineBodySchema,
  CookShareBodySchema,
  CookStatementUpdateSchema,
  CookTargetRefSchema,
  CookTimerSchema,
  CURRENCIES,
} from "@betterplate/contracts";
import { config } from "../config.ts";
import { type ActingLink, ApiError, type AppEnv, type AuthUser, errorBody } from "../lib/http.ts";
import { recordRouteActivity } from "./linked/acting.ts";
import { registerAccountTool } from "./linked/connector.ts";
import { cookBillingRoutes } from "./cooks/billing.ts";
import { cookRoutes } from "./cooks/routes.ts";
import { importRoutes } from "./imports.ts";
import { normalizeForReading } from "./images.ts";
import type { ConnectorAuth } from "./connector.ts";
import { photoBytes, PhotoSourceInput, UPLOAD_FILE_PARAMS } from "./connector.ts";

/**
 * Cooking for others, and reading a recipe from a photo, over the connector. Each tool calls the
 * same REST route the app uses, in process, as the signed-in person: one set of checks, limits,
 * feature flags and answers for the app and for connected assistants. Cooking tools need their own
 * permissions (cooking:read, cooking:write), so a connection approved before them can't reach
 * clients, notes, receipts or statements until the person reconnects and allows it.
 */

type InternalEnv = AppEnv & { Bindings: { user: AuthUser; link: ActingLink | null } };
let internal: OpenAPIHono<InternalEnv> | null = null;

function internalApp() {
  if (internal) return internal;
  const app = new OpenAPIHono<InternalEnv>();
  // Only ever called below, with the person the access token was verified for, and the link
  // registerAccountTool checked when the call names a linked account. requireUser then applies
  // each route's policy, and a change that succeeds goes into the owner's activity log.
  app.use("*", async (c, next) => {
    c.set("user", c.env.user);
    if (c.env.link) c.set("link", c.env.link);
    c.set("requestId", "connector");
    await next();
    await recordRouteActivity(c as never);
  });
  for (const routes of [cookRoutes, cookBillingRoutes, importRoutes]) app.route("/", routes as never);
  app.notFound((c) => c.json(errorBody(c as never, "not_found", "Not found"), 404));
  app.onError((err, c) => {
    if (err instanceof ApiError) return c.json(errorBody(c as never, err.code, err.message, err.details), err.status);
    if (err instanceof HTTPException) return c.json(errorBody(c as never, "http_error", err.message), err.status);
    console.error(JSON.stringify({ level: "error", msg: "connector_cooking_unhandled", error: err.message }));
    return c.json(errorBody(c as never, "internal_error", "Something went wrong on our side"), 500);
  });
  internal = app;
  return app;
}

/** Why a route said no, in words an assistant can act on (validation issues included). */
function failure(status: number, body: unknown): Error {
  const b = body as { error?: { message?: string; details?: unknown; issues?: { path?: unknown[]; message?: string }[] } } | null;
  const issues = Array.isArray(b?.error?.details) ? (b!.error!.details as { path?: string; message?: string }[]) : (b?.error?.issues ?? []).map((i) => ({ path: (i.path ?? []).join("."), message: i.message }));
  const detail = issues.length ? `: ${issues.slice(0, 5).map((i) => (i.path ? `${i.path}: ${i.message}` : i.message)).join("; ")}` : "";
  const message = typeof b?.error?.message === "string" ? b.error.message : `The request was refused (${status})`;
  return new Error(`${message}${detail}`);
}

class Api {
  constructor(
    private readonly user: AuthUser,
    private readonly link: ActingLink | null = null,
  ) {}

  async call(method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", path: string, body?: unknown): Promise<unknown> {
    const init: RequestInit = { method };
    if (body !== undefined) {
      init.headers = { "content-type": "application/json" };
      init.body = JSON.stringify(body);
    }
    const res = await internalApp().request(path, init, { user: this.user, link: this.link });
    if (res.status === 204) return null;
    const type = res.headers.get("content-type") ?? "";
    if (!res.ok) throw failure(res.status, type.includes("json") ? await res.json().catch(() => null) : null);
    if (type.includes("json")) return res.json();
    return { bytes: Buffer.from(await res.arrayBuffer()), type: type.split(";")[0]!.trim() };
  }
  get = (path: string) => this.call("GET", path);
}

const enc = encodeURIComponent;
const uid = () => crypto.randomUUID();
const Id = (what: string) => z.uuid().describe(what);
const Kind = z.enum(["meal", "statement"]).describe("Whether it's a cooked meal or a statement");
const dollars = "Money is whole cents in the cook's currency (USD unless they changed it): $12.50 is 1250.";

/** A receipt line as an assistant sends it: the id is kept when it came from get_receipt, made up otherwise. */
const ReceiptLineInput = CookReceiptLineBodySchema.extend({ id: z.uuid().optional().describe("The line's id from get_receipt; leave out for a new line") });

type Output = unknown | { image: { bytes: Buffer; type: string } };

interface CookTool {
  name: string;
  description: string;
  input: z.ZodRawShape;
  access: "read" | "write";
  destructive?: boolean;
  /** Reaches past the person's own kitchen: emails someone, makes a public link, fetches a link or calls an AI model. */
  openWorld?: boolean;
  /** Which permission it needs: kitchen tools ride on the kitchen permissions. */
  scope: "cooking" | "kitchen";
  flag: "cookProfile" | "recipePhotoImport";
  fileParams?: string[];
  run: (input: never, api: Api) => Promise<Output>;
}

const tool = <S extends z.ZodRawShape>(t: Omit<CookTool, "input" | "run"> & { input: S; run: (input: z.infer<z.ZodObject<S>>, api: Api) => Promise<Output> }) => t as unknown as CookTool;

// Built on first use: connector.ts imports this module, so its exports aren't ready at load time.
const cookTools = (): CookTool[] => [
  // ------------------------------------------------------------ recipes from a photo
  tool({
    name: "read_recipe_photo",
    scope: "kitchen", flag: "recipePhotoImport", access: "write", openWorld: true, fileParams: UPLOAD_FILE_PARAMS,
    description:
      "Read a recipe from one photo of a cookbook page, recipe card or handwritten note, with the same reader as the app's \"From a photo\" " +
      "(the person's own AI key, or the included companion within its daily read limit). Send exactly one of image (a file attached in the chat), " +
      "imageUrl or imageBase64. The photo is read once and never stored. Returns a draft: each ingredient line with the catalog food it matched " +
      "(foodId, or null with candidates to pick from) and its amount when it could be weighed. Nothing is saved: show the person the lines, fix " +
      "unmatched foods and amounts with them (search_foods, get_food for portion weights), then save it with save_recipe, in grams and with each " +
      "ingredient raw or cooked. Only for photos they took or may use.",
    input: { ...PhotoSourceInput, rightsConfirmed: z.literal(true).describe("true only when the person said they took this photo or may use the recipe") },
    async run(input, api) {
      const photo = await normalizeForReading(await photoBytes(input, "Or use From a photo on a new recipe in The Better Plate app."));
      const draft = (await api.call("POST", "/v1/recipe-imports", { images: [photo.toString("base64")], rightsConfirmed: true })) as Record<string, unknown>;
      return { ...draft, saved: false, next: "Review the lines with the person, then save_recipe with grams and cooking for each ingredient." };
    },
  }),

  // ------------------------------------------------------------ profile and clients
  tool({
    name: "get_cook_profile", scope: "cooking", flag: "cookProfile", access: "read",
    description: "The person's cooking-for-others profile (business name, currency, default hourly rate and fee per meal), or null if they haven't set one up.",
    input: {},
    run: (_i, api) => api.get("/v1/cook"),
  }),
  tool({
    name: "set_cook_profile", scope: "cooking", flag: "cookProfile", access: "write",
    description: `Set up or change the cooking profile. Send only what changes; the rest stays. ${dollars} null hourlyRateCents means time isn't charged; null flatFeeCents means no fee per meal.`,
    input: {
      businessName: z.string().trim().max(80).optional(),
      currency: z.enum(CURRENCIES).optional(),
      hourlyRateCents: z.number().int().min(0).max(10_000_000).nullable().optional(),
      flatFeeCents: z.number().int().min(0).max(10_000_000).nullable().optional(),
    },
    async run(input, api) {
      const current = ((await api.get("/v1/cook")) as { profile: Record<string, unknown> | null }).profile;
      const { createdAt: _c, ...kept } = current ?? {};
      return api.call("PUT", "/v1/cook", { ...kept, ...input });
    },
  }),
  tool({
    name: "list_cook_clients", scope: "cooking", flag: "cookProfile", access: "read",
    description: "The cook's clients: people they cook for who may not use the app, with the cook's private notes (allergies included), rate and invite state.",
    input: {},
    run: (_i, api) => api.get("/v1/cook/clients"),
  }),
  tool({
    name: "save_cook_client", scope: "cooking", flag: "cookProfile", access: "write",
    description: `Add a client (omit clientId) or change one (send only what changes). They don't need the app. ${dollars} null hourlyRateCents uses the profile's rate.`,
    input: {
      clientId: z.uuid().optional().describe("Leave out to add a new client"),
      name: z.string().trim().min(1).max(80).optional().describe("Required for a new client"),
      notes: z.string().trim().max(2000).optional().describe("The cook's own notes, allergies included; only the cook sees them"),
      hourlyRateCents: z.number().int().min(0).max(10_000_000).nullable().optional(),
    },
    async run({ clientId, ...input }, api) {
      if (!clientId) {
        if (!input.name) throw new Error("Give the new client a name");
        return api.call("POST", "/v1/cook/clients", { id: uid(), notes: "", hourlyRateCents: null, ...input });
      }
      const { clients } = (await api.get("/v1/cook/clients")) as { clients: { id: string; name: string; notes: string; hourlyRateCents: number | null }[] };
      const c = clients.find((x) => x.id === clientId);
      if (!c) throw new Error(`No client with id ${clientId}`);
      return api.call("PUT", `/v1/cook/clients/${enc(clientId)}`, { name: c.name, notes: c.notes, hourlyRateCents: c.hourlyRateCents, ...input });
    },
  }),
  tool({
    name: "remove_cook_client", scope: "cooking", flag: "cookProfile", access: "write", destructive: true,
    description: "Remove a client who has no cooked meals. Ask the person first.",
    input: { clientId: Id("The client's id, from list_cook_clients") },
    run: async ({ clientId }, api) => (await api.call("DELETE", `/v1/cook/clients/${enc(clientId)}`), { clientId, removed: true }),
  }),
  tool({
    name: "invite_cook_client", scope: "cooking", flag: "cookProfile", access: "write", openWorld: true,
    description:
      "Email a client an invite to The Better Plate, so they see every meal cooked for them and whatever the cook shares. This sends a real email: " +
      "show the person the address and get their yes first. One resend a day per client.",
    input: { clientId: Id("The client's id, from list_cook_clients"), email: CookClientInviteSchema.shape.email },
    run: ({ clientId, email }, api) => api.call("POST", `/v1/cook/clients/${enc(clientId)}/invite`, { email }),
  }),
  tool({
    name: "cancel_cook_client_invite", scope: "cooking", flag: "cookProfile", access: "write", destructive: true,
    description: "Take back a client's pending invite; its link stops working.",
    input: { clientId: Id("The client's id, from list_cook_clients") },
    run: async ({ clientId }, api) => (await api.call("DELETE", `/v1/cook/clients/${enc(clientId)}/invite`), { clientId, inviteCancelled: true }),
  }),
  tool({
    name: "list_cook_targets", scope: "cooking", flag: "cookProfile", access: "read",
    description:
      "Who the person can cook for: themselves, groups they belong to, members of groups they run, and their clients, each with the allergies the cook may see. " +
      "Use a target from here when starting a meal, and keep its allergies in mind.",
    input: {},
    run: (_i, api) => api.get("/v1/cook/targets"),
  }),

  // ------------------------------------------------------------ meals
  tool({
    name: "list_cooked_meals", scope: "cooking", flag: "cookProfile", access: "read",
    description: "The cook's meals, newest first, with each one's total. Filter by client, group or member, or to meals not yet on a statement.",
    input: { clientId: z.uuid().optional(), groupId: z.uuid().optional(), memberId: z.uuid().optional(), unbilled: z.boolean().optional().describe("true for meals not on any statement yet") },
    run: (input, api) => {
      const q = new URLSearchParams();
      for (const [k, v] of Object.entries(input)) if (v !== undefined) q.set(k, String(v));
      return api.get(`/v1/cook/meals${q.size ? `?${q}` : ""}`);
    },
  }),
  tool({
    name: "get_cooked_meal", scope: "cooking", flag: "cookProfile", access: "read",
    description: "One cooked meal with its recipes, the receipt lines bought for it, time, other costs and totals.",
    input: { mealId: Id("The meal's id, from list_cooked_meals") },
    run: ({ mealId }, api) => api.get(`/v1/cook/meals/${enc(mealId)}`),
  }),
  tool({
    name: "start_cooked_meal", scope: "cooking", flag: "cookProfile", access: "write",
    description: "Start a cooked meal for someone (a target from list_cook_targets), optionally with a first recipe from list_recipes. Recipes are copied as they are now.",
    input: {
      name: CookMealCreateSchema.shape.name,
      cookedOn: CookMealCreateSchema.shape.cookedOn.describe("The day it's cooked, YYYY-MM-DD in the person's time zone"),
      target: CookTargetRefSchema.describe("kind me, group (groupId), member (groupId and memberId) or client (clientId), as list_cook_targets gives"),
      recipeId: z.uuid().optional(),
      servings: z.number().positive().max(1000).optional(),
    },
    run: (input, api) => api.call("POST", "/v1/cook/meals", { id: uid(), ...input }),
  }),
  tool({
    name: "update_cooked_meal", scope: "cooking", flag: "cookProfile", access: "write",
    description: `Change a meal's name, date, notes, rate, fee or minutes (cooking minutes typed here replace what the timer counted). Send only what changes. ${dollars}`,
    input: { mealId: Id("The meal's id"), ...CookMealUpdateSchema.shape },
    run: ({ mealId, ...input }, api) => api.call("PATCH", `/v1/cook/meals/${enc(mealId)}`, input),
  }),
  tool({
    name: "delete_cooked_meal", scope: "cooking", flag: "cookProfile", access: "write", destructive: true,
    description: "Delete a meal that isn't on a sent statement, with its costs and any share of it. Receipt lines bought for it become unassigned. Ask the person first.",
    input: { mealId: Id("The meal's id") },
    run: async ({ mealId }, api) => (await api.call("DELETE", `/v1/cook/meals/${enc(mealId)}`), { mealId, deleted: true }),
  }),
  tool({
    name: "add_recipe_to_meal", scope: "cooking", flag: "cookProfile", access: "write",
    description: "Add one of the person's recipes (from list_recipes) to a meal, at a number of servings.",
    input: { mealId: Id("The meal's id"), recipeId: Id("The recipe's id, from list_recipes"), servings: z.number().positive().max(1000) },
    run: ({ mealId, ...body }, api) => api.call("POST", `/v1/cook/meals/${enc(mealId)}/recipes`, body),
  }),
  tool({
    name: "remove_recipe_from_meal", scope: "cooking", flag: "cookProfile", access: "write", destructive: true,
    description: "Take a recipe off a meal (mealRecipeId is the entry's id in get_cooked_meal's recipes). The recipe itself stays in the kitchen.",
    input: { mealId: Id("The meal's id"), mealRecipeId: Id("The entry's id in the meal's recipes") },
    run: async ({ mealId, mealRecipeId }, api) => (await api.call("DELETE", `/v1/cook/meals/${enc(mealId)}/recipes/${enc(mealRecipeId)}`), { mealId, mealRecipeId, removed: true }),
  }),
  tool({
    name: "meal_cooking_timer", scope: "cooking", flag: "cookProfile", access: "write",
    description: "Start, pause or stop a meal's cooking timer; the time it counts is billed at the meal's rate.",
    input: { mealId: Id("The meal's id"), action: CookTimerSchema.shape.action },
    run: ({ mealId, action }, api) => api.call("POST", `/v1/cook/meals/${enc(mealId)}/timer`, { action }),
  }),
  tool({
    name: "add_meal_cost", scope: "cooking", flag: "cookProfile", access: "write",
    description: `Add another cost to a meal that isn't on a receipt (parking, a rented pan). ${dollars}`,
    input: { mealId: Id("The meal's id"), ...CookExpenseBodySchema.shape },
    run: ({ mealId, ...body }, api) => api.call("POST", `/v1/cook/meals/${enc(mealId)}/expenses`, body),
  }),
  tool({
    name: "remove_meal_cost", scope: "cooking", flag: "cookProfile", access: "write", destructive: true,
    description: "Remove one of a meal's other costs (costId from get_cooked_meal's expenses).",
    input: { mealId: Id("The meal's id"), costId: Id("The cost's id") },
    run: async ({ mealId, costId }, api) => (await api.call("DELETE", `/v1/cook/meals/${enc(mealId)}/expenses/${enc(costId)}`), { mealId, costId, removed: true }),
  }),
  tool({
    name: "get_meal_shopping_list", scope: "cooking", flag: "cookProfile", access: "read",
    description: "What to buy for a meal's recipes, with an estimate from the cook's saved prices.",
    input: { mealId: Id("The meal's id") },
    run: ({ mealId }, api) => api.get(`/v1/cook/meals/${enc(mealId)}/shopping-list`),
  }),

  // ------------------------------------------------------------ prices
  tool({
    name: "list_ingredient_prices", scope: "cooking", flag: "cookProfile", access: "read",
    description: "What the cook last paid per kilogram for each food, from confirmed receipts or typed in.",
    input: {},
    run: (_i, api) => api.get("/v1/cook/prices"),
  }),
  tool({
    name: "set_ingredient_price", scope: "cooking", flag: "cookProfile", access: "write",
    description: `Set what the cook pays per kilogram for a food (foodId from search_foods), in cents per kg. ${dollars}`,
    input: { foodId: z.string().regex(/^fdc:\d{1,9}$/).describe("A food id from search_foods"), ...CookPriceBodySchema.shape },
    run: ({ foodId, centsPerKg }, api) => api.call("PUT", `/v1/cook/prices/${enc(foodId)}`, { centsPerKg }),
  }),
  tool({
    name: "forget_ingredient_price", scope: "cooking", flag: "cookProfile", access: "write", destructive: true,
    description: "Forget a saved price for a food.",
    input: { foodId: z.string().regex(/^fdc:\d{1,9}$/) },
    run: async ({ foodId }, api) => (await api.call("DELETE", `/v1/cook/prices/${enc(foodId)}`), { foodId, forgotten: true }),
  }),

  // ------------------------------------------------------------ receipts
  tool({
    name: "read_receipt_photo", scope: "cooking", flag: "cookProfile", access: "write", openWorld: true, fileParams: UPLOAD_FILE_PARAMS,
    description:
      "Read a grocery receipt from a photo, with the app's reader (the person's own AI key, or the included companion within its daily read limit). " +
      "Send exactly one of image (a file attached in the chat), imageUrl or imageBase64. Payment and card lines are left out; the photo is kept for the cook only. " +
      "Returns a draft receipt: check each line's food with the person, say which meal it was for (mealId) or mark it personal with update_receipt, then confirm_receipt.",
    input: { ...PhotoSourceInput },
    async run(input, api) {
      const photo = await normalizeForReading(await photoBytes(input, "Or use Photo of a receipt under Cooking for others, Receipts, in The Better Plate app."));
      return api.call("POST", "/v1/cook/receipts/read", { image: photo.toString("base64") });
    },
  }),
  tool({
    name: "add_receipt", scope: "cooking", flag: "cookProfile", access: "write",
    description: `Type in a receipt without a photo, as a draft. ${dollars} The lines plus tax must add up to the total before it can be confirmed.`,
    input: { ...CookReceiptBodySchema.shape, lines: z.array(ReceiptLineInput).max(200) },
    run: (input, api) => api.call("POST", "/v1/cook/receipts", { ...input, lines: input.lines.map((l) => ({ ...l, id: l.id ?? uid() })) }),
  }),
  tool({
    name: "list_receipts", scope: "cooking", flag: "cookProfile", access: "read",
    description: "The cook's receipts, newest first, with how many lines still need a meal.",
    input: {},
    run: (_i, api) => api.get("/v1/cook/receipts"),
  }),
  tool({
    name: "get_receipt", scope: "cooking", flag: "cookProfile", access: "read",
    description: "A receipt with each line, its food, the meal it's for, its share of tax and other catalog matches.",
    input: { receiptId: Id("The receipt's id, from list_receipts") },
    run: ({ receiptId }, api) => api.get(`/v1/cook/receipts/${enc(receiptId)}`),
  }),
  tool({
    name: "get_receipt_photo", scope: "cooking", flag: "cookProfile", access: "read",
    description: "The receipt's photo as the cook saved it (metadata removed). It can show card digits or loyalty numbers the reader left out; don't repeat those.",
    input: { receiptId: Id("The receipt's id") },
    async run({ receiptId }, api) {
      const file = (await api.get(`/v1/cook/receipts/${enc(receiptId)}/image`)) as { bytes: Buffer; type: string };
      return { image: file };
    },
  }),
  tool({
    name: "update_receipt", scope: "cooking", flag: "cookProfile", access: "write",
    description:
      `Change a draft receipt. Send only what changes; lines, when sent, replace all of them, so send every line you keep (with its id from get_receipt). ` +
      `Each line needs a mealId or personal true before the receipt can be confirmed. ${dollars}`,
    input: {
      receiptId: Id("The receipt's id"),
      store: z.string().trim().max(120).optional(),
      purchasedOn: CookReceiptBodySchema.shape.purchasedOn.optional(),
      subtotalCents: CookReceiptBodySchema.shape.subtotalCents.optional(),
      taxCents: CookReceiptBodySchema.shape.taxCents.optional(),
      totalCents: CookReceiptBodySchema.shape.totalCents.optional(),
      lines: z.array(ReceiptLineInput).max(200).optional(),
    },
    async run({ receiptId, ...input }, api) {
      const r = (await api.get(`/v1/cook/receipts/${enc(receiptId)}`)) as z.infer<typeof CookReceiptBodySchema> & { lines: (z.infer<typeof CookReceiptLineBodySchema> & Record<string, unknown>)[] };
      const keep = (l: z.infer<typeof ReceiptLineInput>) => ({ id: l.id ?? uid(), text: l.text, priceCents: l.priceCents, foodId: l.foodId, grams: l.grams, mealId: l.mealId, personal: l.personal });
      return api.call("PUT", `/v1/cook/receipts/${enc(receiptId)}`, {
        store: input.store ?? r.store,
        purchasedOn: input.purchasedOn !== undefined ? input.purchasedOn : r.purchasedOn,
        subtotalCents: input.subtotalCents !== undefined ? input.subtotalCents : r.subtotalCents,
        taxCents: input.taxCents ?? r.taxCents,
        totalCents: input.totalCents !== undefined ? input.totalCents : r.totalCents,
        lines: (input.lines ?? r.lines).map(keep),
      });
    },
  }),
  tool({
    name: "confirm_receipt", scope: "cooking", flag: "cookProfile", access: "write",
    description: "Confirm a draft receipt: its lines then count toward their meals and update the cook's prices. Every line needs a meal or personal, and the lines plus tax must equal the total.",
    input: { receiptId: Id("The receipt's id") },
    run: ({ receiptId }, api) => api.call("POST", `/v1/cook/receipts/${enc(receiptId)}/confirm`),
  }),
  tool({
    name: "reopen_receipt", scope: "cooking", flag: "cookProfile", access: "write",
    description: "Reopen a confirmed receipt to change it (not while a meal it pays for is on a sent statement).",
    input: { receiptId: Id("The receipt's id") },
    run: ({ receiptId }, api) => api.call("POST", `/v1/cook/receipts/${enc(receiptId)}/reopen`),
  }),
  tool({
    name: "delete_receipt", scope: "cooking", flag: "cookProfile", access: "write", destructive: true,
    description: "Delete a receipt and its photo. Ask the person first.",
    input: { receiptId: Id("The receipt's id") },
    run: async ({ receiptId }, api) => (await api.call("DELETE", `/v1/cook/receipts/${enc(receiptId)}`), { receiptId, deleted: true }),
  }),

  // ------------------------------------------------------------ statements
  tool({
    name: "list_statements", scope: "cooking", flag: "cookProfile", access: "read",
    description: "The cook's statements (drafts, sent, paid, void) with their totals.",
    input: {},
    run: (_i, api) => api.get("/v1/cook/statements"),
  }),
  tool({
    name: "get_statement", scope: "cooking", flag: "cookProfile", access: "read",
    description: "A statement with each meal and the totals for groceries, time, other costs and fees. No tax is added to the cook's time or fees.",
    input: { statementId: Id("The statement's id, from list_statements") },
    run: ({ statementId }, api) => api.get(`/v1/cook/statements/${enc(statementId)}`),
  }),
  tool({
    name: "create_statement", scope: "cooking", flag: "cookProfile", access: "write",
    description: "Add meals up into a draft statement. All meals must be for the same person or group and not already on another statement (list_cooked_meals with unbilled true).",
    input: { title: z.string().trim().min(1).max(120), mealIds: z.array(z.uuid()).min(1).max(200) },
    run: (input, api) => api.call("POST", "/v1/cook/statements", { id: uid(), ...input }),
  }),
  tool({
    name: "update_statement", scope: "cooking", flag: "cookProfile", access: "write",
    description: "Change a draft statement's title or meals (mealIds replaces the list).",
    input: { statementId: Id("The statement's id"), ...CookStatementUpdateSchema.shape },
    run: ({ statementId, ...body }, api) => api.call("PATCH", `/v1/cook/statements/${enc(statementId)}`, body),
  }),
  tool({
    name: "delete_statement", scope: "cooking", flag: "cookProfile", access: "write", destructive: true,
    description: "Delete a draft statement; its meals stay. A sent statement can't be deleted, only voided. Ask the person first.",
    input: { statementId: Id("The statement's id") },
    run: async ({ statementId }, api) => (await api.call("DELETE", `/v1/cook/statements/${enc(statementId)}`), { statementId, deleted: true }),
  }),
  tool({
    name: "set_statement_status", scope: "cooking", flag: "cookProfile", access: "write", destructive: true,
    description:
      "Mark a statement sent (freezes it; nothing is emailed), paid, or void. Marking sent doesn't send anything: share it, or the person sends it themselves. " +
      "Ask the person first; a sent statement can't go back to draft.",
    input: { statementId: Id("The statement's id"), status: z.enum(["sent", "paid", "void"]) },
    run: ({ statementId, status }, api) => api.call("POST", `/v1/cook/statements/${enc(statementId)}/${status === "sent" ? "send" : status}`),
  }),

  // ------------------------------------------------------------ sharing
  tool({
    name: "get_cook_sharing", scope: "cooking", flag: "cookProfile", access: "read",
    description: "What of a meal or statement is shared, with whom in the app, and its link if there is one.",
    input: { kind: Kind, id: Id("The meal's or statement's id") },
    run: ({ kind, id }, api) => api.get(`/v1/cook/${kind === "meal" ? "meals" : "statements"}/${enc(id)}/share`),
  }),
  tool({
    name: "share_cooked", scope: "cooking", flag: "cookProfile", access: "write", openWorld: true,
    description:
      "Share a meal, or a sent statement, with the linked client or group in the app, choosing the parts: the basics (name, date, recipes with their " +
      "descriptions) always, and optionally groceries, time and totals. link true also makes a link anyone can open. Prices are never shown " +
      "unless the person turns those parts on. Ask the person which parts first.",
    input: { kind: Kind, id: Id("The meal's or statement's id"), ...CookShareBodySchema.shape },
    run: ({ kind, id, ...body }, api) => api.call("PUT", `/v1/cook/${kind === "meal" ? "meals" : "statements"}/${enc(id)}/share`, body),
  }),
  tool({
    name: "stop_cook_sharing", scope: "cooking", flag: "cookProfile", access: "write", destructive: true,
    description: "Stop sharing a meal or statement; its link stops working at once.",
    input: { kind: Kind, id: Id("The meal's or statement's id") },
    run: async ({ kind, id }, api) => (await api.call("DELETE", `/v1/cook/${kind === "meal" ? "meals" : "statements"}/${enc(id)}/share`), { kind, id, shared: false }),
  }),

  // ------------------------------------------------------------ someone cooks for the person
  tool({
    name: "list_my_cooks", scope: "cooking", flag: "cookProfile", access: "read",
    description: "Cooks who cook for the person, with every meal cooked for them and whatever each cook shared. Prices only where the cook shared them.",
    input: {},
    run: (_i, api) => api.get("/v1/me/cooks"),
  }),
  tool({
    name: "list_cook_invites", scope: "cooking", flag: "cookProfile", access: "read",
    description: "Cooks who invited the person to see the meals they cook for them.",
    input: {},
    run: (_i, api) => api.get("/v1/me/cook-invites"),
  }),
  tool({
    name: "answer_cook_invite", scope: "cooking", flag: "cookProfile", access: "write",
    description: "Accept or decline a cook's invite. Accepting lets the cook see the person's food preferences (never their meals or goals). Ask the person first.",
    input: { inviteId: Id("The invite's id, from list_cook_invites"), accept: z.boolean() },
    run: async ({ inviteId, accept }, api) =>
      accept ? api.call("POST", `/v1/me/cook-invites/${enc(inviteId)}/accept`) : (await api.call("DELETE", `/v1/me/cook-invites/${enc(inviteId)}`), { inviteId, declined: true }),
  }),
  tool({
    name: "unlink_cook", scope: "cooking", flag: "cookProfile", access: "write", destructive: true,
    description: "Stop seeing a cook's meals; the cook no longer sees the person's food preferences. Ask the person first.",
    input: { cookId: Id("The cook's id, from list_my_cooks") },
    run: async ({ cookId }, api) => (await api.call("DELETE", `/v1/me/cooks/${enc(cookId)}`), { cookId, unlinked: true }),
  }),
  tool({
    name: "list_group_cooked_meals", scope: "cooking", flag: "cookProfile", access: "read",
    description: "Meals cooked for one of the person's groups, as their cooks shared them (money parts only for the group's admins).",
    input: { groupId: Id("The group's id") },
    run: ({ groupId }, api) => api.get(`/v1/groups/${enc(groupId)}/cooked-meals`),
  }),
];
let built: CookTool[] | null = null;
const TOOLS = () => (built ??= cookTools());

export const COOKING_INSTRUCTIONS = `
- Cooking for others (when the person cooks for clients or groups): money is whole cents in the cook's currency. Never invent prices, minutes or receipt lines; use what the person or a receipt gives.
- Client notes, allergies and receipt photos are private to the cook; don't repeat card or loyalty numbers from a receipt photo.
- invite_cook_client sends a real email, share_cooked can make a public link, and set_statement_status freezes a statement: get the person's yes first.`;

/** Registers the cooking tools whose feature is on; each checks its own permission when called. */
export function registerCookingTools(server: McpServer, session: ConnectorAuth) {
  for (const t of TOOLS()) {
    if (!config.features[t.flag]) continue;
    const scopeText = t.scope === "cooking" ? (t.access === "write" ? "change your cooking for others" : "read your cooking for others") : "change the kitchen";
    registerAccountTool(server, session, {
      name: t.name,
      description: t.description,
      input: t.input,
      ...(t.fileParams ? { meta: { "openai/fileParams": t.fileParams } } : {}),
      annotations: { readOnlyHint: t.access === "read", destructiveHint: !!t.destructive, idempotentHint: t.access === "read", openWorldHint: !!t.openWorld },
      scope: `${t.scope}:${t.access}`,
      scopeText,
      // The routes each tool calls decide, with the same policies as in the app.
      policy: { kind: "routes" },
      run: (input, ctx) => t.run(input, new Api(ctx.actor, ctx.link)),
    });
  }
}
