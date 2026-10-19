-- Planned meals (editable, versioned) and consumption events (immutable, create-only, retractable).
-- Plans and logs are separate tables so a plan can never be counted as food eaten.
create table planned_meals (
  id uuid primary key,
  user_id uuid not null references "users" ("id") on delete cascade,
  local_date date not null,
  slot text not null check (slot in ('breakfast', 'lunch', 'dinner', 'snack')),
  recipe_id uuid,
  title text not null,
  servings numeric not null,
  version integer not null,
  server_seq bigint not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index planned_meals_user_seq on planned_meals (user_id, server_seq);
create index planned_meals_user_date on planned_meals (user_id, local_date) where deleted_at is null;

create table consumption_events (
  id uuid primary key,
  user_id uuid not null references "users" ("id") on delete cascade,
  planned_meal_id uuid,
  recipe_id uuid,
  recipe jsonb not null,                -- snapshot as eaten (title, servings, ingredients)
  servings numeric not null,            -- servings eaten
  slot text not null check (slot in ('breakfast', 'lunch', 'dinner', 'snack')),
  local_date date not null,             -- the eater's own calendar day
  eaten_at timestamptz not null,
  nutrition jsonb not null,             -- immutable server-computed snapshot
  catalog_version text not null,
  server_seq bigint not null,
  created_at timestamptz not null default now(),
  deleted_at timestamptz                -- retraction tombstone; content is cleared
);
create index consumption_events_user_seq on consumption_events (user_id, server_seq);
create index consumption_events_user_date on consumption_events (user_id, local_date) where deleted_at is null;
