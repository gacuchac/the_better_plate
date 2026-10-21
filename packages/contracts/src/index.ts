import { z } from "zod";

/** Shared wire contracts for the API and its clients. The API's OpenAPI document is generated from these. */

export { PRIVACY_NOTICE } from "./privacy.ts";
export * from "./ai.ts";
export * from "./groups.ts";

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
  /** photo: openly licensed (Openverse); generated: AI; upload: the person's own, rights confirmed by them. */
  kind: z.enum(["photo", "generated", "upload"]),
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

/** Base64 of the original file; the server checks it is an image and re-encodes it. */
export const MAX_UPLOAD_BASE64 = 12_000_000;
export const ImageUploadSchema = z.object({
  data: z.string().min(1).max(MAX_UPLOAD_BASE64),
  alt: trimmed(200).optional(),
  /** The person confirms they took the photo or have the right to use it. */
  rightsConfirmed: z.literal(true),
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
  /** Set for a group recipe: every member can read it, the group's admins can edit it. */
  groupId: z.uuid().nullable(),
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
  /** For one of the account's profiles (a child without a login); null or absent for the account itself. */
  profileId: z.uuid().nullable().optional(),
});

/**
 * planned: on the plan. proposed: a group member planned it and an admin has not approved it yet.
 * declined: an admin did not approve it.
 */
export const PlanStatusSchema = z.enum(["planned", "proposed", "declined"]);

export const PlannedMealSchema = PlannedMealBodySchema.extend({
  id: z.uuid(),
  version: z.number().int().positive(),
  createdAt: z.string(),
  updatedAt: z.string(),
  status: PlanStatusSchema,
  /** The group whose admin planned it, if any; members cannot change those plans. */
  groupId: z.uuid().nullable(),
  /** Who last planned it (an account id), and the name they use in that group. */
  authorId: z.uuid().nullable(),
  plannedBy: z.string().nullable(),
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
  /** Eaten by one of the account's profiles; null or absent for the account itself. */
  profileId: z.uuid().nullable().optional(),
});

export const MealLogSchema = MealLogBodySchema.extend({
  id: z.uuid(),
  createdAt: z.string(),
  /** Immutable nutrition snapshot of the recipe at logging time. */
  nutrition: RecipeNutritionSchema,
  /** perServing × servings eaten; partial and unknown statuses carry through. */
  eaten: z.array(NutrientTotalSchema),
});

// ---------- water: drinks the person logs ----------

/** A drink of water the person logged. Create-only like eaten meals; separate drinks are never coalesced. */
export const WaterLogBodySchema = z.object({
  /** Millilitres drunk (1 ml of water weighs 1 g). */
  amountMl: z.number().int().min(1).max(5000),
  localDate: LocalDateSchema,
  drankAt: z.iso.datetime({ offset: true }),
});

export const WaterLogSchema = WaterLogBodySchema.extend({
  id: z.uuid(),
  createdAt: z.string(),
});

// ---------- food preferences and feedback: only what people tell us ----------

/**
 * The nine major food allergens in US law (FALCPA, FASTER Act). Allergies are self-reported; the
 * app never infers, diagnoses or tests for them. Kept equal to ALLERGENS in @betterplate/nutrition.
 */
export const AllergenSchema = z.enum(["milk", "egg", "fish", "shellfish", "tree_nuts", "peanut", "wheat", "soy", "sesame"]);
export const FoodIdSchema = z.string().regex(/^fdc:\d{1,9}$/, "foodId must look like fdc:<id>");
export const MAX_PREFERENCE_FOODS = 200;

export const FoodPreferencesBodySchema = z
  .object({
    /** listed: the allergies below; none: told us they have none; prefer_not: chose not to say. */
    allergyAnswer: z.enum(["listed", "none", "prefer_not"]),
    allergens: z.array(AllergenSchema).max(9),
    likes: z.array(FoodIdSchema).max(MAX_PREFERENCE_FOODS),
    dislikes: z.array(FoodIdSchema).max(MAX_PREFERENCE_FOODS),
    notes: trimmed(1000).default(""),
    /** For one of the account's profiles; null or absent for the account itself. */
    profileId: z.uuid().nullable().optional(),
  })
  .refine((p) => p.allergyAnswer === "listed" || p.allergens.length === 0, { message: "List allergens only with allergyAnswer \"listed\"", path: ["allergens"] })
  .refine((p) => p.allergyAnswer !== "listed" || p.allergens.length > 0, { message: "Pick at least one allergen, or answer \"none\"", path: ["allergens"] });

/** id is the person: the account's own id, or the profile's id. */
export const FoodPreferencesSchema = z.object({
  id: z.uuid(),
  allergyAnswer: z.enum(["listed", "none", "prefer_not"]),
  allergens: z.array(AllergenSchema),
  likes: z.array(FoodIdSchema),
  dislikes: z.array(FoodIdSchema),
  notes: z.string(),
  profileId: z.uuid().nullable(),
  version: z.number().int().positive(),
  updatedAt: z.string(),
});

/** After eating: liked it or not, a comment, and the ingredients they did not like. id is the eaten log's id. */
export const MealFeedbackBodySchema = z.object({
  rating: z.enum(["liked", "disliked"]).nullable(),
  comment: trimmed(1000).default(""),
  dislikedFoodIds: z.array(FoodIdSchema).max(100).default([]),
});

export const MealFeedbackSchema = MealFeedbackBodySchema.extend({
  id: z.uuid(),
  profileId: z.uuid().nullable(),
  version: z.number().int().positive(),
  updatedAt: z.string(),
});

/** A child or other person without a login, owned by the account that created it. */
export const ProfileSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  version: z.number().int().positive(),
  createdAt: z.string(),
});

// ---------- shopping list: what to buy for planned meals ----------

export const ShoppingItemSchema = z.object({
  foodId: z.string(),
  description: z.string(),
  category: z.string().nullable(),
  /** Grams to buy, unrounded; null when no amount could be worked out. */
  grams: z.number().nullable(),
  unresolved: z.number().int(),
  oil: z.boolean(),
  /** Listed cooked in the recipe; bought raw, so the weight to buy differs. */
  preparedForm: z.boolean(),
  recipes: z.array(z.string()),
});

export const ShoppingListSchema = z.object({
  from: LocalDateSchema,
  to: LocalDateSchema,
  items: z.array(ShoppingItemSchema),
  plans: z.number().int(),
  missing: z.array(z.object({ planId: z.uuid(), date: LocalDateSchema, title: z.string() })),
  unknownFoods: z.array(z.string()),
  /** Plans waiting for an admin's approval, not included in the list. */
  awaitingApproval: z.number().int(),
});

// ---------- goals: the person's own consumption goals (never body data) ----------

export const GoalKindSchema = z.enum(["at_least", "at_most", "between"]);
export const GoalPeriodSchema = z.enum(["day", "week", "month"]);

/**
 * A goal on what the person eats, in their own numbers: a nutrient, at least / at most / between,
 * per day, week (Monday to Sunday) or calendar month, from a start date to an optional end date.
 * The server checks the bounds fit the kind and the nutrient and unit exist in the catalog.
 */
export const GoalBodySchema = z.object({
  nutrientKey: z.string().min(1).max(40),
  unit: z.string().min(1).max(10),
  kind: GoalKindSchema,
  min: z.number().positive().max(1_000_000).nullable(),
  max: z.number().positive().max(1_000_000).nullable(),
  period: GoalPeriodSchema,
  startDate: LocalDateSchema,
  endDate: LocalDateSchema.nullable(),
});

export const GoalSchema = GoalBodySchema.extend({
  id: z.uuid(),
  version: z.number().int().positive(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const MAX_GOALS = 50;

/** What was eaten over a range of days: logged meals only, plans never count. */
export const NutritionSummarySchema = z.object({
  from: LocalDateSchema,
  to: LocalDateSchema,
  days: z.number().int(),
  daysLogged: z.number().int(),
  /** Some days in the range have nothing logged; totals cover only logged days. */
  incomplete: z.boolean(),
  nutrients: z.array(
    z.object({
      key: z.string(),
      unit: z.string(),
      total: z.number().nullable(),
      averagePerLoggedDay: z.number().nullable(),
      status: z.enum(["known", "partial", "unknown"]),
    }),
  ),
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
  z.object({
    opId: z.uuid(),
    type: z.literal("goal.put"),
    entityId: z.uuid(),
    baseVersion: z.number().int().positive().nullable(),
    body: GoalBodySchema,
  }),
  z.object({
    opId: z.uuid(),
    type: z.literal("goal.delete"),
    entityId: z.uuid(),
    baseVersion: z.number().int().positive().nullable(),
  }),
  /** Create-only, like eaten meals: a drink is never edited, only removed. */
  z.object({
    opId: z.uuid(),
    type: z.literal("water.create"),
    entityId: z.uuid(),
    body: WaterLogBodySchema,
  }),
  z.object({
    opId: z.uuid(),
    type: z.literal("water.delete"),
    entityId: z.uuid(),
  }),
  /** entityId is the person: the account's own id, or one of its profiles' ids (with body.profileId). */
  z.object({
    opId: z.uuid(),
    type: z.literal("prefs.put"),
    entityId: z.uuid(),
    baseVersion: z.number().int().positive().nullable(),
    body: FoodPreferencesBodySchema,
  }),
  /** entityId is the eaten log's id. */
  z.object({
    opId: z.uuid(),
    type: z.literal("feedback.put"),
    entityId: z.uuid(),
    baseVersion: z.number().int().positive().nullable(),
    body: MealFeedbackBodySchema,
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
  /** Current server copy of a goal on conflict (null if deleted). */
  serverGoal: GoalSchema.nullable().optional(),
  /** Current server copy of preferences on conflict. */
  serverPreferences: FoodPreferencesSchema.nullable().optional(),
  /** Current server copy of meal feedback on conflict. */
  serverFeedback: MealFeedbackSchema.nullable().optional(),
  error: z.object({ code: z.string(), message: z.string() }).optional(),
});

export const SyncBatchResponseSchema = z.object({
  protocol: z.literal(1),
  results: z.array(SyncResultSchema),
});

export const SyncChangeSchema = z.object({
  entity: z.enum(["recipe", "planned_meal", "meal_log", "goal", "preferences", "meal_feedback", "profile", "water_log"]),
  entityId: z.uuid(),
  seq: z.string(),
  deleted: z.boolean(),
  recipe: RecipeSchema.nullable(),
  plannedMeal: PlannedMealSchema.nullable().optional(),
  mealLog: MealLogSchema.nullable().optional(),
  goal: GoalSchema.nullable().optional(),
  preferences: FoodPreferencesSchema.nullable().optional(),
  feedback: MealFeedbackSchema.nullable().optional(),
  profile: ProfileSchema.nullable().optional(),
  waterLog: WaterLogSchema.nullable().optional(),
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
  /** The recipe's photo, with its credit or AI label; shared only when the owner ticks it. */
  includeImage: z.boolean().default(false),
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
  /** The photo the owner chose to share; `url` serves it without sign-in until the link stops working. */
  image: RecipeImageSchema.omit({ id: true }).extend({ url: z.string() }).nullable(),
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
  includeImage: z.boolean(),
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
export type GoalBody = z.infer<typeof GoalBodySchema>;
export type WaterLogBody = z.infer<typeof WaterLogBodySchema>;
export type WaterLog = z.infer<typeof WaterLogSchema>;
export type Goal = z.infer<typeof GoalSchema>;
export type NutritionSummary = z.infer<typeof NutritionSummarySchema>;
export type SyncOperation = z.infer<typeof SyncOperationSchema>;
export type SyncBatchRequest = z.infer<typeof SyncBatchRequestSchema>;
export type SyncResult = z.infer<typeof SyncResultSchema>;
export type SyncBatchResponse = z.infer<typeof SyncBatchResponseSchema>;
export type SyncChange = z.infer<typeof SyncChangeSchema>;
export type SyncChangesResponse = z.infer<typeof SyncChangesResponseSchema>;
export type ShareCreate = z.input<typeof ShareCreateSchema>;
export type Allergen = z.infer<typeof AllergenSchema>;
export type PlanStatus = z.infer<typeof PlanStatusSchema>;
export type FoodPreferencesBody = z.input<typeof FoodPreferencesBodySchema>;
export type FoodPreferences = z.infer<typeof FoodPreferencesSchema>;
export type MealFeedbackBody = z.infer<typeof MealFeedbackBodySchema>;
export type MealFeedback = z.infer<typeof MealFeedbackSchema>;
export type Profile = z.infer<typeof ProfileSchema>;
export type ShoppingList = z.infer<typeof ShoppingListSchema>;
export type SharedRecipe = z.infer<typeof SharedRecipeSchema>;
export type Share = z.infer<typeof ShareSchema>;
