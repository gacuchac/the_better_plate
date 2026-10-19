# Deploy and restore

**Nothing is deployed.** Cloud deployment waits for preflight S1–S4 (Railway account, monthly cap, dev token, GitHub environments).

## Local
- Start: `pnpm dev` (development) or `pnpm start` (built, with service worker).
- Reset local data: drop and recreate with `bash scripts/db-up.sh` after `dropdb betterplate`, then `pnpm setup`. The E2E database is reset automatically on each run.
- Rotate the local session secret: delete `.env` and run `pnpm setup` (signs everyone out locally).

## Planned (to be verified at first deploy)
- Railway services `api` (`node apps/api/dist/server.mjs`, health `/v1/health/ready`) and `web` (static `apps/web/dist`), PostgreSQL per environment.
- Migrations run before the new API version starts (`node apps/api/dist/db/cli.mjs setup`); migrations are forward-only and must stay compatible with the previous release for rollback.
- Rollback: redeploy the previous image; no down-migrations.
- Backups: Railway PostgreSQL backups; restore drill required before production (preflight P9).
- Secret rotation: `SESSION_SECRET` rotation signs users out; `USDA_FDC_API_KEY` rotate at api.data.gov and update Railway variables.
