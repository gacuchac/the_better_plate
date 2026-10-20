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

export const GroupDetailSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  role: GroupRoleSchema,
  members: z.array(GroupMemberSchema),
  /** Open invite links; only admins and the owner see them. */
  invites: z.array(GroupInviteSchema),
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

export type GroupRole = z.infer<typeof GroupRoleSchema>;
export type GroupSummary = z.infer<typeof GroupSummarySchema>;
export type GroupMember = z.infer<typeof GroupMemberSchema>;
export type GroupInvite = z.infer<typeof GroupInviteSchema>;
export type GroupDetail = z.infer<typeof GroupDetailSchema>;
export type InvitePreview = z.infer<typeof InvitePreviewSchema>;
export type GroupPlanCreate = z.infer<typeof GroupPlanCreateSchema>;
export type GroupPlanUpdate = z.infer<typeof GroupPlanUpdateSchema>;
export type AllergenAlert = z.infer<typeof AllergenAlertSchema>;
