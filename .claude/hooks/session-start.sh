#!/bin/bash
# Claude Code cloud sessions: make the repo ready on start (deps, PostgreSQL, migrations,
# USDA catalog, Playwright browser check). Same steps as `pnpm setup`; idempotent.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-$(dirname "$0")/../..}"
bash scripts/bootstrap.sh >&2

# Point Playwright at the preinstalled browsers when the image provides them.
if [ -n "${CLAUDE_ENV_FILE:-}" ] && [ -d /opt/pw-browsers ]; then
  echo 'export PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers' >> "$CLAUDE_ENV_FILE"
fi
