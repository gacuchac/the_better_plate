-- Versioned privacy notices and the consent events that reference them (append-only).
create table privacy_notices (
  version text primary key,
  content_sha256 text not null,
  review_status text not null check (review_status in ('draft', 'reviewed')),
  published_at timestamptz not null default now()
);

create table consent_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references "users" ("id") on delete cascade,
  notice_version text not null references privacy_notices (version),
  action text not null check (action in ('accepted')),
  adult_confirmed boolean not null,
  created_at timestamptz not null default now()
);
create index consent_events_user on consent_events (user_id, created_at desc);
