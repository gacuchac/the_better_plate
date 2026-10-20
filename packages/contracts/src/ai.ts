import { z } from "zod";

// Same shapes as in index.ts; repeated so this module has no import cycle with it.
const LocalDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
const MealSlotSchema = z.enum(["breakfast", "lunch", "dinner", "snack"]);

/**
 * Optional AI companion (PRODUCT.md §2.8), bring-your-own-key. The model runs on the server with
 * the person's encrypted key; its tools run in the app on the person's device, against the same
 * local-first stores the screens use, so every step shows live and can be undone. Arguments are
 * validated with these schemas on the server (before the app sees them) and again in the app.
 */

export const AiProviderSchema = z.enum(["anthropic", "openai"]);
export type AiProvider = z.infer<typeof AiProviderSchema>;
/** Who pays for a companion turn: the person's own key, or the included (owner-provided) one. */
export const AiTurnProviderSchema = z.enum(["anthropic", "openai", "house"]);
export type AiTurnProvider = z.infer<typeof AiTurnProviderSchema>;

const uuid = z.uuid();
const IngredientInput = z.object({
  foodId: z.string().regex(/^fdc:\d{1,9}$/, "Use a foodId from search_foods"),
  grams: z.number().positive().max(5000),
  /** cooking_oil counts only what stays in the food: grams minus oilDiscardedGrams. */
  role: z.enum(["ingredient", "cooking_oil"]).default("ingredient"),
  oilDiscardedGrams: z.number().min(0).max(5000).nullable().optional(),
});

/**
 * `confirm: true` tools wait for the person's tap in the app (deleting, anything not undoable).
 * Owner decision 2026-10-19: the agent acts directly with undo for everything else.
 */
export const AI_TOOLS = {
  navigate: {
    confirm: false,
    description: "Open a screen so the person can watch what you are doing. recipe and cook need recipeId; meals takes an optional date.",
    input: z.object({
      screen: z.enum(["kitchen", "explore", "you", "goals", "meals", "recipe", "cook"]),
      recipeId: uuid.optional(),
      date: LocalDateSchema.optional(),
    }),
  },
  search_foods: {
    confirm: false,
    description: "Search the USDA foods stored on the device (English USDA names). Returns up to 8 foods with ids. Use these ids in recipes; never invent ids.",
    input: z.object({ query: z.string().trim().min(1).max(100) }),
  },
  get_food: {
    confirm: false,
    description: "USDA nutrients per 100 g and household portions for one food.",
    input: z.object({ foodId: z.string().regex(/^fdc:\d{1,9}$/) }),
  },
  list_recipes: {
    confirm: false,
    description: "The person's recipes (id, title, servings).",
    input: z.object({}),
  },
  get_recipe: {
    confirm: false,
    description: "One recipe with ingredients in grams and its estimated nutrition per serving, computed by the app's nutrition engine.",
    input: z.object({ recipeId: uuid }),
  },
  save_recipe: {
    confirm: false,
    description:
      "Create a recipe (omit recipeId) or replace an existing one (pass recipeId and the complete new version; read it with get_recipe first). Saved on the device and synced. The person can undo.",
    input: z.object({
      recipeId: uuid.optional(),
      title: z.string().trim().min(1).max(120),
      description: z.string().trim().max(500).default(""),
      servings: z.number().positive().max(100),
      ingredients: z.array(IngredientInput).max(40),
      method: z.string().trim().max(4000).default(""),
    }),
  },
  plan_meal: {
    confirm: false,
    description: "Plan a recipe for a future or current day. A plan is not food eaten.",
    input: z.object({ recipeId: uuid, date: LocalDateSchema, slot: MealSlotSchema, servings: z.number().positive().max(20) }),
  },
  log_meal: {
    confirm: false,
    description: "Record that the person ate a recipe. Only when they tell you they ate it; never infer it from a plan.",
    input: z.object({ recipeId: uuid, date: LocalDateSchema, slot: MealSlotSchema, servings: z.number().positive().max(20) }),
  },
  get_day: {
    confirm: false,
    description: "Planned and eaten meals for a day, with estimated totals of what was eaten (plans excluded).",
    input: z.object({ date: LocalDateSchema }),
  },
  get_summary: {
    confirm: false,
    description:
      "Estimated totals and per-logged-day averages of what the person ate between two dates (at most 366 days), with how many days have meals logged. Plans are not included.",
    input: z.object({ from: LocalDateSchema, to: LocalDateSchema }),
  },
  list_goals: {
    confirm: false,
    description: "The person's consumption goals with progress in the current day, week or month, and how many recent periods met the goal.",
    input: z.object({ today: LocalDateSchema.optional().describe("The person's date today, if known") }),
  },
  set_goal: {
    confirm: false,
    description:
      "Create a consumption goal (omit goalId) or replace one (pass goalId). Only with numbers the person stated themselves; never propose, calculate or judge amounts. " +
      "kind at_least needs min, at_most needs max, between needs both, in the nutrient's unit. period is day, week (Monday to Sunday) or month. startDate defaults to today; endDate is optional. The person can undo.",
    input: z.object({
      goalId: uuid.optional(),
      nutrientKey: z.string().min(1).max(40),
      kind: z.enum(["at_least", "at_most", "between"]),
      min: z.number().positive().max(1_000_000).nullable().optional(),
      max: z.number().positive().max(1_000_000).nullable().optional(),
      period: z.enum(["day", "week", "month"]),
      startDate: LocalDateSchema.optional(),
      endDate: LocalDateSchema.nullable().optional(),
    }),
  },
  find_photos: {
    confirm: false,
    description:
      "Find openly licensed food photos (public domain, CC0, CC BY, CC BY-SA via Openverse) from a short visual description in English, e.g. 'lemon chicken with rice on a plate'. Returns photo ids with titles and licenses.",
    input: z.object({ description: z.string().trim().min(2).max(200) }),
  },
  set_recipe_photo: {
    confirm: false,
    description: "Use a photo from find_photos on a recipe (its credit is stored and shown). Pick one whose title clearly shows the same dish. The person can undo.",
    input: z.object({ recipeId: uuid, sourceId: uuid }),
  },
  generate_recipe_photo: {
    confirm: false,
    description:
      "Generate a photorealistic image of the recipe with the person's OpenAI key (costs them money; needs OpenAI connected). Only when they ask for a generated image or no found photo fits. It is labelled AI-generated. The person can undo.",
    input: z.object({ recipeId: uuid, prompt: z.string().trim().min(3).max(1000) }),
  },
  delete_recipe: {
    confirm: true,
    description: "Delete a recipe. The person must confirm in the app.",
    input: z.object({ recipeId: uuid }),
  },
  delete_goal: {
    confirm: true,
    description: "Delete one of the person's goals (goalId from list_goals). The person must confirm in the app.",
    input: z.object({ goalId: uuid }),
  },
  remove_eaten_meal: {
    confirm: true,
    description: "Remove a meal from what the person ate (logId from get_day). The person must confirm in the app.",
    input: z.object({ logId: uuid }),
  },
} as const;

export type AiToolName = keyof typeof AI_TOOLS;
export const AI_TOOL_NAMES = Object.keys(AI_TOOLS) as AiToolName[];

export type AiToolInput<N extends AiToolName> = z.infer<(typeof AI_TOOLS)[N]["input"]>;

export const MAX_AI_CONVERSATION = 120;

export const AiContextSchema = z.object({
  route: z.string().max(200),
  today: LocalDateSchema,
  language: z.enum(["en", "es"]),
  /** Things the person undid since the last message, so the agent doesn't redo them. */
  undone: z.array(z.string().max(200)).max(20).default([]),
});

export const AiTurnRequestSchema = z.object({
  provider: AiTurnProviderSchema,
  /** Provider-native transcript returned by the previous turn, passed back unchanged. */
  conversation: z.array(z.record(z.string(), z.unknown())).max(MAX_AI_CONVERSATION),
  input: z.discriminatedUnion("type", [
    z.object({ type: z.literal("message"), text: z.string().trim().min(1).max(4000), context: AiContextSchema }),
    z.object({
      type: z.literal("tool_results"),
      results: z.array(z.object({ id: z.string().min(1).max(200), output: z.string().max(20_000), isError: z.boolean() })).min(1).max(20),
    }),
  ]),
});

export const AiToolCallSchema = z.object({
  id: z.string(),
  name: z.string(),
  input: z.unknown(),
  /** Set when the model asked for an unknown tool or invalid arguments; the app must not run it. */
  error: z.string().optional(),
});

export const AiTurnResponseSchema = z.object({
  conversation: z.array(z.record(z.string(), z.unknown())),
  text: z.string(),
  toolCalls: z.array(AiToolCallSchema),
  /** No tool calls left: the turn is finished. */
  done: z.boolean(),
  model: z.string(),
  usage: z.object({ inputTokens: z.number(), outputTokens: z.number(), requestsToday: z.number(), dailyLimit: z.number() }),
});

export const AiCredentialInputSchema = z.object({
  apiKey: z.string().trim().min(8).max(400),
  model: z.string().trim().min(1).max(100).optional(),
});

export const AiSettingsSchema = z.object({
  available: z.boolean(),
  activeProvider: AiProviderSchema.nullable(),
  dailyRequestLimit: z.number().int(),
  requestsToday: z.number().int(),
  /** The included companion, used when no own key is in use. */
  house: z.object({
    status: z.enum(["available", "not_invited", "budget_reached", "off"]),
    model: z.string().nullable(),
    dailyLimit: z.number().int(),
    requestsToday: z.number().int(),
    /** Generated photos: same features as an own key, with their own daily cap. */
    dailyImageLimit: z.number().int(),
    imagesToday: z.number().int(),
  }),
  providers: z.array(
    z.object({
      provider: AiProviderSchema,
      connected: z.boolean(),
      /** Last four characters only; the key itself never leaves the server. */
      keyHint: z.string().nullable(),
      model: z.string().nullable(),
      models: z.array(z.string()),
    }),
  ),
});

export const AiSettingsUpdateSchema = z.object({
  activeProvider: AiProviderSchema.nullable().optional(),
  dailyRequestLimit: z.number().int().min(1).max(2000).optional(),
  model: z.object({ provider: AiProviderSchema, model: z.string().trim().min(1).max(100) }).optional(),
});

export type AiContext = z.input<typeof AiContextSchema>;
export type AiTurnRequest = z.input<typeof AiTurnRequestSchema>;
export type AiTurnResponse = z.infer<typeof AiTurnResponseSchema>;
export type AiToolCall = z.infer<typeof AiToolCallSchema>;
export type AiSettings = z.infer<typeof AiSettingsSchema>;
export type AiSettingsUpdate = z.infer<typeof AiSettingsUpdateSchema>;
