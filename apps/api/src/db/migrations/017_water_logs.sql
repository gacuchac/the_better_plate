-- Water the person logs drinking (owner request 2026-10-21). Only an amount, a day and a time:
-- no body or health data. Create-only and tombstoned like eaten meals so offline drinks sync once.
create table water_logs (
  id uuid primary key,
  user_id uuid not null references "users" ("id") on delete cascade,
  amount_ml integer not null check (amount_ml between 1 and 5000),
  local_date date not null,
  drank_at timestamptz not null,
  server_seq bigint not null,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index water_logs_user_seq on water_logs (user_id, server_seq);
create index water_logs_user_date on water_logs (user_id, local_date) where deleted_at is null;
