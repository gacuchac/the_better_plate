# Deploy and restore

**Dev is deployed** at https://thebetterplate-dev.up.railway.app (Railway 30-day trial, no card), built from the `dev` branch. Sign-in waits on email setup (step 5).

## Local
- Start: `pnpm dev` (development) or `pnpm start` (built, with service worker).
- Reset local data: drop and recreate with `bash scripts/db-up.sh` after `dropdb betterplate`, then `pnpm setup`. The E2E database is reset automatically on each run.
- Rotate the local session secret: delete `.env` and run `pnpm setup` (signs everyone out locally).

## Railway dev environment (not yet verified by a deploy)

One service built from the root `Dockerfile` (config in `railway.json`): the API serves the PWA from the same origin. On every start the container runs `node apps/api/dist/db/cli.mjs setup` (migrations and starter-catalog seed; idempotent and lock-guarded) before the server. Health check: `/v1/health/ready`.

Owner setup in the Railway dashboard (no tokens needed for this path; Railway's GitHub integration builds on every push to `dev`):
1. New project → **Empty Project**, then **Create → Database → PostgreSQL**.
2. **Create → GitHub Repo →** `gacuchac/the_better_plate`. In the service's Settings → Source, set the branch to **`dev`**.
3. Settings → Networking → **Generate Domain** (port 8080 if asked).
4. Variables → Raw Editor, paste, then replace the session secret:
   ```
   APP_ENV=dev
   SERVE_WEB=true
   PORT=8080
   PUBLIC_APP_URL=https://${{RAILWAY_PUBLIC_DOMAIN}}
   PUBLIC_API_URL=https://${{RAILWAY_PUBLIC_DOMAIN}}
   DATABASE_URL=${{Postgres.DATABASE_URL}}
   SESSION_SECRET=replace-with-a-random-value
   ```
   Generate the secret on your own computer and paste it only into Railway: `openssl rand -base64 48` (Mac/Linux) or, in PowerShell, `$b = New-Object byte[] 48; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); [Convert]::ToBase64String($b)`.
5. Email for sign-in codes (until set, the app runs but cannot send codes): `EMAIL_PROVIDER=resend` or `brevo`, `EMAIL_PROVIDER_API_KEY`, and `AUTH_EMAIL_FROM` (a sender verified with that provider).

Then: hosted pass of the two-pass gate (same Playwright suite against the dev URL).

## Operations
- Migrations are forward-only and must stay compatible with the previous release for rollback.
- Rollback: redeploy the previous deployment in Railway; no down-migrations.
- Backups: Railway PostgreSQL backups; restore drill required before production (preflight P9).
- Secret rotation: `SESSION_SECRET` rotation signs users out; `USDA_FDC_API_KEY` rotate at api.data.gov and update Railway variables; email keys rotate at the provider.
