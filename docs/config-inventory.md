# Configuration inventory

Living registry of every runtime and CI setting. **Last revised:** 2026-10-19 (cloud *staging* renamed to *dev* for the `dev` branch model; before ADR-001/ADR-002). Names are provisional and stack-neutral; any rename after ADR-001 (runtime) or ADR-002 (auth/email) updates this file and [`/.env.example`](../.env.example) together.

**Classes:** `public` = may ship in the browser bundle (never a secret); `server` = server-only, not secret; `secret` = server-only credential.
**Services:** `api` (versioned backend), `web` (PWA static host), `ci` (GitHub Actions), `jobs` (one-off/cron runs of the API image, e.g. catalog import). No separate worker in the pilot.
**Provisioners:** `owner` = Gabriel creates/supplies it; `agent` = generated or set by the agent once it has scoped access; `default` = template value.

## Runtime variables (`.env.example`)

| Key | Purpose | Service(s) | Class | Mandatory in | Provisioner | Validation |
|---|---|---|---|---|---|---|
| `APP_ENV` | Selects environment behavior (dev tooling, strictness). | api, web build, jobs | server | all | default / agent | One of `local`, `test`, `dev`, `production`; startup fails otherwise. `dev` is the cloud dev environment, not local development. |
| `LOG_LEVEL` | Log verbosity; logs are redacted regardless. | api, jobs | server | none (`info`) | default | Enum check at startup. |
| `PUBLIC_APP_URL` | Origin of the PWA; used for links in emails and share URLs. | web, api | public | all | agent | Valid absolute URL; `https://` outside `local`. |
| `PUBLIC_API_URL` | Base URL the client calls (without `/v1`). | web | public | all | agent | Valid absolute URL; `GET /v1/health/live` returns 200. |
| `API_CORS_ALLOWED_ORIGINS` | Exact origins allowed by CORS; no wildcards with credentials. | api | server | dev, production | agent | Each entry is an exact origin; rejects `*`. |
| `DATABASE_URL` | PostgreSQL connection string. Local: native PostgreSQL 16 (a Docker container also works where a Docker daemon exists); cloud: Railway reference variable to the environment's own database. | api, jobs | secret | all | agent (local) / Railway reference (cloud) | Connect + `SELECT 1` in `/v1/health/ready`; dev and production URLs must differ. |
| `SESSION_SECRET` | Signs session and CSRF tokens. May be renamed by ADR-002. | api | secret | all | agent (random ≥32 bytes per environment, written straight into Railway) | Length ≥32 bytes; differs per environment; rotation invalidates sessions (documented in `deploy-and-restore.md`). |
| `AUTH_EMAIL_FROM` | Sender address for verification/recovery email. | api | server | dev, production | owner (domain, preflight P1) | Domain verified at email provider; test email delivered. |
| `EMAIL_PROVIDER_API_KEY` | Transactional email provider credential; provider named in ADR-002. | api | secret | dev, production | owner (preflight S5) | Provider "send test" call succeeds; never logged. Local uses a console mailer. |
| `USDA_FDC_API_BASE_URL` | FoodData Central API base. | api, jobs | server | none | default | Absolute `https://` URL. |
| `USDA_FDC_API_KEY` | api.data.gov key for online food search/lookup. Not needed for the bulk-download starter catalog. | api, jobs | secret | dev, production | owner (preflight S6) | `GET /foods/search?query=apple` returns 200 with the key. Public exposure gets the key deactivated, so server-only. |
| `FEATURE_CHEF_ENABLED` | Server-enforced kill switch for chef commerce; database flags cannot override it to ON. | api | server | none (`false`) | default | Must be `false` in production until owner approval; flag-off penetration tests run in CI. |
| `FEATURE_AI_COMPANION_ENABLED` | Enables BYOK AI routes. | api | server | none (`false`) | default | When `true`, startup requires `BYOK_ENCRYPTION_KEY`. |
| `BYOK_ENCRYPTION_KEY` | Key-encryption key for per-user AI provider keys stored encrypted in the database. | api | secret | only when AI enabled | agent (generated per environment, written into Railway) | Correct length for the chosen cipher; round-trip self-test at startup; rotation procedure documented. |
| `ERROR_MONITORING_DSN` | Optional hosted error tracker. | api, web (public DSN variant only if the provider's DSN is designed to be public) | secret | none | owner (preflight O1) | Test event received with PII scrubbed. |

## CI and deployment settings (not in `.env.example`)

| Key | Purpose | Where stored | Class | Mandatory in | Provisioner | Validation |
|---|---|---|---|---|---|---|
| `RAILWAY_TOKEN` (dev) | Deploys web/api to the cloud dev environment on merges into the `dev` branch. Name follows the Railway CLI convention. | GitHub environment secret, `dev` (deployment branch `dev` only) | secret | dev | owner (preflight S3) | Deploy job authenticates; token scoped to one project environment; masked in logs. |
| `RAILWAY_TOKEN` (production) | Deploys to production after manual approval. | GitHub environment secret, `production` (required reviewer; deployment branch `main` only) | secret | production | owner (preflight P7) | Job waits for approval; token scoped to production only. |
| `GITHUB_TOKEN` | Built-in Actions token. | GitHub (automatic) | secret | all CI | default | Workflows declare least-privilege `permissions:`. |

## Environment maps

| Setting | local | test (CI) | dev (Railway, from `dev` branch) | production (Railway, from `main`) |
|---|---|---|---|---|
| `APP_ENV` | `local` | `test` | `dev` | `production` |
| `PUBLIC_APP_URL` / `PUBLIC_API_URL` | `http://localhost:3000` / `:4000` | ephemeral localhost | Railway-generated `*.up.railway.app` domains | owner domain (P1) |
| `DATABASE_URL` | local PostgreSQL 16 | CI service container | dev's own Railway PostgreSQL, synthetic data | production Railway PostgreSQL, daily backups |
| `SESSION_SECRET` | local random | per-run random | distinct random | distinct random |
| Email | console mailer | console mailer | provider sandbox/test sender | provider, verified domain |
| `USDA_FDC_API_KEY` | empty (DEMO_KEY) or owner key in local `.env` | empty; tests use labeled fixtures | owner key | owner key |
| `FEATURE_CHEF_ENABLED` | `false` (may be `true` locally with fake providers) | both values tested | `false` (staged allowlist only) | `false` |
| `FEATURE_AI_COMPANION_ENABLED` | `false` | both values tested | per milestone | `false` until released |

## Deferred (no variable until an ADR decides)

- **Object storage** for screenshots/images (preflight O2). The previous template's `OBJECT_STORAGE_*` names were removed so no unused secret slots exist; they return with the chosen provider's real names.
- **Auth provider-specific settings** (OIDC client IDs, passkey RP ID) — added with ADR-002.

## Rules

- `.env`, `.env.*` (except `*.example`), key files and `artifacts/` are git-ignored. Repo is public.
- Browser-exposed variables must start with `PUBLIC_` and be non-secret; the template check enforces the prefix/class match.
- CI will run an open-source secret scanner on every push and PR, plus a template check that every key in `.env.example` has a class tag, has no value if secret, and appears in this file.
- Rotation and revocation steps for each secret go in `docs/deploy-and-restore.md` when the service exists.
