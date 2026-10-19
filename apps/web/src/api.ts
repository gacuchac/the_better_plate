import type { PhotoSearchResult, RecipeImage, AiProvider, AiSettings, AiSettingsUpdate, AiTurnRequest, AiTurnResponse, Recipe, Share, ShareCreate, SharedRecipe, SyncBatchRequest, SyncBatchResponse, SyncChangesResponse } from "@betterplate/contracts";
import type { FoodRecord, NutrientDefinition } from "@betterplate/nutrition";
import { trackFailedRequest } from "./activity.ts";
import { API_URL } from "./env.ts";

export class ApiRequestError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly requestId?: string) {
    super(message);
  }
}

/** Network failure (offline, DNS, server down) as opposed to an HTTP error answer. */
export class NetworkError extends Error {}

async function request<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const headers = new Headers(init.headers);
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
export const imageUrl = (id: string) => `${API_URL}/v1/images/${id}`;

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

export const api = {
  me: () => request<Me>("/v1/me"),
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
  consent: (noticeVersion: string) => request<PrivacyStatus>("/v1/me/consent", { method: "POST", json: { noticeVersion, adultConfirmed: true } }),
  exportData: () => request<{ format: string; exportedAt: string }>("/v1/me/export", { cache: "no-store" }),
  deleteAccount: () => request<void>("/v1/me", { method: "DELETE" }),
  manifest: () => request<Omit<CatalogBundle, "foods"> & { bundleUrl: string }>("/v1/catalog/manifest"),
  bundle: (url: string) => request<CatalogBundle>(url),
  syncBatch: (body: SyncBatchRequest) => request<SyncBatchResponse>("/v1/sync/batch", { method: "POST", json: body }),
  changes: (cursor: string) => request<SyncChangesResponse>(`/v1/sync/changes?cursor=${encodeURIComponent(cursor)}&limit=200`),
  recipe: (id: string) => request<Recipe>(`/v1/recipes/${id}`),
  createShare: (recipeId: string, body: ShareCreate) => request<Share>(`/v1/recipes/${recipeId}/share`, { method: "POST", json: body }),
  shares: (recipeId: string) => request<{ shares: Share[] }>(`/v1/shares?recipeId=${recipeId}`),
  revokeShare: (shareId: string) => request<void>(`/v1/shares/${shareId}`, { method: "DELETE" }),
  shared: (shareId: string) => request<SharedRecipe>(`/v1/shared/${shareId}`, { cache: "no-store" }),
  aiSettings: () => request<AiSettings>("/v1/ai/settings", { cache: "no-store" }),
  updateAiSettings: (body: AiSettingsUpdate) => request<AiSettings>("/v1/ai/settings", { method: "PUT", json: body }),
  connectAi: (provider: AiProvider, apiKey: string) => request<AiSettings>(`/v1/ai/credentials/${provider}`, { method: "PUT", json: { apiKey } }),
  disconnectAi: (provider: AiProvider) => request<AiSettings>(`/v1/ai/credentials/${provider}`, { method: "DELETE" }),
  aiTurn: (body: AiTurnRequest) => request<AiTurnResponse>("/v1/ai/turn", { method: "POST", json: body }),
  searchPhotos: (description: string) => request<{ results: PhotoSearchResult[] }>(`/v1/photos/search?q=${encodeURIComponent(description)}`, { cache: "no-store" }),
  importPhoto: (sourceId: string, alt?: string) => request<RecipeImage>("/v1/images/import", { method: "POST", json: { source: "openverse", sourceId, alt } }),
  generateImage: (prompt: string, alt: string) => request<RecipeImage>("/v1/images/generate", { method: "POST", json: { prompt, alt } }),
  oauthClient: (clientId: string) => request<OAuthClientInfo>(`/v1/auth/oauth2/public-client?client_id=${encodeURIComponent(clientId)}`, { cache: "no-store" }),
  oauthConsent: (accept: boolean, oauthQuery: string) =>
    request<{ redirect: boolean; url: string }>("/v1/auth/oauth2/consent", { method: "POST", json: { accept, oauth_query: oauthQuery } }),
  connectedApps: () => request<ConnectedApp[]>("/v1/auth/oauth2/get-consents", { cache: "no-store" }),
  disconnectApp: (id: string) => request<unknown>("/v1/auth/oauth2/delete-consent", { method: "POST", json: { id } }),
  feedback: (report: FeedbackReport) => request<{ id: string; receivedAt: string; duplicate: boolean }>("/v1/feedback", { method: "POST", json: report }),
};
