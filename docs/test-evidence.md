# Test evidence

Evidence folders are git-ignored (public repo, see preflight N2). Rerun `pnpm verify` to regenerate them; CI uploads the same folder as a 7-day artifact.

## M1 thin proof, local pass: 2026-10-19, commit 781e2e5 plus docs
Command: `pnpm verify` (= `scripts/test.sh` + `scripts/e2e.sh`).

| Suite | Result |
|---|---|
| Typecheck (5 workspace packages) | pass |
| Catalog snapshot integrity (`import_starter.py --check`) | pass, 149 foods |
| Nutrition engine unit tests | 12 / 12 pass |
| Web sync engine unit tests (fake IndexedDB) | 6 / 6 pass |
| API integration tests (real PostgreSQL 16, fresh schema) | 26 / 26 pass |
| Playwright journeys, desktop 1366×900 + Pixel 7 | 10 / 10 pass |

Evidence: `artifacts/qa/m1-thin-proof/20261019T140225Z-781e2e5/local/` with `screenshots/{desktop,mobile}/01..14-*.png`, `screenshots/manifest.jsonl`, traces under `test-results/`, `report/` (HTML), `results.json`, `junit.xml`.

Screenshots inspected: sign-in, empty kitchen with catalog indicator, editor with unmeasured-oil disclosure, all nutrients, sources drawer, synced editor, kitchen list, offline reload, offline save, reconnect, second account empty, conflict banner, kept both, Explore food detail. Issues found and fixed in review: portion defaulted to an arbitrary first portion (now grams), stale save message beside the conflict banner, zero shown as "0.00", no unsaved-changes cue. Known cosmetic artifact: full-page screenshots draw fixed navigation mid-page; not visible in real use.

Fresh-clone check: a new clone with the role and databases dropped came up with one command (`pnpm dev`), and `/v1/health/ready` reported the catalog loaded.

Not run yet: hosted pass (blocked on Railway approval), accessibility audit, 429 rate-limit test, browser XSS test, quota-eviction test.
