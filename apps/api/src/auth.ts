import { betterAuth } from "better-auth";
import { emailOTP, jwt } from "better-auth/plugins";
import { oauthProvider } from "@better-auth/oauth-provider";
import { config } from "./config.ts";
import { pool } from "./db/pool.ts";
import { sendEmail } from "./lib/mailer.ts";

/**
 * Authentication via Better Auth (vetted open-source library, self-hosted in this API;
 * see docs/adr/ADR-002-auth.md). Email one-time codes verify email ownership on every
 * sign-in; no passwords are stored. Sessions are httpOnly cookies.
 */
/** Scopes the connector can ask for; see docs/adr/ADR-007-connector.md. */
export const CONNECTOR_SCOPES = ["kitchen:read", "kitchen:write"] as const;
/** The MCP endpoint is the protected resource; access tokens carry it as their audience. */
export const MCP_RESOURCE = `${config.publicApiUrl}/mcp`;

export const authOptions = {
  appName: "The Better Plate",
  database: pool,
  basePath: "/v1/auth",
  baseURL: config.publicApiUrl,
  secret: config.sessionSecret,
  trustedOrigins: config.corsOrigins,
  telemetry: { enabled: false },
  user: { modelName: "users" },
  session: {
    modelName: "sessions",
    expiresIn: 60 * 60 * 24 * 30,
    updateAge: 60 * 60 * 24,
  },
  account: {
    modelName: "accounts",
    // Google sign-in joins an existing account with the same Google-verified email instead of
    // creating a duplicate. Better Auth only links when the local email is verified too.
    accountLinking: { enabled: true, trustedProviders: ["google"] },
    // We never call Google APIs; tokens are kept only because the library stores them, so encrypt them.
    encryptOAuthTokens: true,
  },
  // Optional, server-side only. Scopes are Google's minimum: openid, email, profile (for the name).
  socialProviders: config.google
    ? {
        google: {
          clientId: config.google.clientId,
          clientSecret: config.google.clientSecret,
          prompt: "select_account" as const,
          // Keep the name only; the profile photo is not needed (data minimization).
          mapProfileToUser: (profile: { name?: string }) => ({ name: profile.name ?? "", image: undefined }),
        },
      }
    : {},
  verification: { modelName: "verifications" },
  emailAndPassword: { enabled: false },
  rateLimit: {
    enabled: true,
    window: 60,
    max: 60 * config.rateLimitMultiplier,
    // Rate limits are per process memory; one API instance in the pilot (ADR-001).
    storage: "memory" as const,
  },
  advanced: {
    // Railway and most managed proxies set X-Forwarded-For; locally there is no proxy.
    ipAddress: { ipAddressHeaders: ["x-forwarded-for"] },
    database: { generateId: "uuid" as const },
    useSecureCookies: !config.isLocal,
    defaultCookieAttributes: { sameSite: "lax" as const, httpOnly: true },
  },
  // The JWT plugin's session-to-JWT endpoint isn't needed; it only signs connector tokens here.
  disabledPaths: ["/token"],
  plugins: [
    jwt({ jwt: { issuer: `${config.publicApiUrl}/v1/auth`, audience: MCP_RESOURCE } }),
    // Lets Claude, ChatGPT and other MCP clients sign in to The Better Plate (OAuth 2.1 with PKCE,
    // dynamic client registration) and act in the person's kitchen with the scopes they approve.
    oauthProvider({
      loginPage: `${config.publicAppUrl}/#/connect/login`,
      consentPage: `${config.publicAppUrl}/#/connect`,
      scopes: ["openid", "profile", "email", "offline_access", ...CONNECTOR_SCOPES],
      allowDynamicClientRegistration: true,
      // MCP clients register themselves before anyone signs in; the consent screen names them.
      allowUnauthenticatedClientRegistration: true,
      clientRegistrationDefaultApplicationType: "infer",
      // Every registered client may ask for the MCP resource; the person still approves each one.
      clientRegistrationDefaultResources: [MCP_RESOURCE],
      resources: [{ identifier: MCP_RESOURCE, accessTokenTtl: 900, allowedScopes: ["openid", "profile", "email", "offline_access", ...CONNECTOR_SCOPES] }],
    }),
    emailOTP({
      otpLength: 6,
      expiresIn: 600,
      allowedAttempts: 5,
      storeOTP: "hashed",
      rateLimit: { window: 60, max: 3 * config.rateLimitMultiplier },
      async sendVerificationOTP({ email, otp, type }) {
        if (type !== "sign-in" && type !== "email-verification") return;
        await sendEmail({
          to: email,
          subject: `Your Better Plate code: ${otp}`,
          text: `Your sign-in code is ${otp}. It expires in 10 minutes. If you did not ask for it, you can ignore this email.`,
        });
      },
    }),
  ],
};

export const auth = betterAuth(authOptions);
export type Session = typeof auth.$Infer.Session;
