#!/usr/bin/env bash
# Decides whether CI runs the browser journeys (owner decision 2026-10-20). Always on pushes to
# dev and manual runs; on a PR when it has the "e2e" label or touches a file behind an app flow.
# Writes e2e=true|false to $GITHUB_OUTPUT. Usage elsewhere: BASE=<sha> bash scripts/needs-e2e.sh
set -euo pipefail

# Files behind what a person does in the browser: the web app, shared packages, the browser
# tests themselves, schema and dependencies, the API contract, and the API code those screens
# call. Anything else (docs, API tests, data scripts, assistant-only code) is covered by the
# typecheck, unit and API tests.
FLOW_FILES='^(apps/web/|packages/|e2e/|playwright\.config\.ts$|apps/api/src/db/|apps/api/openapi\.json$|apps/api/src/(app|auth|config|server)\.ts$|apps/api/src/lib/http\.ts$|apps/api/src/modules/(access|account|catalog|common|connector|feedback|goals|groups|images|meals|preferences|recipes|shares|shopping|sync)\.ts$|apps/api/src/modules/ai/(routes|fake)\.ts$|scripts/(e2e|bootstrap|serve|db-up|lib|mock-openverse)\.|data/catalog/|pnpm-lock\.yaml$|([^/]+/)*package\.json$|\.github/workflows/ci\.yml$|Dockerfile$)'

decide() {
  if [[ "${EVENT:-}" != "pull_request" ]]; then echo "true ($EVENT: full run)"; return; fi
  if [[ "${LABELLED:-false}" == "true" ]]; then echo "true (e2e label)"; return; fi
  local hits
  hits=$(git diff --name-only "${BASE:?BASE sha required}...HEAD" | grep -E "$FLOW_FILES" || true)
  if [[ -n "$hits" ]]; then echo "true (flow files: $(echo "$hits" | head -5 | tr '\n' ' '))"; else echo "false (no flow files changed)"; fi
}

result=$(decide)
echo "browser journeys: $result"
echo "e2e=${result%% *}" >> "${GITHUB_OUTPUT:-/dev/stdout}"
