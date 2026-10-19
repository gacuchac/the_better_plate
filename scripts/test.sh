#!/usr/bin/env bash
# Fast checks: typecheck, unit and API integration tests (real PostgreSQL), catalog integrity.
source "$(dirname "$0")/lib.sh"
bash scripts/bootstrap.sh
say "typecheck"
pnpm -r --if-present typecheck
say "catalog snapshot integrity"
python3 scripts/usda/import_starter.py --check
say "unit and API tests"
pnpm -r --if-present test
