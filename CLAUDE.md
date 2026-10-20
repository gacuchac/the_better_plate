# The Better Plate

Read these before any work; they are binding:

@START_HERE.md
@PRODUCT.md
@AGENTS.md

`HISTORY.md` is archived, nonbinding context. Open it only to check a historical edge case; it never overrides PRODUCT.md or AGENTS.md.

## Working in this repo

- **One command:** `pnpm dev` (or `bash scripts/dev.sh`) sets everything up and serves web :3000 and API :4000. `pnpm setup` does setup only. Cloud sessions run setup automatically through `.claude/hooks/session-start.sh`.
- **Checks:** `pnpm test` (typecheck, unit, API against real PostgreSQL), `pnpm e2e` (Playwright, screenshots to `artifacts/qa/`), `pnpm verify` (both). Run `pnpm test` before every push, and `pnpm e2e` too when the change touches app flows (`EVENT=pull_request BASE=origin/dev bash scripts/needs-e2e.sh` says so; CI uses the same rule and runs everything on each merge into `dev`).
- **Where things are:** current state in `docs/BUILD_STATUS.md`; requirement status in `docs/requirements-ledger.md`; decisions in `docs/adr/`.
- **Stack:** TypeScript end to end (API, PWA, shared nutrition engine). Python only for data scripts (`scripts/usda`).
- **Database:** native PostgreSQL 16 (`scripts/db-up.sh`); no Docker daemon in cloud sessions. Migrations are plain SQL in `apps/api/src/db/migrations`; never edit an applied one, add a new file.
- **USDA data:** cloud sessions may not reach USDA hosts. Refresh the catalog (all of SR Legacy) by changing `scripts/usda/` on a work branch or running the `USDA catalog import` workflow by hand: it fetches with the `USDA_API_KEY` secret and commits `data/catalog/`.
- **API contract:** after changing routes, run `pnpm openapi` and commit `apps/api/openapi.json`.
- **Branches:** branch from `dev`, PR into `dev`. Never push to `main`.
- **Never:** commit `.env` or secrets, commit `artifacts/`, invent nutrient values outside labeled test fixtures, enable chef features.
