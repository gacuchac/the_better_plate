#!/usr/bin/env bash
# Production-like local run: built API + built PWA with its service worker (needed to try offline mode).
source "$(dirname "$0")/lib.sh"
bash scripts/bootstrap.sh
say "building"
pnpm --filter @betterplate/api build >/dev/null
pnpm --filter @betterplate/web build >/dev/null
say "serving API on http://localhost:4000 and PWA on http://localhost:3000 (Ctrl+C to stop)"
exec pnpm exec concurrently -k -n api,web -c cyan,green \
  "cd apps/api && node dist/server.mjs" \
  "pnpm --filter @betterplate/web preview"
