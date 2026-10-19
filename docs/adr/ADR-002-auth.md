# ADR-002: Authentication and sessions

**Status:** accepted for local development (2026-10-19). Email provider pending (preflight S5).

## Context
PRODUCT.md §2.1: email verification through a vetted provider, recovery, session revocation, safe cookies/CSRF/CORS, admin MFA, passkeys/OIDC as feasible, no invented auth endpoints.

## Decision
- **Better Auth 1.7** (open-source, widely used TypeScript auth library), self-hosted inside the API at `/v1/auth/*`, PostgreSQL-backed (`users`, `sessions`, `accounts`, `verifications`, schema frozen in migration `001_auth.sql`; a test fails if the library expects more).
- **Email one-time code** (`emailOTP` plugin) is the only sign-in method: each sign-in proves email ownership, so verification and recovery are the same flow; no passwords stored. Codes are 6 digits, hashed at rest, expire in 10 minutes, 5 attempts, rate limited.
- **Sessions:** httpOnly, SameSite=Lax cookies, `Secure` outside local; 30-day expiry; sign-out revokes the session. Account deletion cascades all personal rows.
- **CSRF:** Better Auth origin checks on its routes; our routes require JSON bodies on mutations and an allowed `Origin` when present. CORS lists exact origins only.
- **Email delivery:** local/test use an in-memory mailbox (readable at `/v1/dev/mailbox`, 404 elsewhere). Dev/production refuse to send until a provider is chosen and configured.

## Open items
- Pick the transactional email provider (owner account, preflight S5) and add its adapter.
- Passkeys (Better Auth passkey plugin) and admin MFA arrive with the admin console.

## Consequences
Cookies require the web and API to be same-site (e.g. `app.example.com` and `api.example.com`). Railway's generated `*.up.railway.app` domains are on the public suffix list, so cross-service cookies need a custom domain or a same-origin proxy for the dev environment; decide at first deploy.
