import { z } from "zod";

/**
 * Cook profile (FEATURE_COOK_PROFILE_ENABLED): a person who cooks for others keeps each cooked
 * meal with its recipes, the groceries bought for it, the time spent and other costs, and adds
 * meals up into statements. Money is integer cents in the cook's currency (USD unless they change
 * it). No tax is added to the cook's services; tax on a grocery receipt is spread over its billed
 * lines. The app takes no payments.
 */

const trimmed = (max: number) => z.string().trim().max(max);
const LocalDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
const FoodId = z.string().regex(/^fdc:\d{1,9}$/);
const Cents = z.number().int().min(0).max(10_000_000);

export const CURRENCIES = ["USD", "EUR", "GBP", "CAD", "AUD", "MXN", "CLP", "ARS", "COP", "PEN", "BRL"] as const;
export const CurrencySchema = z.enum(CURRENCIES);

export const CookProfileBodySchema = z.object({
  businessName: trimmed(80).default(""),
  currency: CurrencySchema.default("USD"),
  /** Default hourly rate for cooking, shopping and travel time; null means time isn't charged. */
  hourlyRateCents: Cents.nullable().default(null),
  /** Optional fee per meal. */
  flatFeeCents: Cents.nullable().default(null),
});
export const CookProfileSchema = CookProfileBodySchema.extend({ createdAt: z.string() });
export const CookProfileStateSchema = z.object({
  profile: CookProfileSchema.nullable(),
  features: z.object({ clientInvites: z.boolean() }),
});

// ---------------------------------------------------------------- clients

export const CookClientBodySchema = z.object({
  id: z.uuid().optional(),
  name: trimmed(80).min(1, "Give the client a name"),
  /** The cook's own notes, allergies included. Only the cook sees them. */
  notes: trimmed(2000).default(""),
  /** Overrides the cook's default hourly rate for this client. */
  hourlyRateCents: Cents.nullable().default(null),
});
export const CookClientSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  notes: z.string(),
  hourlyRateCents: Cents.nullable(),
  /** Email the client was invited at, until they accept or it lapses (30 days). */
  inviteEmail: z.string().nullable(),
  invitedAt: z.string().nullable(),
  /** Set once the invited person accepted; their own preferences then apply. */
  linked: z.boolean(),
  linkedAt: z.string().nullable(),
  createdAt: z.string(),
});
export const CookClientInviteSchema = z.object({ email: z.email().max(254) });

// ---------------------------------------------------------------- who the cook is cooking for

export const CookTargetKindSchema = z.enum(["me", "group", "member", "client"]);
export const CookTargetRefSchema = z.object({
  kind: CookTargetKindSchema,
  groupId: z.uuid().nullable().optional(),
  memberId: z.uuid().nullable().optional(),
  clientId: z.uuid().nullable().optional(),
});

/** What the cook may know about the food needs of a target. Never meals eaten or goals. */
export const CookAllergyInfoSchema = z.object({
  /** Combined allergens of everyone the meal is for (named or not). */
  allergens: z.array(z.string()),
  /** Per person, only where the cook may see names: themselves, a group they run, one member, a client. */
  people: z.array(z.object({ name: z.string(), allergyAnswer: z.enum(["listed", "none", "prefer_not", "unknown"]), allergens: z.array(z.string()), notes: z.string() })),
  /** True when the allergens are combined without names (a plain member cooking for their group). */
  anonymous: z.boolean(),
});

export const CookTargetSchema = CookTargetRefSchema.extend({
  /** Stable key for the picker, e.g. "group:<id>". */
  key: z.string(),
  name: z.string(),
  /** Group the member belongs to, for display. */
  groupName: z.string().nullable(),
  info: CookAllergyInfoSchema,
  hourlyRateCents: Cents.nullable(),
});
export const CookTargetsSchema = z.object({ targets: z.array(CookTargetSchema) });

// ---------------------------------------------------------------- meals

export const CookMealCreateSchema = z.object({
  id: z.uuid(),
  name: trimmed(120).min(1),
  cookedOn: LocalDate,
  target: CookTargetRefSchema,
  /** Adds this recipe straight away (from the Cook button). */
  recipeId: z.uuid().optional(),
  servings: z.number().positive().max(1000).optional(),
});
export const CookMealUpdateSchema = z.object({
  name: trimmed(120).min(1).optional(),
  cookedOn: LocalDate.optional(),
  notes: trimmed(2000).optional(),
  hourlyRateCents: Cents.nullable().optional(),
  flatFeeCents: Cents.nullable().optional(),
  /** Cooking time typed in (replaces what the timer counted). */
  cookingMinutes: z.number().int().min(0).max(14_400).optional(),
  shoppingMinutes: z.number().int().min(0).max(14_400).optional(),
  travelMinutes: z.number().int().min(0).max(14_400).optional(),
});
export const CookMealRecipeAddSchema = z.object({ recipeId: z.uuid(), servings: z.number().positive().max(1000) });
export const CookTimerSchema = z.object({ action: z.enum(["start", "pause", "stop"]) });
export const CookExpenseBodySchema = z.object({ label: trimmed(120).min(1), amountCents: Cents });

export const CookIngredientCostSchema = z.object({
  foodId: FoodId,
  description: z.string(),
  grams: z.number().nullable(),
  /** receipt: bought for this meal on a receipt; price_list: from the cook's price list; none: no price known. */
  source: z.enum(["receipt", "price_list", "none"]),
  costCents: z.number().int().nullable(),
});
export const CookMealRecipeSchema = z.object({
  id: z.uuid(),
  recipeId: z.uuid().nullable(),
  title: z.string(),
  description: z.string(),
  servings: z.number(),
  /** Groceries priced from the cook's price list for the ingredients no receipt line covers. */
  ingredients: z.array(CookIngredientCostSchema),
});
export const CookReceiptLineRefSchema = z.object({
  id: z.uuid(),
  receiptId: z.uuid(),
  store: z.string(),
  purchasedOn: z.string().nullable(),
  text: z.string(),
  foodId: FoodId.nullable(),
  priceCents: z.number().int(),
  taxCents: z.number().int(),
});
export const CookExpenseSchema = z.object({ id: z.uuid(), label: z.string(), amountCents: z.number().int() });

export const CookTotalsSchema = z.object({
  /** Receipt lines assigned to the meal, with their share of the receipt's tax. */
  receiptCents: z.number().int(),
  /** Ingredients no receipt covers, at the cook's saved price. */
  pantryCents: z.number().int(),
  groceriesCents: z.number().int(),
  /** Ingredients with no price at all; groceries are then a lower bound. */
  unpricedIngredients: z.number().int(),
  expensesCents: z.number().int(),
  minutes: z.object({ cooking: z.number().int(), shopping: z.number().int(), travel: z.number().int(), total: z.number().int() }),
  timeCents: z.number().int(),
  flatFeeCents: z.number().int(),
  totalCents: z.number().int(),
});

export const CookMealSummarySchema = z.object({
  id: z.uuid(),
  name: z.string(),
  cookedOn: z.string(),
  target: CookTargetRefSchema.extend({ name: z.string() }),
  recipeTitles: z.array(z.string()),
  totals: CookTotalsSchema,
  /** The statement it is on (not void), if any. */
  statementId: z.uuid().nullable(),
  shared: z.boolean(),
  timerRunning: z.boolean(),
});

export const CookMealSchema = CookMealSummarySchema.extend({
  notes: z.string(),
  hourlyRateCents: Cents.nullable(),
  flatFeeCents: Cents.nullable(),
  timerStartedAt: z.string().nullable(),
  cookingSeconds: z.number().int(),
  shoppingMinutes: z.number().int(),
  travelMinutes: z.number().int(),
  recipes: z.array(CookMealRecipeSchema),
  receiptLines: z.array(CookReceiptLineRefSchema),
  expenses: z.array(CookExpenseSchema),
  currency: CurrencySchema,
  /** Locked once the meal is on a sent or paid statement. */
  locked: z.boolean(),
});
export const CookMealListSchema = z.object({ meals: z.array(CookMealSummarySchema), currency: CurrencySchema });

export const CookShoppingItemSchema = z.object({
  foodId: FoodId,
  description: z.string(),
  grams: z.number().nullable(),
  /** Already on a receipt assigned to this meal. */
  bought: z.boolean(),
  estimateCents: z.number().int().nullable(),
});
export const CookShoppingListSchema = z.object({ items: z.array(CookShoppingItemSchema), estimateCents: z.number().int(), currency: CurrencySchema });

// ---------------------------------------------------------------- receipts and prices

export const MAX_RECEIPTS_PER_COOK = 300;
export const CookReceiptReadSchema = z.object({ image: z.string().min(1).max(8_000_000) });
export const CookReceiptLineBodySchema = z.object({
  id: z.uuid(),
  text: trimmed(200).min(1),
  priceCents: z.number().int().min(-10_000_000).max(10_000_000),
  foodId: FoodId.nullable(),
  grams: z.number().positive().max(1_000_000).nullable(),
  mealId: z.uuid().nullable(),
  personal: z.boolean(),
});
export const CookReceiptBodySchema = z.object({
  store: trimmed(120).default(""),
  purchasedOn: LocalDate.nullable(),
  subtotalCents: z.number().int().min(0).max(100_000_000).nullable(),
  taxCents: z.number().int().min(0).max(100_000_000),
  totalCents: z.number().int().min(0).max(100_000_000).nullable(),
  lines: z.array(CookReceiptLineBodySchema).max(200),
});
export const CookReceiptLineSchema = CookReceiptLineBodySchema.extend({
  taxCents: z.number().int(),
  /** Catalog matches for picking another food. */
  candidates: z.array(z.object({ foodId: FoodId, description: z.string() })),
  foodDescription: z.string().nullable(),
});
export const CookReceiptSchema = z.object({
  id: z.uuid(),
  store: z.string(),
  purchasedOn: z.string().nullable(),
  subtotalCents: z.number().int().nullable(),
  taxCents: z.number().int(),
  totalCents: z.number().int().nullable(),
  status: z.enum(["draft", "confirmed"]),
  hasImage: z.boolean(),
  lines: z.array(CookReceiptLineSchema),
  /** Lines plus tax minus total; must be 0 to confirm. */
  differenceCents: z.number().int().nullable(),
  createdAt: z.string(),
  currency: CurrencySchema,
});
export const CookReceiptSummarySchema = CookReceiptSchema.omit({ lines: true }).extend({ lineCount: z.number().int(), unassigned: z.number().int() });
export const CookReceiptListSchema = z.object({ receipts: z.array(CookReceiptSummarySchema) });

export const CookPriceSchema = z.object({ foodId: FoodId, description: z.string(), centsPerKg: z.number(), source: z.enum(["receipt", "manual"]), updatedAt: z.string() });
export const CookPriceListSchema = z.object({ prices: z.array(CookPriceSchema), currency: CurrencySchema });
export const CookPriceBodySchema = z.object({ centsPerKg: z.number().min(0).max(100_000_000) });

// ---------------------------------------------------------------- sharing and statements

/** The basics (meal name, date, servings, recipes with their description) are always shared. */
export const CookSharePartsSchema = z.object({
  groceries: z.boolean().default(false),
  time: z.boolean().default(false),
  totals: z.boolean().default(false),
});
export const CookShareBodySchema = z.object({
  parts: CookSharePartsSchema,
  /** A link anyone can open, until sharing stops. */
  link: z.boolean().default(false),
});

export const CookSharedMealSchema = z.object({
  name: z.string(),
  cookedOn: z.string(),
  cookName: z.string(),
  recipes: z.array(z.object({ title: z.string(), description: z.string(), servings: z.number() })),
  groceries: z.object({ lines: z.array(z.object({ text: z.string(), costCents: z.number().int() })), totalCents: z.number().int() }).nullable(),
  time: z.object({ minutes: z.number().int(), costCents: z.number().int() }).nullable(),
  totals: z.object({ expensesCents: z.number().int(), flatFeeCents: z.number().int(), totalCents: z.number().int() }).nullable(),
  currency: CurrencySchema,
});
export const CookSharedStatementSchema = z.object({
  title: z.string(),
  cookName: z.string(),
  status: z.enum(["sent", "paid"]),
  sentAt: z.string().nullable(),
  meals: z.array(CookSharedMealSchema),
  totals: z.object({ groceriesCents: z.number().int(), timeCents: z.number().int(), expensesCents: z.number().int(), flatFeeCents: z.number().int(), totalCents: z.number().int() }).nullable(),
  currency: CurrencySchema,
});
export const CookShareStatusSchema = z.object({
  parts: CookSharePartsSchema,
  linkUrl: z.string().nullable(),
  /** Who sees it inside the app: the linked client, the group (money parts to its admins only). */
  audience: z.object({ client: z.boolean(), group: z.boolean() }),
  updatedAt: z.string(),
});
export const CookPublicShareSchema = z.object({ kind: z.enum(["meal", "statement"]), meal: CookSharedMealSchema.nullable(), statement: CookSharedStatementSchema.nullable() });

export const CookStatementCreateSchema = z.object({
  id: z.uuid(),
  title: trimmed(120).min(1),
  /** Meals to add up; all for the same target and not already billed. */
  mealIds: z.array(z.uuid()).min(1).max(200),
});
export const CookStatementUpdateSchema = z.object({ title: trimmed(120).min(1).optional(), mealIds: z.array(z.uuid()).min(1).max(200).optional() });
export const CookStatementSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  target: CookTargetRefSchema.extend({ name: z.string() }),
  status: z.enum(["draft", "sent", "paid", "void"]),
  meals: z.array(CookMealSummarySchema),
  totals: z.object({ groceriesCents: z.number().int(), timeCents: z.number().int(), expensesCents: z.number().int(), flatFeeCents: z.number().int(), totalCents: z.number().int(), minutes: z.number().int() }),
  sentAt: z.string().nullable(),
  paidAt: z.string().nullable(),
  shared: z.boolean(),
  createdAt: z.string(),
  currency: CurrencySchema,
});
export const CookStatementListSchema = z.object({ statements: z.array(CookStatementSchema.omit({ meals: true }).extend({ mealCount: z.number().int() })) });

// ---------------------------------------------------------------- the other side: clients and groups

export const MyCookInviteSchema = z.object({ id: z.uuid(), cookName: z.string(), clientName: z.string(), invitedAt: z.string() });
export const MyCookInvitesSchema = z.object({ invites: z.array(MyCookInviteSchema) });
export const MyCookSchema = z.object({
  clientId: z.uuid(),
  cookName: z.string(),
  linkedAt: z.string(),
  /** Every meal cooked for me, with only what the cook shared beyond its name and date. */
  meals: z.array(z.object({ id: z.uuid(), name: z.string(), cookedOn: z.string(), shared: CookSharedMealSchema.nullable() })),
  statements: z.array(CookSharedStatementSchema.extend({ id: z.uuid() })),
});
export const MyCooksSchema = z.object({ cooks: z.array(MyCookSchema) });
export const GroupCookedMealSchema = z.object({ id: z.uuid(), cookName: z.string(), meal: CookSharedMealSchema, mine: z.boolean() });
export const GroupCookedMealsSchema = z.object({ meals: z.array(GroupCookedMealSchema), memberShares: z.boolean() });

export type CookProfile = z.infer<typeof CookProfileSchema>;
export type CookProfileBody = z.input<typeof CookProfileBodySchema>;
export type CookProfileState = z.infer<typeof CookProfileStateSchema>;
export type CookClient = z.infer<typeof CookClientSchema>;
export type CookClientBody = z.input<typeof CookClientBodySchema>;
export type CookTargetRef = z.infer<typeof CookTargetRefSchema>;
export type CookTarget = z.infer<typeof CookTargetSchema>;
export type CookMeal = z.infer<typeof CookMealSchema>;
export type CookMealSummary = z.infer<typeof CookMealSummarySchema>;
export type CookMealUpdate = z.infer<typeof CookMealUpdateSchema>;
export type CookTotals = z.infer<typeof CookTotalsSchema>;
export type CookShoppingList = z.infer<typeof CookShoppingListSchema>;
export type CookReceipt = z.infer<typeof CookReceiptSchema>;
export type CookReceiptBody = z.infer<typeof CookReceiptBodySchema>;
export type CookReceiptSummary = z.infer<typeof CookReceiptSummarySchema>;
export type CookPrice = z.infer<typeof CookPriceSchema>;
export type CookShareParts = z.infer<typeof CookSharePartsSchema>;
export type CookShareStatus = z.infer<typeof CookShareStatusSchema>;
export type CookSharedMeal = z.infer<typeof CookSharedMealSchema>;
export type CookSharedStatement = z.infer<typeof CookSharedStatementSchema>;
export type CookPublicShare = z.infer<typeof CookPublicShareSchema>;
export type CookStatement = z.infer<typeof CookStatementSchema>;
export type CookStatementList = z.infer<typeof CookStatementListSchema>;
export type MyCookInvite = z.infer<typeof MyCookInviteSchema>;
export type MyCook = z.infer<typeof MyCookSchema>;
export type GroupCookedMeal = z.infer<typeof GroupCookedMealSchema>;
