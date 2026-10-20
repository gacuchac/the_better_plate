import { z } from "zod";

/** Shared wire contracts for the API and its clients. The API's OpenAPI document is generated from these. */

export { PRIVACY_NOTICE } from "./privacy.ts";
export * from "./ai.ts";

export const MAX_INGREDIENTS = 100;
export const MAX_SYNC_OPS = 100;

const trimmed = (max: number) => z.string().trim().max(max);

export const RecipeIngredientSchema = z.object({
  id: z.uuid(),
  foodId: z.string().regex(/^fdc:\d{1,9}$/, "foodId must look like fdc:<id>"),
  quantity: z.number().positive().max(100_000),
  unit: z.enum(["g", "kg", "oz", "lb", "portion"]),
  portionIndex: z.number().int().min(0).max(100).nullable().optional(),
  role: z.enum(["ingredient", "cooking_oil"]),
  oilDiscardedGrams: z.number().min(0).max(100_000).nullable().optional(),
});

// ---------- recipe photos: openly licensed photos or images generated on the person's key ----------

/** Licenses a photo may carry: public domain, CC0, CC BY, CC BY-SA. Anything else is never offered. */
export const PhotoLicenseSchema = z.enum(["cc0", "pdm", "by", "by-sa"]);

export const PhotoCreditSchema = z.object({
  source: z.literal("openverse"),
  sourceId: z.string().max(100),
  title: trimmed(300),
  creator: trimmed(200).nullable(),
  license: PhotoLicenseSchema,
  licenseVersion: trimmed(20).nullable(),
  licenseUrl: z.url().max(500).nullable(),
  sourceUrl: z.url().max(1000).nullable(),
  provider: trimmed(100).nullable(),
});

/**
 * Attached to a recipe. Credit and generator come from the server's own record of the image
 * (the server overwrites whatever a client sends), so attribution can't be forged.
 */
export const RecipeImageSchema = z.object({
  id: z.uuid(),
  alt: trimmed(200),
  kind: z.enum(["photo", "generated"]),
  credit: PhotoCreditSchema.nullable(),
  generator: z.object({ provider: z.literal("openai"), model: z.string().max(100) }).nullable(),
});

export const RecipeBodySchema = z.object({
  title: trimmed(120).min(1, "Give the recipe a name"),
  /** A sentence or two about the dish, shown under the title. */
  description: trimmed(500).default(""),
  servings: z.number().positive().max(100),
  ingredients: z.array(RecipeIngredientSchema).max(MAX_INGREDIENTS),
  method: trimmed(10_000).default(""),
  image: RecipeImageSchema.nullable().optional(),
});

export const PhotoSearchResultSchema = PhotoCreditSchema.extend({
  /** Preview served by Openverse; the app loads it with no referrer. */
  thumbnailUrl: z.url(),
  width: z.number().nullable(),
  height: z.number().nullable(),
});
export const PhotoSearchResponseSchema = z.object({ results: z.array(PhotoSearchResultSchema) });
export const PhotoImportSchema = z.object({ source: z.literal("openverse"), sourceId: z.string().min(1).max(100), alt: trimmed(200).optional() });
export const ImageGenerateSchema = z.object({
  /** What to draw; the app builds it from the recipe, the person can edit it. */
  prompt: trimmed(1000).min(3),
  alt: trimmed(200),
});

export const NutrientTotalSchema = z.object({
  key: z.string(),
  amount: z.number().nullable(),
  unit: z.string(),
  status: z.enum(["known", "partial", "unknown"]),
  missingFrom: z.array(z.string()),
});

export const RecipeNutritionSchema = z.object({
  engineVersion: z.string(),
  catalogVersion: z.string(),
  servings: z.number(),
  totals: z.array(NutrientTotalSchema),
  perServing: z.array(NutrientTotalSchema),
  disclosures: z.array(z.object({ code: z.string(), ingredientId: z.string() })),
});

export const RecipeSchema = RecipeBodySchema.extend({
  id: z.uuid(),
  version: z.number().int().positive(),
  createdAt: z.string(),
  updatedAt: z.string(),
  nutrition: RecipeNutritionSchema.nullable(),
});

// ---------- meals: plans and eaten logs are separate records ----------

export const MealSlotSchema = z.enum(["breakfast", "lunch", "dinner", "snack"]);
/** Calendar day in the person's own time zone when they planned or ate; history never shifts when they travel. */
export const LocalDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");

export const PlannedMealBodySchema = z.object({
  date: LocalDateSchema,
  slot: MealSlotSchema,
  recipeId: z.uuid(),
  /** Recipe title when planned, so the plan stays readable if the recipe is renamed or deleted. */
  title: trimmed(120).min(1),
  servings: z.number().positive().max(100),
});

export const PlannedMealSchema = PlannedMealBodySchema.extend({
  id: z.uuid(),
  version: z.number().int().positive(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const MealLogBodySchema = z.object({
  /** The plan this fulfils, if any. A plan never counts as eaten by itself. */
  plannedMealId: z.uuid().nullable(),
  recipeId: z.uuid().nullable(),
  /** Snapshot of the recipe as eaten; the server recomputes nutrition from catalog records. */
  recipe: RecipeBodySchema.pick({ title: true, servings: true, ingredients: true }),
  /** Servings eaten (may be fractional). */
  servings: z.number().positive().max(100),
  slot: MealSlotSchema,
  localDate: LocalDateSchema,
  eatenAt: z.iso.datetime({ offset: true }),
});

export const MealLogSchema = MealLogBodySchema.extend({
  id: z.uuid(),
  createdAt: z.string(),
  /** Immutable nutrition snapshot of the recipe at logging time. */
  nutrition: RecipeNutritionSchema,
  /** perServing × servings eaten; partial and unknown statuses carry through. */
  eaten: z.array(NutrientTotalSchema),
});

export const SyncOperationSchema = z.discriminatedUnion("type", [
  z.object({
    opId: z.uuid(),
    type: z.literal("recipe.put"),
    entityId: z.uuid(),
    /** Server version the client edited; null for a new recipe. */
    baseVersion: z.number().int().positive().nullable(),
    body: RecipeBodySchema,
  }),
  z.object({
    opId: z.uuid(),
    type: z.literal("recipe.delete"),
    entityId: z.uuid(),
    baseVersion: z.number().int().positive().nullable(),
  }),
  z.object({
    opId: z.uuid(),
    type: z.literal("plan.put"),
    entityId: z.uuid(),
    baseVersion: z.number().int().positive().nullable(),
    body: PlannedMealBodySchema,
  }),
  z.object({
    opId: z.uuid(),
    type: z.literal("plan.delete"),
    entityId: z.uuid(),
    baseVersion: z.number().int().positive().nullable(),
  }),
  /** Create-only: a log is never edited, only retracted. Separate logs are never coalesced. */
  z.object({
    opId: z.uuid(),
    type: z.literal("log.create"),
    entityId: z.uuid(),
    body: MealLogBodySchema,
  }),
  z.object({
    opId: z.uuid(),
    type: z.literal("log.delete"),
    entityId: z.uuid(),
  }),
]);

export const SyncBatchRequestSchema = z.object({
  protocol: z.literal(1),
  operations: z.array(SyncOperationSchema).min(1).max(MAX_SYNC_OPS),
});

export const SyncResultSchema = z.object({
  opId: z.uuid(),
  entityId: z.uuid(),
  /** retry: transient server failure, nothing was applied; resend the same opId later. */
  status: z.enum(["applied", "conflict", "rejected", "retry"]),
  /** True when this opId was already processed; the stored result is returned again. */
  replayed: z.boolean(),
  version: z.number().int().nullable(),
  /** Current server copy on conflict (null if the server copy is deleted). */
  server: RecipeSchema.nullable().optional(),
  /** Current server copy of a planned meal on conflict (null if deleted). */
  serverPlannedMeal: PlannedMealSchema.nullable().optional(),
  error: z.object({ code: z.string(), message: z.string() }).optional(),
});

export const SyncBatchResponseSchema = z.object({
  protocol: z.literal(1),
  results: z.array(SyncResultSchema),
});

export const SyncChangeSchema = z.object({
  entity: z.enum(["recipe", "planned_meal", "meal_log"]),
  entityId: z.uuid(),
  seq: z.string(),
  deleted: z.boolean(),
  recipe: RecipeSchema.nullable(),
  plannedMeal: PlannedMealSchema.nullable().optional(),
  mealLog: MealLogSchema.nullable().optional(),
});

export const SyncChangesResponseSchema = z.object({
  changes: z.array(SyncChangeSchema),
  cursor: z.string(),
  hasMore: z.boolean(),
});

// ---------- share links: revocable read-only snapshots ----------

export const ShareCreateSchema = z.object({
  /** The method is the cook's own words; it is shared only when the owner ticks it. */
  includeMethod: z.boolean(),
  /** Optional automatic expiry; null keeps the link until it is revoked. */
  expiresInDays: z.number().int().min(1).max(365).nullable().default(null),
});

export const SharedIngredientSchema = RecipeIngredientSchema.pick({ id: true, foodId: true, quantity: true, unit: true, portionIndex: true, role: true, oilDiscardedGrams: true }).extend({
  /** USDA description, so a viewer without the catalog can read the list. */
  name: z.string(),
  portionLabel: z.string().nullable(),
});

/** Exactly what a link holder can read: no account, email, meals or other recipes. */
export const SharedRecipeSchema = z.object({
  shareId: z.uuid(),
  title: z.string(),
  description: z.string(),
  servings: z.number(),
  ingredients: z.array(SharedIngredientSchema),
  method: z.string().nullable(),
  nutrition: RecipeNutritionSchema,
  /** Display names for the nutrient keys, so the page reads without the food catalog. */
  nutrientNames: z.record(z.string(), z.string()),
  source: z.object({ name: z.string(), url: z.string() }),
  sharedAt: z.string(),
  expiresAt: z.string().nullable(),
});

export const ShareSchema = z.object({
  shareId: z.uuid(),
  recipeId: z.uuid(),
  recipeVersion: z.number().int().positive(),
  title: z.string(),
  includeMethod: z.boolean(),
  url: z.string(),
  createdAt: z.string(),
  expiresAt: z.string().nullable(),
});

export const ErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    requestId: z.string(),
    details: z.unknown().optional(),
  }),
});

export type RecipeIngredientInput = z.infer<typeof RecipeIngredientSchema>;
export type RecipeBody = z.infer<typeof RecipeBodySchema>;
export type RecipeImage = z.infer<typeof RecipeImageSchema>;
export type PhotoSearchResult = z.infer<typeof PhotoSearchResultSchema>;
export type Recipe = z.infer<typeof RecipeSchema>;
export type RecipeNutritionDto = z.infer<typeof RecipeNutritionSchema>;
export type MealSlot = z.infer<typeof MealSlotSchema>;
export type PlannedMealBody = z.infer<typeof PlannedMealBodySchema>;
export type PlannedMeal = z.infer<typeof PlannedMealSchema>;
export type MealLogBody = z.infer<typeof MealLogBodySchema>;
export type MealLog = z.infer<typeof MealLogSchema>;
export type SyncOperation = z.infer<typeof SyncOperationSchema>;
export type SyncBatchRequest = z.infer<typeof SyncBatchRequestSchema>;
export type SyncResult = z.infer<typeof SyncResultSchema>;
export type SyncBatchResponse = z.infer<typeof SyncBatchResponseSchema>;
export type SyncChange = z.infer<typeof SyncChangeSchema>;
export type SyncChangesResponse = z.infer<typeof SyncChangesResponseSchema>;
export type ShareCreate = z.input<typeof ShareCreateSchema>;
export type SharedRecipe = z.infer<typeof SharedRecipeSchema>;
export type Share = z.infer<typeof ShareSchema>;
