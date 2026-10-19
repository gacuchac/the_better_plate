-- Optional AI companion (bring your own key). Provider keys are stored encrypted with
-- AES-256-GCM under BYOK_ENCRYPTION_KEY; only the last four characters are kept readable.
create table ai_credentials (
  user_id uuid not null references "users" ("id") on delete cascade,
  provider text not null check (provider in ('anthropic', 'openai')),
  ciphertext bytea not null,
  iv bytea not null,
  auth_tag bytea not null,
  key_hint text not null,
  model text not null,
  models jsonb not null default '[]',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, provider)
);

create table ai_settings (
  user_id uuid primary key references "users" ("id") on delete cascade,
  active_provider text check (active_provider in ('anthropic', 'openai')),
  daily_request_limit integer not null default 200 check (daily_request_limit between 1 and 2000),
  updated_at timestamptz not null default now()
);

-- Per-day counters only: no prompts, replies or tool data are stored.
create table ai_usage (
  user_id uuid not null references "users" ("id") on delete cascade,
  day date not null,
  requests integer not null default 0,
  input_tokens bigint not null default 0,
  output_tokens bigint not null default 0,
  primary key (user_id, day)
);
