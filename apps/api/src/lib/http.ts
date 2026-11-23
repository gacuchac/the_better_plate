import type { Context, MiddlewareHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import { allows, type LinkArea, type LinkPermissions } from "@betterplate/contracts";
import { auth } from "../auth.ts";
import { config } from "../config.ts";
import { policyFor, type RoutePolicy } from "../modules/linked/policy.ts";

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  /** The person proved they own this email (a sign-in code or Google). Optional for connector calls. */
  emailVerified?: boolean;
}

/** Someone signed in is acting in an account linked to them (ADR-015). */
export interface ActingLink {
  id: string;
  /** The account being acted in; requireUser returns it once the route allows it. */
  owner: AuthUser;
  permissions: LinkPermissions;
  updatedAt: Date;
  via: "app" | "connector";
  appName: string | null;
  clientId: string | null;
}

export type AppEnv = {
  Variables: {
    requestId: string;
    /** Always the signed-in person, also while they act in a linked account. */
    user: AuthUser | null;
    /** Set on connector (MCP) requests after the access token is verified. */
    connector?: { userId: string; clientId: string; scopes: Set<string> };
    /** Set when the request acts in a linked account (X-Act-As). */
    link?: ActingLink;
    /** The route's policy, once requireUser allowed a delegate through it. */
    linkPolicy?: RoutePolicy;
  };
};

export class ApiError extends HTTPException {
  constructor(
    status: 400 | 401 | 403 | 404 | 409 | 412 | 413 | 415 | 422 | 428 | 429 | 503,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(status, { message });
  }
}

export function errorBody(c: Context<AppEnv>, code: string, message: string, details?: unknown) {
  return { error: { code, message, requestId: c.get("requestId") ?? "unknown", ...(details === undefined ? {} : { details }) } };
}

/** Resolves the Better Auth session (cookie) into c.var.user without failing anonymous requests. */
export const sessionMiddleware: MiddlewareHandler<AppEnv> = async (c, next) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers }).catch(() => null);
  c.set("user", session ? { id: session.user.id, email: session.user.email, name: session.user.name, emailVerified: session.user.emailVerified === true } : null);
  await next();
};

/**
 * The account a request works in: the signed-in person's own, or, while they act in a linked
 * account, that account, but only through routes its owner shared (modules/linked/policy.ts).
 * Every route reads its account here, so a route nobody marked stays the owner's (default deny).
 */
export function requireUser(c: Context<AppEnv>): AuthUser {
  const user = c.get("user");
  if (!user) throw new ApiError(401, "unauthenticated", "Sign in to continue");
  const link = c.get("link");
  if (!link) return user;
  const policy = policyFor(c.req.method, c.req.routePath);
  if (!policy || policy.kind === "owner") throw new ApiError(403, "owner_only", `Only ${link.owner.name || "the account's owner"} can do this`);
  if (policy.kind === "area") {
    const levels = policy.areas.map((a) => link.permissions.areas[a]);
    if (!levels.some((l) => allows(l, policy.access))) {
      const viewOnly = policy.access === "change" && levels.some((l) => allows(l, "view"));
      throw new ApiError(403, viewOnly ? "view_only" : "not_shared", viewOnly ? "This is shared with you to view only" : "This isn't shared with you", { areas: policy.areas });
    }
  }
  c.set("linkPolicy", policy);
  return link.owner;
}

/** The person signed in, whatever account they act in: for their own limits, keys and reports. */
export function signedInUser(c: Context<AppEnv>): AuthUser {
  const user = c.get("user");
  if (!user) throw new ApiError(401, "unauthenticated", "Sign in to continue");
  return user;
}

/** True unless the request acts in a linked account that doesn't share this area at that level. */
export function canUse(c: Context<AppEnv>, area: LinkArea, access: "view" | "change" = "view"): boolean {
  const link = c.get("link");
  return !link || allows(link.permissions.areas[area], access);
}

/** Throws the same errors as requireUser when an area isn't shared at that level. */
export function requireArea(c: Context<AppEnv>, area: LinkArea, access: "view" | "change" = "view") {
  if (canUse(c, area, access)) return;
  const viewOnly = access === "change" && canUse(c, area, "view");
  throw new ApiError(403, viewOnly ? "view_only" : "not_shared", viewOnly ? "This is shared with you to view only" : "This isn't shared with you", { areas: [area] });
}

/**
 * CSRF defense for cookie-authenticated API calls (auth routes have Better Auth's own checks):
 * unsafe methods must send JSON (forces a CORS preflight cross-site) and, when the browser
 * sends an Origin, it must be an allowed origin. Session cookies are SameSite=Lax.
 */
export const csrfMiddleware: MiddlewareHandler<AppEnv> = async (c, next) => {
  const method = c.req.method;
  if (method !== "GET" && method !== "HEAD" && method !== "OPTIONS") {
    const origin = c.req.header("origin");
    if (origin && !config.corsOrigins.includes(origin)) throw new ApiError(403, "origin_not_allowed", "Request origin is not allowed");
    const length = c.req.header("content-length");
    const hasBody = (length !== undefined && length !== "0") || c.req.header("transfer-encoding") !== undefined;
    if (hasBody && !(c.req.header("content-type") ?? "").toLowerCase().startsWith("application/json")) {
      throw new ApiError(415, "unsupported_media_type", "Send JSON with Content-Type: application/json");
    }
  }
  await next();
};

/**
 * Fixed-window limiter in process memory. Adequate for the single-instance pilot (ADR-001);
 * replace with a shared store before running more than one API replica.
 */
export function rateLimit(name: string, limit: number, windowSeconds: number): MiddlewareHandler<AppEnv> {
  const buckets = new Map<string, { count: number; resetAt: number }>();
  const max = Math.round(limit * config.rateLimitMultiplier);
  return async (c, next) => {
    // The signed-in person, also while acting in a linked account: their own limits, never the owner's.
    const user = c.get("user");
    // Railway's edge sets X-Real-IP; the first X-Forwarded-For entry is whatever the client sent.
    const ip = c.req.header("x-real-ip")?.trim() || c.req.header("x-forwarded-for")?.split(",")[0]?.trim() || "local";
    const key = user ? `u:${user.id}` : `ip:${ip}`;
    const now = Date.now();
    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + windowSeconds * 1000 };
      buckets.set(key, bucket);
      if (buckets.size > 50_000) for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
    }
    bucket.count += 1;
    c.header("RateLimit-Limit", String(max));
    c.header("RateLimit-Remaining", String(Math.max(0, max - bucket.count)));
    if (bucket.count > max) {
      c.header("Retry-After", String(Math.ceil((bucket.resetAt - now) / 1000)));
      throw new ApiError(429, "rate_limited", `Too many ${name} requests; try again shortly`);
    }
    await next();
  };
}
