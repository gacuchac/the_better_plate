#!/usr/bin/env bash
# Ensure a local PostgreSQL is running and the app role/databases exist.
# Order: already reachable -> Debian/Ubuntu cluster (pg_ctlcluster) -> Homebrew -> Docker.
# Idempotent; safe to run on every start.
set -euo pipefail

DB_USER="${BP_DB_USER:-betterplate}"
DB_PASS="${BP_DB_PASS:-betterplate}"
DB_HOST="${BP_DB_HOST:-localhost}"
DB_PORT="${BP_DB_PORT:-5432}"
DATABASES=("betterplate" "betterplate_test" "betterplate_e2e")

log() { printf '\033[36m[db]\033[0m %s\n' "$*"; }

pg_ready() { pg_isready -q -h "$DB_HOST" -p "$DB_PORT" 2>/dev/null; }

start_server() {
  if pg_ready; then return 0; fi
  if command -v pg_ctlcluster >/dev/null 2>&1; then
    local cluster
    cluster=$(pg_lsclusters --no-header 2>/dev/null | awk -v p="$DB_PORT" '$3==p {print $1" "$2; exit}')
    if [[ -n "$cluster" ]]; then
      log "starting PostgreSQL cluster $cluster"
      if [[ $EUID -eq 0 ]]; then pg_ctlcluster $cluster start || true
      else sudo pg_ctlcluster $cluster start || true; fi
    fi
  fi
  if ! pg_ready && command -v brew >/dev/null 2>&1; then
    local formula
    formula=$(brew list --formula 2>/dev/null | grep -E '^postgresql(@[0-9]+)?$' | sort -V | tail -1 || true)
    if [[ -n "$formula" ]]; then log "starting $formula via Homebrew"; brew services start "$formula" >/dev/null || true; fi
  fi
  if ! pg_ready && command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
    log "starting PostgreSQL 16 in Docker (container betterplate-pg)"
    docker start betterplate-pg >/dev/null 2>&1 || docker run -d --name betterplate-pg -p "$DB_PORT:5432" \
      -e POSTGRES_USER="$DB_USER" -e POSTGRES_PASSWORD="$DB_PASS" -e POSTGRES_DB=betterplate postgres:16 >/dev/null
  fi
  for _ in $(seq 1 30); do pg_ready && return 0; sleep 1; done
  echo "Could not start PostgreSQL. Install PostgreSQL 16 (apt, Homebrew or Docker) or set DATABASE_URL to a reachable server." >&2
  exit 1
}

# Run SQL as a superuser: the postgres OS user on Linux, the current user on Homebrew.
as_superuser() {
  if [[ $EUID -eq 0 ]] && id postgres >/dev/null 2>&1; then
    # Unix socket + peer auth: no password prompt.
    su postgres -c "psql -w -v ON_ERROR_STOP=1 -qtA -p $DB_PORT -d postgres $(printf '%q ' "$@")"
  elif psql -w -qtA -p "$DB_PORT" -d postgres -c 'select 1' >/dev/null 2>&1; then
    psql -w -v ON_ERROR_STOP=1 -qtA -p "$DB_PORT" -d postgres "$@"
  elif command -v sudo >/dev/null 2>&1 && id postgres >/dev/null 2>&1; then
    sudo -n -u postgres psql -w -v ON_ERROR_STOP=1 -qtA -p "$DB_PORT" -d postgres "$@"
  else
    return 1
  fi
}

ensure_role_and_dbs() {
  if PGPASSWORD="$DB_PASS" psql -w -qtA -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d betterplate -c 'select 1' >/dev/null 2>&1 \
    && PGPASSWORD="$DB_PASS" psql -w -qtA -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d betterplate_e2e -c 'select 1' >/dev/null 2>&1; then
    return 0
  fi
  log "creating role $DB_USER and databases"
  as_superuser -c "DO \$\$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '$DB_USER') THEN CREATE ROLE $DB_USER LOGIN PASSWORD '$DB_PASS' CREATEDB; END IF; END \$\$;" \
    || { echo "No superuser access to create the $DB_USER role. Create it manually or set DATABASE_URL." >&2; exit 1; }
  for db in "${DATABASES[@]}"; do
    if [[ -z "$(as_superuser -c "SELECT 1 FROM pg_database WHERE datname = '$db'")" ]]; then
      as_superuser -c "CREATE DATABASE $db OWNER $DB_USER"
    fi
  done
}

start_server
ensure_role_and_dbs
log "PostgreSQL ready on $DB_HOST:$DB_PORT (databases: ${DATABASES[*]})"
