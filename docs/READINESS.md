# Readiness

| Environment | Status | Evidence |
|---|---|---|
| Local development | **Ready.** One command from a fresh clone (`pnpm dev`); cloud sessions auto-setup via SessionStart hook | `docs/test-evidence.md` |
| CI | **Running** on every PR: typecheck, unit, API on PostgreSQL, Playwright, gitleaks; green on PRs #4–#7 | `.github/workflows/ci.yml` |
| Cloud dev (Railway) | **Live**: https://thebetterplate-dev.up.railway.app, autodeploys from `dev`; hosted Playwright check runs after each deploy | `.github/workflows/hosted-check.yml` |
| Production | **Blocked**: needs owner approval of production spend and promotion from `main`, privacy notice (P3), confirmed email sending (S5), backup/restore drill | `docs/OWNER_PREFLIGHT.md` |
