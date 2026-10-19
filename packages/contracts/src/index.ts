import { z } from "zod";

/** Shared wire contracts for the API and its clients. The API's OpenAPI document is generated from these. */

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

export const RecipeBodySchema = z.object({
  title: trimmed(120).min(1, "Give the recipe a name"),
  servings: z.number().positive().max(100),
  ingredients: z.array(RecipeIngredientSchema).max(MAX_INGREDIENTS),
  method: trimmed(10_000).default(""),
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
  error: z.object({ code: z.string(), message: z.string() }).optional(),
});

export const SyncBatchResponseSchema = z.object({
  protocol: z.literal(1),
  results: z.array(SyncResultSchema),
});

export const SyncChangeSchema = z.object({
  entity: z.literal("recipe"),
  entityId: z.uuid(),
  seq: z.string(),
  deleted: z.boolean(),
  recipe: RecipeSchema.nullable(),
});

export const SyncChangesResponseSchema = z.object({
  changes: z.array(SyncChangeSchema),
  cursor: z.string(),
  hasMore: z.boolean(),
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
export type Recipe = z.infer<typeof RecipeSchema>;
export type RecipeNutritionDto = z.infer<typeof RecipeNutritionSchema>;
export type SyncOperation = z.infer<typeof SyncOperationSchema>;
export type SyncBatchRequest = z.infer<typeof SyncBatchRequestSchema>;
export type SyncResult = z.infer<typeof SyncResultSchema>;
export type SyncBatchResponse = z.infer<typeof SyncBatchResponseSchema>;
export type SyncChange = z.infer<typeof SyncChangeSchema>;
export type SyncChangesResponse = z.infer<typeof SyncChangesResponseSchema>;
