#!/usr/bin/env bash
# Full local gate: everything in test.sh, then the Playwright journeys.
source "$(dirname "$0")/lib.sh"
bash scripts/test.sh
bash scripts/e2e.sh "$@"
