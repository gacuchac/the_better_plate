#!/usr/bin/env bash
# Local pass of the two-pass gate: build the full stack against an isolated database and run
# Playwright journeys on desktop and mobile. Evidence: artifacts/qa/<milestone>/<run-id>/local/
source "$(dirname "$0")/lib.sh"
bash scripts/bootstrap.sh
export E2E_MILESTONE="${E2E_MILESTONE:-m2-pilot}"
export E2E_RUN_ID="${E2E_RUN_ID:-$(date -u +%Y%m%dT%H%M%SZ)-$(git rev-parse --short HEAD 2>/dev/null || echo nogit)}"
export E2E_OUT="$ROOT/artifacts/qa/$E2E_MILESTONE/$E2E_RUN_ID/local"
mkdir -p "$E2E_OUT"

if [[ -z "${PLAYWRIGHT_BROWSERS_PATH:-}" ]] && ! ls "${HOME}/.cache/ms-playwright" 2>/dev/null | grep -q chromium; then
  say "installing Playwright Chromium (first run only)"
  pnpm exec playwright install chromium
fi

say "building the stack for E2E (API :4100, web :3100, database betterplate_e2e)"
pnpm --filter @betterplate/api build >/dev/null
PUBLIC_API_URL=http://localhost:4100 PUBLIC_APP_URL=http://localhost:3100 pnpm --filter @betterplate/web exec vite build --outDir dist-e2e >/dev/null
say "running Playwright; evidence goes to ${E2E_OUT#$ROOT/}"
pnpm exec playwright test "$@"
