import type {
  AllergenAlert,
  FoodPreferences,
  FoodPreferencesBody,
  GroupDetail,
  GroupInvite,
  GroupSummary,
  InvitePreview,
  MealFeedback,
  MealReactionKind,
  MealsToReview,
  MyGroupInvite,
  MyGroupInvites,
  GroupPlanEveryone,
  GroupPlanEveryoneResult,
  SharedMeal,
  MealLog,
  PlannedMeal,
  ShoppingList,
} from "@betterplate/contracts";
import type { RecipeImport } from "@betterplate/contracts";
import type { Acting, Link, LinkActivity, LinkedAccounts, LinkPermissions } from "@betterplate/contracts";
import type {
  CookClient,
  CookClientBody,
  CookMeal,
  CookMealSummary,
  CookMealUpdate,
  CookPrice,
  CookProfileBody,
  CookProfileState,
  CookPublicShare,
  CookReceipt,
  CookReceiptBody,
  CookReceiptSummary,
  CookShareParts,
  CookShareStatus,
  CookShoppingList,
  CookStatement,
  CookStatementList,
  CookTarget,
  CookTargetRef,
  GroupCookedMeal,
  MyCook,
  MyCookInvite,
} from "@betterplate/contracts";
import type { PhotoSearchResult, RecipeImage, AiProvider, AiSettings, AiSettingsUpdate, AiTurnRequest, AiTurnResponse, Recipe, Share, ShareCreate, SharedRecipe, SyncBatchRequest, SyncBatchResponse, SyncChangesResponse, CommunityHome, CommunityRecipe, CommunityReason, CommunityShare, CommunityStatus, Cheer, Milestones, MilestoneShare, MyMilestone } from "@betterplate/contracts";
import type { FoodRecord, NutrientDefinition } from "@betterplate/nutrition";
import { trackFailedRequest } from "./activity.ts";
import { API_URL } from "./env.ts";

/**
 * The linked account this device is working in (ADR-015), or null for the signed-in person's own.
 * Every request names it in X-Act-As; the server checks the link each time.
 */
let actingAs: string | null = null;
export const setActingAs = (id: string | null) => void (actingAs = id);
export const getActingAs = () => actingAs;
/** Fired when the server says the linked account this device works in is no longer reachable. */
export const LINK_ENDED_EVENT = "bp:link-ended";

export class ApiRequestError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly requestId?: string) {
    super(message);
  }
}

/** Network failure (offline, DNS, server down) as opposed to an HTTP error answer. */
export class NetworkError extends Error {}

/**
 * own: always the signed-in person's own account. as: this account exactly (null for your own),
 * for work that belongs to one account's copy, like sync, whatever the device switched to since.
 */
async function request<T>(path: string, init: RequestInit & { json?: unknown; own?: boolean; as?: string | null } = {}): Promise<T> {
  const headers = new Headers(init.headers);
  const target = init.own ? null : init.as !== undefined ? init.as : actingAs;
  if (target && !path.startsWith("/v1/auth/")) headers.set("x-act-as", target);
  let body = init.body;
  if (init.json !== undefined) {
    headers.set("content-type", "application/json");
    body = JSON.stringify(init.json);
  }
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, { ...init, body, headers, credentials: "include" });
  } catch (err) {
    throw new NetworkError((err as Error).message);
  }
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    trackFailedRequest(res.headers.get("x-request-id"));
    const e = (data as { error?: { code?: string; message?: string; requestId?: string } }).error ?? {};
    if (target && target === actingAs && res.status === 403 && e.code === "no_access") dispatchEvent(new Event(LINK_ENDED_EVENT));
    throw new ApiRequestError(res.status, e.code ?? `http_${res.status}`, e.message ?? data?.message ?? res.statusText, e.requestId);
  }
  return data as T;
}

export interface FeedbackReport {
  id: string;
  kind: "bug" | "feedback" | "suggestion";
  message: string;
  activity: { at: string; event: string }[];
  context: {
    route: string;
    appVersion: string;
    deviceClass: "phone" | "tablet" | "desktop";
    online: boolean;
    requestIds: string[];
    error: { message: string; stack?: string } | null;
  };
  screenshot: string | null;
}

export interface PrivacyStatus {
  currentVersion: string;
  acceptedVersion: string | null;
}

export interface Me {
  id: string;
  email: string;
  displayName: string | null;
  /** Missing on accounts remembered by older app versions until the next online check. */
  privacy?: PrivacyStatus;
  /** Optional screens the server has on; missing on accounts remembered by older app versions. */
  features?: { recipePhotoImport?: boolean; cookProfile?: boolean; linkedAccounts?: boolean };
  /** Set while working in someone else's linked account; the fields above are that account's. */
  acting?: Acting | null;
}

export interface CatalogBundle {
  version: string;
  retrievedAt: string;
  contentSha256: string;
  foodCount: number;
  nutrients: NutrientDefinition[];
  foods: (FoodRecord & { fdcId: number; dataType: string })[];
}

/** Stored recipe images are served to their owner only (session cookie). */
export const imageUrl = (id: string) => `${API_URL}/v1/images/${id}${actingAs ? `?as=${actingAs}` : ""}`;

export interface OAuthClientInfo {
  client_id: string;
  client_name?: string;
  client_uri?: string;
}

export interface ConnectedApp {
  id: string;
  clientId: string;
  scopes: string[];
  createdAt?: string;
}

/** One member's week as a group's admins see it. */
export interface GroupMemberMeals {
  memberId: string;
  name: string;
  kind: "person" | "profile";
  preferences: FoodPreferences | null;
  planned: PlannedMeal[];
  eaten: MealLog[];
  feedback: MealFeedback[];
}

export interface GroupPlanInput {
  date: string;
  slot: "breakfast" | "lunch" | "dinner" | "snack";
  recipeId: string;
  servings: number;
}

const ifMatch = (version: number) => ({ "if-match": `"v${version}"` });

const noStore = { cache: "no-store" as const };
const cookApi = {
  profile: () => request<CookProfileState>("/v1/cook", noStore),
  saveProfile: (body: CookProfileBody) => request<CookProfileState>("/v1/cook", { method: "PUT", json: body }),
  clients: () => request<{ clients: CookClient[] }>("/v1/cook/clients", noStore),
  addClient: (body: CookClientBody) => request<CookClient>("/v1/cook/clients", { method: "POST", json: body }),
  saveClient: (id: string, body: CookClientBody) => request<CookClient>(`/v1/cook/clients/${id}`, { method: "PUT", json: body }),
  removeClient: (id: string) => request<void>(`/v1/cook/clients/${id}`, { method: "DELETE" }),
  inviteClient: (id: string, email: string) => request<CookClient>(`/v1/cook/clients/${id}/invite`, { method: "POST", json: { email } }),
  uninviteClient: (id: string) => request<CookClient>(`/v1/cook/clients/${id}/invite`, { method: "DELETE" }),
  targets: () => request<{ targets: CookTarget[] }>("/v1/cook/targets", noStore),
  meals: (filter: { clientId?: string; groupId?: string; memberId?: string; unbilled?: boolean } = {}) => {
    const q = new URLSearchParams(Object.entries(filter).flatMap(([k, v]) => (v === undefined ? [] : [[k, String(v)]])));
    return request<{ meals: CookMealSummary[]; currency: string }>(`/v1/cook/meals?${q}`, noStore);
  },
  startMeal: (body: { id: string; name: string; cookedOn: string; target: CookTargetRef; recipeId?: string; servings?: number }) =>
    request<CookMeal>("/v1/cook/meals", { method: "POST", json: body }),
  meal: (id: string) => request<CookMeal>(`/v1/cook/meals/${id}`, noStore),
  updateMeal: (id: string, body: CookMealUpdate) => request<CookMeal>(`/v1/cook/meals/${id}`, { method: "PATCH", json: body }),
  deleteMeal: (id: string) => request<void>(`/v1/cook/meals/${id}`, { method: "DELETE" }),
  addMealRecipe: (id: string, recipeId: string, servings: number) => request<CookMeal>(`/v1/cook/meals/${id}/recipes`, { method: "POST", json: { recipeId, servings } }),
  removeMealRecipe: (id: string, rowId: string) => request<CookMeal>(`/v1/cook/meals/${id}/recipes/${rowId}`, { method: "DELETE" }),
  timer: (id: string, action: "start" | "pause" | "stop") => request<CookMeal>(`/v1/cook/meals/${id}/timer`, { method: "POST", json: { action } }),
  addExpense: (id: string, label: string, amountCents: number) => request<CookMeal>(`/v1/cook/meals/${id}/expenses`, { method: "POST", json: { label, amountCents } }),
  removeExpense: (id: string, expenseId: string) => request<CookMeal>(`/v1/cook/meals/${id}/expenses/${expenseId}`, { method: "DELETE" }),
  shoppingList: (id: string) => request<CookShoppingList>(`/v1/cook/meals/${id}/shopping-list`, noStore),
  mealShare: (id: string) => request<CookShareStatus>(`/v1/cook/meals/${id}/share`, noStore),
  shareMeal: (id: string, parts: CookShareParts, link: boolean) => request<CookShareStatus>(`/v1/cook/meals/${id}/share`, { method: "PUT", json: { parts, link } }),
  unshareMeal: (id: string) => request<void>(`/v1/cook/meals/${id}/share`, { method: "DELETE" }),
  receipts: () => request<{ receipts: CookReceiptSummary[] }>("/v1/cook/receipts", noStore),
  readReceipt: (image: string) => request<CookReceipt>("/v1/cook/receipts/read", { method: "POST", json: { image } }),
  addReceipt: (body: CookReceiptBody) => request<CookReceipt>("/v1/cook/receipts", { method: "POST", json: body }),
  receipt: (id: string) => request<CookReceipt>(`/v1/cook/receipts/${id}`, noStore),
  saveReceipt: (id: string, body: CookReceiptBody) => request<CookReceipt>(`/v1/cook/receipts/${id}`, { method: "PUT", json: body }),
  confirmReceipt: (id: string) => request<CookReceipt>(`/v1/cook/receipts/${id}/confirm`, { method: "POST" }),
  reopenReceipt: (id: string) => request<CookReceipt>(`/v1/cook/receipts/${id}/reopen`, { method: "POST" }),
  deleteReceipt: (id: string) => request<void>(`/v1/cook/receipts/${id}`, { method: "DELETE" }),
  receiptImageUrl: (id: string) => `${API_URL}/v1/cook/receipts/${id}/image`,
  prices: () => request<{ prices: CookPrice[]; currency: string }>("/v1/cook/prices", noStore),
  setPrice: (foodId: string, centsPerKg: number) => request<void>(`/v1/cook/prices/${encodeURIComponent(foodId)}`, { method: "PUT", json: { centsPerKg } }),
  removePrice: (foodId: string) => request<void>(`/v1/cook/prices/${encodeURIComponent(foodId)}`, { method: "DELETE" }),
  statements: () => request<CookStatementList>("/v1/cook/statements", noStore),
  createStatement: (body: { id: string; title: string; mealIds: string[] }) => request<CookStatement>("/v1/cook/statements", { method: "POST", json: body }),
  statement: (id: string) => request<CookStatement>(`/v1/cook/statements/${id}`, noStore),
  updateStatement: (id: string, body: { title?: string; mealIds?: string[] }) => request<CookStatement>(`/v1/cook/statements/${id}`, { method: "PATCH", json: body }),
  deleteStatement: (id: string) => request<void>(`/v1/cook/statements/${id}`, { method: "DELETE" }),
  statementAction: (id: string, action: "send" | "paid" | "void") => request<CookStatement>(`/v1/cook/statements/${id}/${action}`, { method: "POST" }),
  statementCsvUrl: (id: string) => `${API_URL}/v1/cook/statements/${id}/csv`,
  statementShare: (id: string) => request<CookShareStatus>(`/v1/cook/statements/${id}/share`, noStore),
  shareStatement: (id: string, parts: CookShareParts, link: boolean) => request<CookShareStatus>(`/v1/cook/statements/${id}/share`, { method: "PUT", json: { parts, link } }),
  unshareStatement: (id: string) => request<void>(`/v1/cook/statements/${id}/share`, { method: "DELETE" }),
  publicShare: (token: string) => request<CookPublicShare>(`/v1/cooked/${token}`, noStore),
  myInvites: () => request<{ invites: MyCookInvite[] }>("/v1/me/cook-invites", noStore),
  acceptInvite: (id: string) => request<void>(`/v1/me/cook-invites/${id}/accept`, { method: "POST" }),
  declineInvite: (id: string) => request<void>(`/v1/me/cook-invites/${id}`, { method: "DELETE" }),
  myCooks: () => request<{ cooks: MyCook[] }>("/v1/me/cooks", noStore),
  leaveCook: (clientId: string) => request<void>(`/v1/me/cooks/${clientId}`, { method: "DELETE" }),
  groupCookedMeals: (groupId: string) => request<{ meals: GroupCookedMeal[]; memberShares: boolean }>(`/v1/groups/${groupId}/cooked-meals`, noStore),
  setGroupCookSettings: (groupId: string, memberShares: boolean) => request<{ memberShares: boolean }>(`/v1/groups/${groupId}/cook-settings`, { method: "PUT", json: { memberShares } }),
};

export const api = {
  me: () => request<Me>("/v1/me"),
  /** The signed-in person's own account, whichever account the device is working in. */
  myOwnAccount: () => request<Me>("/v1/me", { own: true }),
  linkedAccounts: () => request<LinkedAccounts>("/v1/linked-accounts", { own: true }),
  shareAccount: (email: string, permissions: LinkPermissions) => request<Link>("/v1/linked-accounts", { method: "POST", json: { email, permissions }, own: true }),
  updateLink: (id: string, permissions: LinkPermissions) => request<Link>(`/v1/linked-accounts/${id}`, { method: "PATCH", json: { permissions }, own: true }),
  endLink: (id: string) => request<void>(`/v1/linked-accounts/${id}`, { method: "DELETE", own: true }),
  acceptLink: (id: string) => request<Link>(`/v1/linked-accounts/${id}/accept`, { method: "POST", own: true }),
  linkActivity: (who: "others" | "me", before?: string) =>
    request<{ entries: LinkActivity[]; before: string | null }>(`/v1/linked-accounts/activity?who=${who}${before ? `&before=${encodeURIComponent(before)}` : ""}`, { own: true }),
  signInMethods: () => request<{ methods: ("email_code" | "google")[] }>("/v1/sign-in-methods"),
  /** Starts Google sign-in; the server answers with Google's URL and the page navigates there. */
  googleSignIn: (returnTo: string) =>
    request<{ url: string; redirect: boolean }>("/v1/auth/sign-in/social", {
      method: "POST",
      json: { provider: "google", callbackURL: returnTo, errorCallbackURL: `${returnTo}?signin=google_failed` },
    }),
  sendCode: (email: string) => request<{ success: boolean }>("/v1/auth/email-otp/send-verification-otp", { method: "POST", json: { email, type: "sign-in" } }),
  signIn: (email: string, otp: string) => request<unknown>("/v1/auth/sign-in/email-otp", { method: "POST", json: { email, otp } }),
  signOut: () => request<unknown>("/v1/auth/sign-out", { method: "POST", json: {} }),
  consent: (noticeVersion: string) => request<PrivacyStatus>("/v1/me/consent", { method: "POST", json: { noticeVersion, adultConfirmed: true }, own: true }),
  exportData: () => request<{ format: string; exportedAt: string }>("/v1/me/export", { cache: "no-store" }),
  deleteAccount: () => request<void>("/v1/me", { method: "DELETE" }),
  manifest: () => request<Omit<CatalogBundle, "foods"> & { bundleUrl: string }>("/v1/catalog/manifest"),
  bundle: (url: string) => request<CatalogBundle>(url),
  syncBatch: (body: SyncBatchRequest, as?: string | null) => request<SyncBatchResponse>("/v1/sync/batch", { method: "POST", json: body, as }),
  changes: (cursor: string, as?: string | null) => request<SyncChangesResponse>(`/v1/sync/changes?cursor=${encodeURIComponent(cursor)}&limit=200`, { as }),
  recipe: (id: string) => request<Recipe>(`/v1/recipes/${id}`),
  createShare: (recipeId: string, body: ShareCreate) => request<Share>(`/v1/recipes/${recipeId}/share`, { method: "POST", json: body }),
  shares: (recipeId: string) => request<{ shares: Share[] }>(`/v1/shares?recipeId=${recipeId}`),
  revokeShare: (shareId: string) => request<void>(`/v1/shares/${shareId}`, { method: "DELETE" }),
  shared: (shareId: string) => request<SharedRecipe>(`/v1/shared/${shareId}`, { cache: "no-store" }),
  communityStatus: (recipeId: string) => request<CommunityStatus>(`/v1/recipes/${recipeId}/community`, { cache: "no-store" }),
  shareWithCommunity: (recipeId: string, body: CommunityShare) => request<CommunityStatus>(`/v1/recipes/${recipeId}/community`, { method: "PUT", json: body }),
  unshareFromCommunity: (recipeId: string) => request<void>(`/v1/recipes/${recipeId}/community`, { method: "DELETE" }),
  communityHome: (today: string) => request<CommunityHome>(`/v1/community/home?today=${today}`, { cache: "no-store" }),
  communityRecipe: (id: string) => request<CommunityRecipe>(`/v1/community/${id}`, { cache: "no-store" }),
  saveCommunityCopy: (id: string) => request<{ recipeId: string }>(`/v1/community/${id}/save`, { method: "POST" }),
  reportCommunity: (id: string, reason: CommunityReason) => request<void>(`/v1/community/${id}/report`, { method: "POST", json: { reason } }),
  milestones: () => request<Milestones>("/v1/milestones", { cache: "no-store" }),
  shareMilestone: (body: MilestoneShare) => request<MyMilestone>("/v1/milestones", { method: "POST", json: body }),
  unshareMilestone: (id: string) => request<void>(`/v1/milestones/${id}`, { method: "DELETE" }),
  cheer: (id: string, cheer: Cheer) => request<void>(`/v1/milestones/${id}/cheer`, { method: "PUT", json: { cheer } }),
  uncheer: (id: string) => request<void>(`/v1/milestones/${id}/cheer`, { method: "DELETE" }),
  aiSettings: () => request<AiSettings>("/v1/ai/settings", { cache: "no-store" }),
  updateAiSettings: (body: AiSettingsUpdate) => request<AiSettings>("/v1/ai/settings", { method: "PUT", json: body }),
  connectAi: (provider: AiProvider, apiKey: string) => request<AiSettings>(`/v1/ai/credentials/${provider}`, { method: "PUT", json: { apiKey } }),
  disconnectAi: (provider: AiProvider) => request<AiSettings>(`/v1/ai/credentials/${provider}`, { method: "DELETE" }),
  aiTurn: (body: AiTurnRequest) => request<AiTurnResponse>("/v1/ai/turn", { method: "POST", json: body }),
  searchPhotos: (description: string) => request<{ results: PhotoSearchResult[] }>(`/v1/photos/search?q=${encodeURIComponent(description)}`, { cache: "no-store" }),
  importPhoto: (sourceId: string, alt?: string) => request<RecipeImage>("/v1/images/import", { method: "POST", json: { source: "openverse", sourceId, alt } }),
  uploadImage: (data: string, alt: string) => request<RecipeImage>("/v1/images/upload", { method: "POST", json: { data, alt, rightsConfirmed: true } }),
  importRecipe: (images: string[]) => request<RecipeImport>("/v1/recipe-imports", { method: "POST", json: { images, rightsConfirmed: true } }),
  generateImage: (prompt: string, alt: string) => request<RecipeImage>("/v1/images/generate", { method: "POST", json: { prompt, alt } }),
  oauthClient: (clientId: string) => request<OAuthClientInfo>(`/v1/auth/oauth2/public-client?client_id=${encodeURIComponent(clientId)}`, { cache: "no-store" }),
  oauthConsent: (accept: boolean, oauthQuery: string) =>
    request<{ redirect: boolean; url: string }>("/v1/auth/oauth2/consent", { method: "POST", json: { accept, oauth_query: oauthQuery } }),
  connectedApps: () => request<ConnectedApp[]>("/v1/auth/oauth2/get-consents", { cache: "no-store" }),
  disconnectApp: (id: string) => request<unknown>("/v1/auth/oauth2/delete-consent", { method: "POST", json: { id } }),
  // Groups: online screens; what they plan reaches members' kitchens through sync.
  groups: () => request<{ groups: GroupSummary[] }>("/v1/groups", { cache: "no-store" }),
  group: (id: string) => request<GroupDetail>(`/v1/groups/${id}`, { cache: "no-store" }),
  createGroup: (name: string, myName: string) => request<GroupDetail>("/v1/groups", { method: "POST", json: { name, myName } }),
  renameGroup: (id: string, name: string) => request<GroupDetail>(`/v1/groups/${id}`, { method: "PUT", json: { name } }),
  endGroup: (id: string) => request<void>(`/v1/groups/${id}`, { method: "DELETE" }),
  createInvite: (groupId: string, role: "admin" | "member") => request<GroupInvite>(`/v1/groups/${groupId}/invites`, { method: "POST", json: { role } }),
  revokeInvite: (groupId: string, inviteId: string) => request<void>(`/v1/groups/${groupId}/invites/${inviteId}`, { method: "DELETE" }),
  invite: (token: string) => request<InvitePreview>(`/v1/invites/${token}`, { cache: "no-store" }),
  acceptInvite: (token: string, myName: string) => request<GroupDetail>(`/v1/invites/${token}/accept`, { method: "POST", json: { myName } }),
  setMemberRole: (groupId: string, memberId: string, role: "admin" | "member") => request<GroupDetail>(`/v1/groups/${groupId}/members/${memberId}`, { method: "PUT", json: { role } }),
  removeMember: (groupId: string, memberId: string) => request<void>(`/v1/groups/${groupId}/members/${memberId}`, { method: "DELETE" }),
  addProfile: (groupId: string, name: string, id = crypto.randomUUID()) => request<GroupDetail>(`/v1/groups/${groupId}/profiles`, { method: "POST", json: { id, name } }),
  addExistingProfile: (groupId: string, profileId: string) => request<GroupDetail>(`/v1/groups/${groupId}/members`, { method: "POST", json: { profileId } }),
  deleteProfile: (id: string) => request<void>(`/v1/profiles/${id}`, { method: "DELETE" }),
  setMemberPreferences: (groupId: string, memberId: string, body: FoodPreferencesBody) =>
    request<FoodPreferences>(`/v1/groups/${groupId}/members/${memberId}/preferences`, { method: "PUT", json: body }),
  groupMeals: (groupId: string, from: string, to: string) =>
    request<{ from: string; to: string; members: GroupMemberMeals[] }>(`/v1/groups/${groupId}/meals?from=${from}&to=${to}`, { cache: "no-store" }),
  planForMember: (groupId: string, memberId: string, body: GroupPlanInput) =>
    request<{ plan: PlannedMeal; alert: AllergenAlert }>(`/v1/groups/${groupId}/plans`, { method: "POST", json: { memberId, ...body } }),
  removeGroupPlan: (groupId: string, planId: string, version: number) => request<void>(`/v1/groups/${groupId}/plans/${planId}`, { method: "DELETE", headers: ifMatch(version) }),
  approvePlan: (groupId: string, planId: string) => request<PlannedMeal>(`/v1/groups/${groupId}/plans/${planId}/approve`, { method: "POST" }),
  declinePlan: (groupId: string, planId: string) => request<PlannedMeal>(`/v1/groups/${groupId}/plans/${planId}/decline`, { method: "POST" }),
  groupRecipes: (groupId: string) => request<{ recipes: Recipe[] }>(`/v1/groups/${groupId}/recipes`, { cache: "no-store" }),
  // People added by email, and invites waiting for me (FEATURE_GROUP_EMAIL_INVITES_ENABLED).
  addByEmail: (groupId: string, body: { email: string; name: string; role: "admin" | "member" }) =>
    request<{ group: GroupDetail; emailed: boolean }>(`/v1/groups/${groupId}/pending`, { method: "POST", json: body }),
  resendInvite: (groupId: string, pendingId: string) => request<{ group: GroupDetail; emailed: boolean }>(`/v1/groups/${groupId}/pending/${pendingId}/resend`, { method: "POST" }),
  removePending: (groupId: string, pendingId: string) => request<void>(`/v1/groups/${groupId}/pending/${pendingId}`, { method: "DELETE" }),
  /** Joins the groups that added me by email (once I agreed to the privacy notice) and lists what's left. */
  myGroupInvites: () => request<MyGroupInvites>("/v1/me/group-invites", { method: "POST" }),
  groupWelcomeSeen: (groupId: string) => request<void>(`/v1/me/groups/${groupId}/welcome-seen`, { method: "POST" }),
  planForEveryone: (groupId: string, body: GroupPlanEveryone) => request<GroupPlanEveryoneResult>(`/v1/groups/${groupId}/plans/everyone`, { method: "POST", json: body }),
  joinByEmailInvite: (inviteId: string, myName: string) => request<GroupDetail>(`/v1/me/group-invites/${inviteId}/join`, { method: "POST", json: { myName } }),
  declineEmailInvite: (inviteId: string) => request<void>(`/v1/me/group-invites/${inviteId}/decline`, { method: "POST" }),
  // Meals shared with a group (FEATURE_GROUP_MEAL_SHARES_ENABLED).
  sharedMeals: (groupId: string, cursor?: string) =>
    request<{ meals: SharedMeal[]; nextCursor: string | null }>(`/v1/groups/${groupId}/meal-shares${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`, { cache: "no-store" }),
  shareMeal: (groupId: string, body: { recipeId: string; summary?: string; imageId?: string | null }) => request<SharedMeal>(`/v1/groups/${groupId}/meal-shares`, { method: "POST", json: body }),
  updateSharedMeal: (groupId: string, shareId: string, body: { summary?: string; imageId?: string | null }) =>
    request<SharedMeal>(`/v1/groups/${groupId}/meal-shares/${shareId}`, { method: "PUT", json: body }),
  withdrawSharedMeal: (groupId: string, shareId: string) => request<void>(`/v1/groups/${groupId}/meal-shares/${shareId}`, { method: "DELETE" }),
  reactToMeal: (groupId: string, shareId: string, reaction: MealReactionKind, comment: string) =>
    request<SharedMeal>(`/v1/groups/${groupId}/meal-shares/${shareId}/reaction`, { method: "PUT", json: { reaction, comment } }),
  unreactToMeal: (groupId: string, shareId: string) => request<void>(`/v1/groups/${groupId}/meal-shares/${shareId}/reaction`, { method: "DELETE" }),
  removeMealComment: (groupId: string, shareId: string, memberId: string) =>
    request<void>(`/v1/groups/${groupId}/meal-shares/${shareId}/reactions/${memberId}/comment`, { method: "DELETE" }),
  mealsToReview: () => request<MealsToReview>("/v1/me/meals-to-review", { cache: "no-store" }),
  shareRecipeWithGroup: (groupId: string, recipeId: string) => request<Recipe>(`/v1/groups/${groupId}/recipes`, { method: "POST", json: { recipeId } }),
  shoppingList: (from: string, to: string, scope: { profileId?: string; groupId?: string } = {}) => {
    const q = new URLSearchParams({ from, to, ...scope });
    return request<ShoppingList>(`/v1/shopping-list?${q}`, { cache: "no-store" });
  },
  feedback: (report: FeedbackReport) => request<{ id: string; receivedAt: string; duplicate: boolean }>("/v1/feedback", { method: "POST", json: report }),
  cook: cookApi,
};

