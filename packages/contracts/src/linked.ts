import { z } from "zod";

/**
 * Linked accounts (FEATURE_LINKED_ACCOUNTS_ENABLED, ADR-015): an account owner shares chosen
 * areas of their account with another person, one toggle per area, each off, view or change.
 * Only the owner sends the request; nothing is shared until the other person accepts. The other
 * person then switches into the account in the app (header X-Act-As) or names it on connector
 * calls. Every change they make there is in the owner's activity log.
 */

/** The areas an owner can share, in the order the app shows them. */
export const LINK_AREAS = [
  "recipes",
  "plans",
  "eaten",
  "goals",
  "preferences",
  "shopping",
  "children",
  "milestones",
  "groups",
  "companion",
] as const;
export const LinkAreaSchema = z.enum(LINK_AREAS);
export type LinkArea = z.infer<typeof LinkAreaSchema>;

export const LinkAccessSchema = z.enum(["off", "view", "change"]);
export type LinkAccess = z.infer<typeof LinkAccessSchema>;

/** Every area off; the starting point of every request. */
export const NO_ACCESS = Object.fromEntries(LINK_AREAS.map((a) => [a, "off"])) as Record<LinkArea, LinkAccess>;

export const LinkPermissionsSchema = z.object({
  areas: z.object({
    recipes: LinkAccessSchema.default("off"),
    plans: LinkAccessSchema.default("off"),
    eaten: LinkAccessSchema.default("off"),
    goals: LinkAccessSchema.default("off"),
    preferences: LinkAccessSchema.default("off"),
    shopping: LinkAccessSchema.default("off"),
    children: LinkAccessSchema.default("off"),
    milestones: LinkAccessSchema.default("off"),
    groups: LinkAccessSchema.default("off"),
    companion: LinkAccessSchema.default("off"),
  }),
  /** Lets the other person's connected AI apps (Claude, ChatGPT) use what the areas allow. Never adds access. */
  aiApps: z.boolean().default(false),
});
export type LinkPermissions = z.infer<typeof LinkPermissionsSchema>;

/** The companion is used, never just looked at: view and change mean the same there. */
export function allows(level: LinkAccess | undefined, needed: "view" | "change"): boolean {
  if (!level || level === "off") return false;
  return needed === "view" || level === "change";
}

export const LinkStatusSchema = z.enum(["requested", "active", "declined", "cancelled", "removed", "expired"]);
export type LinkStatus = z.infer<typeof LinkStatusSchema>;

/** Days a request waits for the other person before it lapses. */
export const LINK_REQUEST_DAYS = 14;
/** Live links (requested or active) one account can have, each way. */
export const MAX_LINKS = 10;
/** Requests one owner can send in 24 hours. */
export const LINK_REQUESTS_PER_DAY = 5;

export const LinkCreateSchema = z.object({
  email: z.email().max(254),
  permissions: LinkPermissionsSchema,
});
export const LinkUpdateSchema = z.object({ permissions: LinkPermissionsSchema });

const Person = z.object({ id: z.uuid().nullable(), name: z.string().nullable(), email: z.string() });

/** A link I gave (I'm the owner) or received (I can act in the owner's account). */
export const LinkSchema = z.object({
  id: z.uuid(),
  direction: z.enum(["given", "received"]),
  status: LinkStatusSchema,
  /** given: the person I share with; received: the account owner. */
  person: Person,
  permissions: LinkPermissionsSchema,
  createdAt: z.string(),
  expiresAt: z.string(),
  acceptedAt: z.string().nullable(),
  updatedAt: z.string(),
});
export type Link = z.infer<typeof LinkSchema>;

export const LinkedAccountsSchema = z.object({
  given: z.array(LinkSchema),
  received: z.array(LinkSchema),
});
export type LinkedAccounts = z.infer<typeof LinkedAccountsSchema>;

/** What an activity entry records; the app words each one. */
export const LINK_ACTIONS = [
  "recipe.save",
  "recipe.delete",
  "recipe.photo",
  "recipe.copy",
  "plan.save",
  "plan.delete",
  "meal.log",
  "meal.remove",
  "water.log",
  "water.remove",
  "feedback.save",
  "favorite.add",
  "favorite.remove",
  "goal.save",
  "goal.delete",
  "prefs.save",
  "profile.rename",
  "group.plan",
  "group.plan.change",
  "group.plan.remove",
  "group.plan.approve",
  "group.plan.decline",
  "group.recipe",
  "group.share",
  "group.share.change",
  "group.share.remove",
  "group.react",
  "group.comment.remove",
  "group.preferences",
  "group.welcome",
  "companion.turn",
  "link.created",
  "link.accepted",
  "link.permissions",
  "link.ended",
] as const;
export const LinkActionSchema = z.enum(LINK_ACTIONS);
export type LinkAction = z.infer<typeof LinkActionSchema>;

export const LinkActivitySchema = z.object({
  id: z.uuid(),
  /** Whose account it happened in. */
  account: z.object({ id: z.uuid(), name: z.string().nullable() }),
  /** Who did it; null id once that account is deleted (the name stays). */
  actor: z.object({ id: z.uuid().nullable(), name: z.string() }),
  via: z.enum(["app", "connector"]),
  /** The AI app's name when via is connector. */
  appName: z.string().nullable(),
  action: LinkActionSchema,
  /** The record it touched, when there is one (a recipe, plan, meal or goal id). */
  targetId: z.string().nullable(),
  at: z.string(),
});
export type LinkActivity = z.infer<typeof LinkActivitySchema>;

export const LinkActivityPageSchema = z.object({
  entries: z.array(LinkActivitySchema),
  /** Pass as before= for older entries; null when there are none. */
  before: z.string().nullable(),
});

/** In /v1/me while acting in someone else's account. */
export const ActingSchema = z.object({
  linkId: z.uuid(),
  /** The signed-in person doing the acting. */
  actor: z.object({ id: z.uuid(), name: z.string().nullable(), email: z.string() }),
  permissions: LinkPermissionsSchema,
  /** Changes whenever the owner changes a toggle; a device re-reads the account when it does. */
  permissionsUpdatedAt: z.string(),
});
export type Acting = z.infer<typeof ActingSchema>;
