# ADR-001: Runtime, architecture and hosting

**Status:** accepted for local development (2026-10-19). Hosting part pending owner budget approval (preflight S1–S4).

## Context
PRODUCT.md needs an independently deployable versioned API, an offline-first PWA, one deterministic nutrition engine used in the browser and revalidated on the server, managed infrastructure with no server maintenance, and low cost. The owner chose TypeScript end to end (Python only for data scripts) and prefers Railway + GitHub Actions.

## Decision
- **Monorepo** (pnpm workspaces): `apps/api`, `apps/web`, `packages/nutrition`, `packages/contracts`.
- **API:** Node 22, Hono with `@hono/zod-openapi` (OpenAPI 3.1 generated from code and checked in), `pg` driver with plain SQL migrations, no ORM. Bundled with esbuild for deployment. One modular monolith: catalog, recipes, sync, account, health modules.
- **Web:** React 19 + Vite PWA (`vite-plugin-pwa`, Workbox app-shell precache). IndexedDB via `idb`.
- **Shared engine:** `packages/nutrition` is pure TypeScript with no I/O; the server recomputes nutrition on every write and stores it with the catalog and engine version.
- **Database:** PostgreSQL 16. Local: native cluster (`scripts/db-up.sh`; Homebrew or Docker fallbacks). Cloud: Railway PostgreSQL per environment.
- **Hosting target:** one Railway service (the API, which also serves the built PWA with `SERVE_WEB=true`) plus Railway PostgreSQL, built from the root `Dockerfile` with `railway.json` (migrations and catalog seed run at container start, before the server). GitHub Actions CI. No worker until a workload needs one; catalog imports run as a GitHub Actions job.
- **Why one service (2026-10-19 amendment):** the owner starts on Railway's 30-day trial ($5 credit, 0.5 GB RAM per service). One app service instead of two roughly halves memory cost, and same-origin hosting keeps session cookies first-party, avoiding the `*.up.railway.app` public-suffix cookie problem noted in ADR-002. The API stays independently usable at `/v1` by other clients; splitting web out later is a deploy change, not a code change (the web build reads `PUBLIC_API_URL` when set).

## Alternatives considered
- Fastify/Express: fine, but Hono + zod-openapi gives contract-first routes with less glue.
- Prisma/Drizzle ORM: extra generation steps and migration tooling; plain SQL keeps migrations reviewable.
- Next.js full stack: couples API and web deployments, against the independent-API requirement.

## Consequences
- Rate limiting is in process memory, valid for one API instance. Before adding replicas, move it to a shared store (ADR needed).
- Cost model and approval live in `docs/OWNER_PREFLIGHT.md`; nothing billable is provisioned.
- Rollback: services are stateless; database changes are forward-only SQL migrations (each new file reviewed for compatibility with the previous release).
