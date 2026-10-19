# The Better Plate

Offline-first cooking and nutrition education app. Your Kitchen saves recipes on the device, estimates nutrition from USDA FoodData Central records with sources and uncertainty, and syncs safely when online.

**Status:** first milestone (thin local proof) built and tested locally. Not deployed. See [docs/BUILD_STATUS.md](docs/BUILD_STATUS.md).

## Run it: one command

Needs Node.js 22+, Python 3, and PostgreSQL 16 (apt or Homebrew) or a running Docker daemon.

```bash
git clone https://github.com/gacuchac/the_better_plate && cd the_better_plate
pnpm dev        # or: bash scripts/dev.sh   (works before pnpm is installed too)
```

That installs dependencies, writes a throwaway local `.env` with a generated secret, starts PostgreSQL, creates the role and databases, migrates, loads the USDA starter catalog, and serves:

- Web app: http://localhost:3000
- API: http://localhost:4000 (OpenAPI at `/v1/openapi.json`)
- Sign-in codes: printed in the terminal and at http://localhost:4000/v1/dev/mailbox (local only)

No manual `.env` editing. Set `USDA_API_KEY` in your environment if you have one; otherwise `DEMO_KEY` is used. The committed catalog snapshot means no USDA access is needed to run.

## Other commands

| Command | What it does |
|---|---|
| `pnpm setup` | Setup only (idempotent): deps, `.env`, database, migrations, catalog |
| `pnpm start` | Production-like local run: built API + built PWA with service worker (use this to try offline mode) |
| `pnpm test` | Typecheck, catalog integrity, unit tests and API integration tests against real PostgreSQL |
| `pnpm e2e` | Playwright journeys on desktop and mobile against the built stack; evidence in `artifacts/qa/<milestone>/<run>/local/` |
| `pnpm verify` | `test` then `e2e`: the full local pass of the two-pass testing gate |
| `pnpm openapi` | Regenerate `apps/api/openapi.json` (a test fails if it drifts) |

## Layout

| Path | Contents |
|---|---|
| `apps/api` | Versioned REST API (`/v1`, Hono + zod-openapi), Better Auth email-code sessions, PostgreSQL migrations |
| `apps/web` | React PWA: IndexedDB per account, outbox sync, live nutrition |
| `packages/nutrition` | Pure deterministic nutrition engine shared by browser and server |
| `packages/contracts` | Shared zod wire contracts |
| `scripts/usda` | Python USDA importer (`starter_foods.txt` → `data/catalog/starter-catalog.json`) |
| `e2e` | Playwright journeys |
| `docs` | ADRs, requirements ledger, evidence, milestone reports |

## Branches

Work branches come from `dev` and open PRs into `dev`. `main` is production only and receives PRs from `dev`. See [docs/OWNER_PREFLIGHT.md](docs/OWNER_PREFLIGHT.md).

## Requirements

Start with [START_HERE.md](START_HERE.md). Binding: [PRODUCT.md](PRODUCT.md) and [AGENTS.md](AGENTS.md). [HISTORY.md](HISTORY.md) is archived context. Docs version 3.4.
