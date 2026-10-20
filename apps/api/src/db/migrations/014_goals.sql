-- The person's own consumption goals (owner decision 2026-10-20: stored on the server and synced).
-- Only what they want to eat: a nutrient, bounds, a period and dates. No body or health data.
-- Versioned and tombstoned like planned meals so offline edits sync without silent overwrites.
create table goals (
  id uuid primary key,
  user_id uuid not null references "users" ("id") on delete cascade,
  nutrient_key text not null,
  unit text not null,
  kind text not null check (kind in ('at_least', 'at_most', 'between')),
  min_amount numeric,
  max_amount numeric,
  period text not null check (period in ('day', 'week', 'month')),
  start_date date not null,
  end_date date,
  version integer not null,
  server_seq bigint not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  check (end_date is null or end_date >= start_date)
);
create index goals_user_seq on goals (user_id, server_seq);
create index goals_user_active on goals (user_id) where deleted_at is null;
