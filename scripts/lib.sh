# Shared helpers for the one-command scripts. Sourced, not executed.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
say() { printf '\033[32m[better-plate]\033[0m %s\n' "$*"; }
warn() { printf '\033[33m[better-plate]\033[0m %s\n' "$*" >&2; }
die() { printf '\033[31m[better-plate]\033[0m %s\n' "$*" >&2; exit 1; }
