import { z } from "zod";

/**
 * Groups: a family, or a nutritionist with clients. The owner and admins plan meals for members;
 * members see them and propose their own for approval. Kids are profiles: no login, owned by the
 * account that created them. Group screens work online; plans reach members through sync.
 *
 * Shapes that also appear in the sync contracts (plans, logs, preferences) are imported from
 * index.ts by the API routes; this file holds only the group-specific ones.
 */

const trimmed = (max: number) => z.string().trim().max(max);
const LocalDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");

export const GroupRoleSchema = z.enum(["owner", "admin", "member"]);
/** A name the person chooses for this group; other members never see their email. */
export const GroupDisplayNameSchema = trimmed(60).min(1, "Choose a name the group will see");

export const GroupSummarySchema = z.object({
  id: z.uuid(),
  name: z.string(),
  role: GroupRoleSchema,
  memberCount: z.number().int(),
});

export const GroupMemberSchema = z.object({
  /** The membership id, used in member routes. */
  id: z.uuid(),
  kind: z.enum(["person", "profile"]),
  /** Account id for a person; null for a profile. */
  userId: z.uuid().nullable(),
  profileId: z.uuid().nullable(),
  name: z.string(),
  role: GroupRoleSchema,
  isMe: z.boolean(),
  /** A profile you own (you can log meals for it on your own device). */
  ownedByMe: z.boolean(),
});

export const GroupInviteSchema = z.object({
  id: z.uuid(),
  role: z.enum(["admin", "member"]),
  /** Link to open in the app; anyone holding it can join until it is used, revoked or expires. */
  url: z.string(),
  createdAt: z.string(),
  expiresAt: z.string(),
});

/** Someone an admin added by email who hasn't joined yet. Only admins and the owner see these. */
export const PendingMemberSchema = z.object({
  id: z.uuid(),
  email: z.string(),
  name: z.string(),
  role: z.enum(["admin", "member"]),
  invitedAt: z.string(),
  /** When the invite email last went out; null if sending failed. */
  emailedAt: z.string().nullable(),
  expiresAt: z.string(),
});

export const GroupDetailSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  role: GroupRoleSchema,
  members: z.array(GroupMemberSchema),
  /** Open invite links; only admins and the owner see them. */
  invites: z.array(GroupInviteSchema),
  /** People added by email who haven't joined; only admins and the owner see them. */
  pending: z.array(PendingMemberSchema),
  /** Which group features this server has switched on. */
  features: z.object({ emailInvites: z.boolean(), mealShares: z.boolean() }),
});

export const GroupCreateSchema = z.object({
  name: trimmed(80).min(1, "Give the group a name"),
  myName: GroupDisplayNameSchema,
});

export const GroupUpdateSchema = z.object({ name: trimmed(80).min(1, "Give the group a name") });

export const InviteCreateSchema = z.object({ role: z.enum(["admin", "member"]) });

export const InvitePreviewSchema = z.object({
  groupName: z.string(),
  role: z.enum(["admin", "member"]),
  invitedBy: z.string(),
  expiresAt: z.string(),
});

export const InviteAcceptSchema = z.object({ myName: GroupDisplayNameSchema });

export const PENDING_INVITE_DAYS = 30;

/** Add someone by email before they have an account; the app emails them once. */
export const PendingMemberCreateSchema = z.object({
  email: z.string().trim().toLowerCase().max(254).pipe(z.email("Enter an email address")),
  /** How the group will see them until they choose their own name. */
  name: GroupDisplayNameSchema,
  role: z.enum(["admin", "member"]),
});

export const PendingMemberCreatedSchema = z.object({
  group: GroupDetailSchema,
  /** False when the invite email could not be sent; the admin can try again. */
  emailed: z.boolean(),
});

/** A group that added the signed-in person by email, waiting for them to join. */
export const MyGroupInviteSchema = z.object({
  id: z.uuid(),
  groupName: z.string(),
  role: z.enum(["admin", "member"]),
  invitedBy: z.string(),
  /** The name the admin used for them; they can change it when joining. */
  suggestedName: z.string(),
  expiresAt: z.string(),
});

export const ProfileCreateSchema = z.object({
  id: z.uuid().optional(),
  name: trimmed(60).min(1, "Give the profile a name"),
});

/** Adds a profile you already own to another group you own. */
export const MemberAddSchema = z.object({ profileId: z.uuid() });

export const MemberUpdateSchema = z.object({ role: z.enum(["admin", "member"]) });

export const GroupPlanCreateSchema = z.object({
  id: z.uuid().optional(),
  /** Membership id of the person or profile the meal is for. */
  memberId: z.uuid(),
  date: LocalDate,
  slot: z.enum(["breakfast", "lunch", "dinner", "snack"]),
  /** A recipe of this group. */
  recipeId: z.uuid(),
  servings: z.number().positive().max(100),
});

export const GroupPlanUpdateSchema = GroupPlanCreateSchema.omit({ id: true, memberId: true });

/** An alert, never a block: allergens the person listed that the recipe's foods are tagged with. */
export const AllergenAlertSchema = z.object({
  matches: z.array(z.string()),
  /** The recipe has prepared or unchecked foods that may contain more than their names show. */
  possible: z.boolean(),
  rulesVersion: z.string(),
});

export const GroupRecipeCopySchema = z.object({ recipeId: z.uuid() });

// ---------- shared meals ----------

/** Nutrients on a shared meal card, per serving, in this order. */
export const SHARED_MEAL_NUTRIENTS = ["energy_kcal", "protein", "carbohydrate", "fat_total", "fiber", "sugars_total", "sodium"] as const;
/** Matches a recipe's description, so the whole of it can be shared. */
export const SHARED_MEAL_SUMMARY_MAX = 500;
export const MEAL_COMMENT_MAX = 280;

export const MealShareCreateSchema = z.object({
  /** One of my recipes or one of the group's, with a nutrition estimate. */
  recipeId: z.uuid(),
  /** A short description; defaults to the recipe's own description. */
  summary: trimmed(SHARED_MEAL_SUMMARY_MAX).optional(),
  /** The recipe's photo, or one of my images; null for no photo. Omit to keep the recipe's photo. */
  imageId: z.uuid().nullable().optional(),
});

export const MealShareUpdateSchema = z.object({
  summary: trimmed(SHARED_MEAL_SUMMARY_MAX).optional(),
  imageId: z.uuid().nullable().optional(),
});

export const MealReactionKindSchema = z.enum(["like", "dislike"]);
export const MealReactionBodySchema = z.object({
  reaction: MealReactionKindSchema,
  comment: trimmed(MEAL_COMMENT_MAX).default(""),
});

export const SharedMealNutrientSchema = z.object({
  key: z.string(),
  name: z.string(),
  amount: z.number().nullable(),
  unit: z.string(),
  status: z.enum(["known", "partial", "unknown"]),
});

export const SharedMealReactionSchema = z.object({
  memberId: z.uuid(),
  name: z.string(),
  reaction: MealReactionKindSchema,
  comment: z.string(),
  updatedAt: z.string(),
});

export const SharedMealSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  summary: z.string(),
  /** Estimated, per serving; "unknown" means the source has no value, not zero. */
  nutrients: z.array(SharedMealNutrientSchema),
  image: z
    .object({
      url: z.string(),
      alt: z.string(),
      kind: z.enum(["photo", "generated", "upload"]),
      credit: z.any().nullable(),
      generator: z.object({ provider: z.literal("openai"), model: z.string() }).nullable(),
    })
    .nullable(),
  sharedBy: z.string(),
  sharedAt: z.string(),
  myReaction: z.object({ reaction: MealReactionKindSchema, comment: z.string() }).nullable(),
  /** Everyone's reactions and comments; only admins and the owner get these. */
  reactions: z.array(SharedMealReactionSchema).nullable(),
});

export const SharedMealListSchema = z.object({ meals: z.array(SharedMealSchema), nextCursor: z.string().nullable() });

/** Groups with shared meals I haven't reacted to. */
export const MealsToReviewSchema = z.object({
  groups: z.array(z.object({ groupId: z.uuid(), groupName: z.string(), count: z.number().int() })),
});

export type GroupRole = z.infer<typeof GroupRoleSchema>;
export type GroupSummary = z.infer<typeof GroupSummarySchema>;
export type GroupMember = z.infer<typeof GroupMemberSchema>;
export type GroupInvite = z.infer<typeof GroupInviteSchema>;
export type GroupDetail = z.infer<typeof GroupDetailSchema>;
export type InvitePreview = z.infer<typeof InvitePreviewSchema>;
export type GroupPlanCreate = z.infer<typeof GroupPlanCreateSchema>;
export type GroupPlanUpdate = z.infer<typeof GroupPlanUpdateSchema>;
export type AllergenAlert = z.infer<typeof AllergenAlertSchema>;
export type PendingMember = z.infer<typeof PendingMemberSchema>;
export type MyGroupInvite = z.infer<typeof MyGroupInviteSchema>;
export type SharedMeal = z.infer<typeof SharedMealSchema>;
export type MealReactionKind = z.infer<typeof MealReactionKindSchema>;
export type MealsToReview = z.infer<typeof MealsToReviewSchema>;
