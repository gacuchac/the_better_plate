# Readiness

| Environment | Status | Evidence |
|---|---|---|
| Local development | **Ready.** One command from a fresh clone (`pnpm dev`); cloud sessions auto-setup via SessionStart hook | `docs/test-evidence.md` |
| CI | **Configured, first run pending** on the M1 PR (typecheck, unit, API on PostgreSQL service, Playwright, gitleaks) | `.github/workflows/ci.yml` |
| Cloud dev (Railway) | **Blocked** on preflight S1–S4 | `docs/OWNER_PREFLIGHT.md` |
| Production | **Blocked** on S1–S5, P1–P9 | `docs/OWNER_PREFLIGHT.md` |
