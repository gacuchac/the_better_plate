import type { LinkAction, LinkArea } from "@betterplate/contracts";

/**
 * Which routes someone acting in a linked account may use, and what each needs (ADR-015).
 * Default deny: a route missing here answers 403 owner_only to a delegate, and test/linked.test.ts
 * fails when any route in the OpenAPI document has no entry, so every new route gets a decision.
 *
 * - owner: only the account's owner (sign-in, consent, deleting, exporting, linking, publishing).
 * - public: needs no account; acting changes nothing.
 * - any: any live link (who am I acting as).
 * - area: one of the areas must allow the access; handlers narrow further where a route spans areas.
 * - custom: the handler checks per item (sync).
 *
 * action: recorded in the owner's activity log after a successful change.
 */
export type RoutePolicy =
  | { kind: "owner" }
  | { kind: "public" }
  | { kind: "any" }
  | { kind: "custom" }
  | { kind: "area"; areas: readonly LinkArea[]; access: "view" | "change"; action?: LinkAction };

const owner = { kind: "owner" } as const;
const pub = { kind: "public" } as const;
const view = (...areas: LinkArea[]): RoutePolicy => ({ kind: "area", areas, access: "view" });
const change = (action: LinkAction | undefined, ...areas: LinkArea[]): RoutePolicy => ({ kind: "area", areas, access: "change", action });

export const ROUTE_POLICIES: Record<string, RoutePolicy> = {
  // account: the owner's alone
  "GET /v1/me": { kind: "any" },
  "DELETE /v1/me": owner,
  "GET /v1/me/export": owner,
  "POST /v1/me/consent": owner,
  "GET /v1/sign-in-methods": pub,

  // linked accounts themselves: decided only by the people in them, never while acting
  "GET /v1/linked-accounts": owner,
  "POST /v1/linked-accounts": owner,
  "PATCH /v1/linked-accounts/{id}": owner,
  "DELETE /v1/linked-accounts/{id}": owner,
  "POST /v1/linked-accounts/{id}/accept": owner,
  "GET /v1/linked-accounts/activity": owner,

  // AI companion: used on the signed-in person's own key and limits; keys and settings stay the owner's
  "GET /v1/ai/settings": view("companion"),
  "POST /v1/ai/turn": change("companion.turn", "companion"),
  "PUT /v1/ai/settings": owner,
  "PUT /v1/ai/credentials/{provider}": owner,
  "DELETE /v1/ai/credentials/{provider}": owner,

  // catalog: public data
  "GET /v1/catalog/bundle": pub,
  "GET /v1/catalog/manifest": pub,
  "GET /v1/foods": pub,
  "GET /v1/foods/{foodId}": pub,
  "POST /v1/foods/batch": pub,

  // community: reading and saving a copy are kitchen work; publishing and reporting speak for the owner
  "GET /v1/community/home": view("recipes"),
  "GET /v1/community/{communityId}": view("recipes"),
  "GET /v1/community/{communityId}/image": view("recipes"),
  "POST /v1/community/{communityId}/save": change("recipe.save", "recipes"),
  "POST /v1/community/{communityId}/report": owner,
  "GET /v1/recipes/{id}/community": view("recipes"),
  "PUT /v1/recipes/{id}/community": owner,
  "DELETE /v1/recipes/{id}/community": owner,

  // cook profile: money and third parties; the owner's for now
  "GET /v1/cook": owner,
  "PUT /v1/cook": owner,
  "GET /v1/cook/clients": owner,
  "POST /v1/cook/clients": owner,
  "PUT /v1/cook/clients/{id}": owner,
  "DELETE /v1/cook/clients/{id}": owner,
  "POST /v1/cook/clients/{id}/invite": owner,
  "DELETE /v1/cook/clients/{id}/invite": owner,
  "GET /v1/cook/meals": owner,
  "POST /v1/cook/meals": owner,
  "GET /v1/cook/meals/{id}": owner,
  "PATCH /v1/cook/meals/{id}": owner,
  "DELETE /v1/cook/meals/{id}": owner,
  "POST /v1/cook/meals/{id}/expenses": owner,
  "DELETE /v1/cook/meals/{id}/expenses/{childId}": owner,
  "POST /v1/cook/meals/{id}/recipes": owner,
  "DELETE /v1/cook/meals/{id}/recipes/{childId}": owner,
  "GET /v1/cook/meals/{id}/share": owner,
  "PUT /v1/cook/meals/{id}/share": owner,
  "DELETE /v1/cook/meals/{id}/share": owner,
  "GET /v1/cook/meals/{id}/shopping-list": owner,
  "POST /v1/cook/meals/{id}/timer": owner,
  "GET /v1/cook/prices": owner,
  "PUT /v1/cook/prices/{foodId}": owner,
  "DELETE /v1/cook/prices/{foodId}": owner,
  "GET /v1/cook/receipts": owner,
  "POST /v1/cook/receipts": owner,
  "POST /v1/cook/receipts/read": owner,
  "GET /v1/cook/receipts/{id}": owner,
  "PUT /v1/cook/receipts/{id}": owner,
  "DELETE /v1/cook/receipts/{id}": owner,
  "GET /v1/cook/receipts/{id}/image": owner,
  "POST /v1/cook/receipts/{id}/confirm": owner,
  "POST /v1/cook/receipts/{id}/reopen": owner,
  "GET /v1/cook/statements": owner,
  "POST /v1/cook/statements": owner,
  "GET /v1/cook/statements/{id}": owner,
  "PATCH /v1/cook/statements/{id}": owner,
  "DELETE /v1/cook/statements/{id}": owner,
  "GET /v1/cook/statements/{id}/csv": owner,
  "GET /v1/cook/statements/{id}/share": owner,
  "PUT /v1/cook/statements/{id}/share": owner,
  "DELETE /v1/cook/statements/{id}/share": owner,
  "POST /v1/cook/statements/{id}/{action}": owner,
  "GET /v1/cook/targets": owner,
  "GET /v1/cooked/{token}": pub,
  "GET /v1/me/cook-invites": owner,
  "POST /v1/me/cook-invites/{id}/accept": owner,
  "DELETE /v1/me/cook-invites/{id}": owner,
  "GET /v1/me/cooks": owner,
  "DELETE /v1/me/cooks/{id}": owner,

  // issue reports are sent as the signed-in person
  "POST /v1/feedback": pub,

  // goals
  "GET /v1/goals": view("goals"),
  "GET /v1/nutrition/summary": view("goals"),

  // groups: everything the owner does in a group, except who is in it and its roles
  "GET /v1/groups": view("groups"),
  "POST /v1/groups": owner,
  "GET /v1/groups/{id}": view("groups"),
  "PUT /v1/groups/{id}": owner,
  "DELETE /v1/groups/{id}": owner,
  "GET /v1/groups/{id}/meals": view("groups"),
  "GET /v1/groups/{id}/recipes": view("groups"),
  "POST /v1/groups/{id}/recipes": change("group.recipe", "groups"),
  "GET /v1/groups/{id}/cooked-meals": view("groups"),
  "PUT /v1/groups/{id}/cook-settings": owner,
  "POST /v1/groups/{id}/invites": owner,
  "DELETE /v1/groups/{id}/invites/{inviteId}": owner,
  "POST /v1/groups/{id}/members": owner,
  "PUT /v1/groups/{id}/members/{memberId}": owner,
  "DELETE /v1/groups/{id}/members/{memberId}": owner,
  "PUT /v1/groups/{id}/members/{memberId}/preferences": change("group.preferences", "groups"),
  "POST /v1/groups/{id}/pending": owner,
  "DELETE /v1/groups/{id}/pending/{pendingId}": owner,
  "POST /v1/groups/{id}/pending/{pendingId}/resend": owner,
  "POST /v1/groups/{id}/plans": change("group.plan", "groups"),
  "POST /v1/groups/{id}/plans/everyone": change("group.plan", "groups"),
  "PUT /v1/groups/{id}/plans/{planId}": change("group.plan.change", "groups"),
  "DELETE /v1/groups/{id}/plans/{planId}": change("group.plan.remove", "groups"),
  "POST /v1/groups/{id}/plans/{planId}/approve": change("group.plan.approve", "groups"),
  "POST /v1/groups/{id}/plans/{planId}/decline": change("group.plan.decline", "groups"),
  "POST /v1/groups/{id}/profiles": owner,
  "GET /v1/groups/{id}/meal-shares": view("groups"),
  "POST /v1/groups/{id}/meal-shares": change("group.share", "groups"),
  "PUT /v1/groups/{id}/meal-shares/{shareId}": change("group.share.change", "groups"),
  "DELETE /v1/groups/{id}/meal-shares/{shareId}": change("group.share.remove", "groups"),
  "GET /v1/groups/{id}/meal-shares/{shareId}/image": view("groups"),
  "PUT /v1/groups/{id}/meal-shares/{shareId}/reaction": change("group.react", "groups"),
  "DELETE /v1/groups/{id}/meal-shares/{shareId}/reaction": change("group.react", "groups"),
  "DELETE /v1/groups/{id}/meal-shares/{shareId}/reactions/{memberId}/comment": change("group.comment.remove", "groups"),
  "GET /v1/me/meals-to-review": view("groups"),
  "POST /v1/me/groups/{groupId}/welcome-seen": change("group.welcome", "groups"),
  "GET /v1/invites/{token}": owner,
  "POST /v1/invites/{token}/accept": owner,
  "POST /v1/me/group-invites": owner,
  "POST /v1/me/group-invites/{inviteId}/join": owner,
  "POST /v1/me/group-invites/{inviteId}/decline": owner,

  // child profiles: renaming is shared; deleting a profile and its records stays the owner's
  "GET /v1/profiles": view("children"),
  "PUT /v1/profiles/{id}": change("profile.rename", "children"),
  "DELETE /v1/profiles/{id}": owner,

  "GET /v1/health/live": pub,
  "GET /v1/health/ready": pub,

  // photos are part of recipes; generating and reading photos count against the signed-in person's limits
  "GET /v1/images/{id}": view("recipes", "groups"),
  "GET /v1/photos/search": view("recipes"),
  "POST /v1/images/generate": change(undefined, "recipes"),
  "POST /v1/images/import": change("recipe.photo", "recipes"),
  "POST /v1/images/upload": change("recipe.photo", "recipes"),

  // meals: plans and eaten meals together; the handler drops the part that isn't shared
  "GET /v1/meals": view("plans", "eaten", "children"),
  "GET /v1/shopping-list": view("shopping", "children", "groups"),

  // milestones: the owner's own view; sharing and cheering speak for them in public
  "GET /v1/milestones": view("milestones"),
  "POST /v1/milestones": owner,
  "DELETE /v1/milestones/{milestoneId}": owner,
  "PUT /v1/milestones/{milestoneId}/cheer": owner,
  "DELETE /v1/milestones/{milestoneId}/cheer": owner,

  "GET /v1/preferences": view("preferences", "children"),
  "GET /v1/meal-feedback": view("eaten", "children"),

  "GET /v1/recipes": view("recipes"),
  "POST /v1/recipes": change("recipe.save", "recipes"),
  "POST /v1/recipes/calculate": view("recipes"),
  "GET /v1/recipes/{id}": view("recipes"),
  "PUT /v1/recipes/{id}": change("recipe.save", "recipes"),
  "DELETE /v1/recipes/{id}": change("recipe.delete", "recipes"),
  "POST /v1/recipe-imports": change(undefined, "recipes"),

  // share links publish to anyone with the link
  "POST /v1/recipes/{id}/share": owner,
  "GET /v1/shares": owner,
  "DELETE /v1/shares/{shareId}": owner,
  "GET /v1/shared/{shareId}": pub,
  "GET /v1/shared/{shareId}/image": pub,

  // sync: checked per operation and per record type
  "GET /v1/sync/changes": { kind: "custom" },
  "POST /v1/sync/batch": { kind: "custom" },

  "GET /v1/water": view("eaten"),
};

/** "/v1/recipes/:id" (Hono) → "/v1/recipes/{id}" (OpenAPI). */
export const routeKey = (method: string, routePath: string) => `${method.toUpperCase()} ${routePath.replace(/:([A-Za-z0-9_]+)/g, "{$1}")}`;

export function policyFor(method: string, routePath: string): RoutePolicy | null {
  return ROUTE_POLICIES[routeKey(method, routePath)] ?? null;
}
