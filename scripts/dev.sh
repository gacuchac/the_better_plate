#!/usr/bin/env bash
# THE one command: set everything up, then run API (http://localhost:4000) and web (http://localhost:3000) with reload.
source "$(dirname "$0")/lib.sh"
bash scripts/bootstrap.sh
say "starting API on http://localhost:4000 and web on http://localhost:3000 (Ctrl+C to stop)"
say "sign-in codes print in this terminal and at http://localhost:4000/v1/dev/mailbox"
exec pnpm exec concurrently -k -n api,web -c cyan,green \
  "pnpm --filter @betterplate/api dev" \
  "pnpm --filter @betterplate/web dev"
