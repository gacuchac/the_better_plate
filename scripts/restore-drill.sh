#!/usr/bin/env bash
# Backup and restore drill: dump a database, restore it into a scratch database, and prove the
# copy is complete (same migrations, same row counts and checksums of personal tables).
#
#   SOURCE_DATABASE_URL  database to back up (default: the local dev database)
#   DRILL_ADMIN_URL      server connection allowed to create/drop the scratch database
#                        (default: the source server, database "postgres")
#   KEEP_DRILL_DB=1      keep the scratch database afterwards
#
# Never point SOURCE at production without the owner's approval; the dump contains personal data
# and is written only to a private temporary directory that is deleted at the end.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SOURCE="${SOURCE_DATABASE_URL:-postgres://betterplate:betterplate@localhost:5432/betterplate}"
ADMIN="${DRILL_ADMIN_URL:-${SOURCE%/*}/postgres}"
SCRATCH="betterplate_restore_drill_$(date -u +%Y%m%d%H%M%S)"
TARGET="${SOURCE%/*}/$SCRATCH"
WORK="$(mktemp -d)"
chmod 700 "$WORK"
trap 'rm -rf "$WORK"; [[ "${KEEP_DRILL_DB:-}" == 1 ]] || psql "$ADMIN" -qc "drop database if exists $SCRATCH" >/dev/null 2>&1 || true' EXIT

say() { printf '\033[36m[drill]\033[0m %s\n' "$*"; }
started=$(date +%s)

say "dumping source (custom format, no owners or privileges)"
pg_dump --format=custom --no-owner --no-privileges --file "$WORK/backup.dump" "$SOURCE"
dumped=$(date +%s)
say "restoring into scratch database $SCRATCH"
psql "$ADMIN" -qc "create database $SCRATCH" >/dev/null
pg_restore --no-owner --no-privileges --exit-on-error --dbname "$TARGET" "$WORK/backup.dump"
restored=$(date +%s)

# Same checks on both sides; any difference fails the drill.
CHECK_SQL="
select 'migrations', string_agg(name || ':' || sha256, ',' order by name) from schema_migrations
union all select 'catalog', coalesce((select version || ':' || food_count from catalog_versions where is_current), 'none')
union all select t, n::text from (
  select 'users' t, count(*) n from users union all
  select 'sessions', count(*) from sessions union all
  select 'food_items', count(*) from food_items union all
  select 'recipes', count(*) from recipes union all
  select 'recipe_revisions', count(*) from recipe_revisions union all
  select 'planned_meals', count(*) from planned_meals union all
  select 'consumption_events', count(*) from consumption_events union all
  select 'share_snapshots', count(*) from share_snapshots union all
  select 'feedback_reports', count(*) from feedback_reports union all
  select 'consent_events', count(*) from consent_events union all
  select 'sync_operations', count(*) from sync_operations) c
union all select 'recipes_md5', coalesce(md5(string_agg(id::text || version || md5(body::text), ',' order by id)), '-') from recipes
union all select 'meals_md5', coalesce(md5(string_agg(id::text || md5(nutrition::text), ',' order by id)), '-') from consumption_events
union all select 'change_seq', (select last_value::text from change_seq)
"
psql "$SOURCE" -AtF '|' -c "$CHECK_SQL" > "$WORK/source.txt"
psql "$TARGET" -AtF '|' -c "$CHECK_SQL" > "$WORK/target.txt"
if ! diff -u "$WORK/source.txt" "$WORK/target.txt"; then
  say "FAILED: the restored copy differs from the source"
  exit 1
fi

finished=$(date +%s)
size=$(stat -c %s "$WORK/backup.dump" 2>/dev/null || stat -f %z "$WORK/backup.dump")
out="$ROOT/artifacts/qa/restore-drill"
mkdir -p "$out"
report="$out/$(date -u +%Y%m%dT%H%M%SZ).json"
{
  printf '{\n  "result": "pass",\n  "dumpBytes": %s,\n  "dumpSeconds": %s,\n  "restoreSeconds": %s,\n  "totalSeconds": %s,\n  "checks": {\n' "$size" $((dumped - started)) $((restored - dumped)) $((finished - started))
  awk -F'|' '{ v=$2; if (length(v) > 80) v=substr(v,1,77) "..."; printf "%s    \"%s\": \"%s\"", (NR>1?",\n":""), $1, v } END { print "" }' "$WORK/source.txt"
  printf '  }\n}\n'
} > "$report"
say "PASS: restored copy matches (dump ${size} bytes, restore $((restored - dumped))s, total $((finished - started))s). Report: ${report#$ROOT/}"
