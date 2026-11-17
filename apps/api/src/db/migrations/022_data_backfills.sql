-- One-time data changes done in code (not SQL), recorded so they run once per database.
create table data_backfills (
  name text primary key,
  done_at timestamptz not null default now(),
  details jsonb not null default '{}'::jsonb
);
