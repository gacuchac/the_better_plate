-- Catalog: versioned, source-attributed food records (values per 100 g as published).
create table catalog_versions (
  version text primary key,
  schema text not null,
  retrieved_at timestamptz not null,
  content_sha256 text not null,
  food_count integer not null,
  source jsonb not null,
  nutrients jsonb not null,
  imported_at timestamptz not null default now(),
  is_current boolean not null default false
);
create unique index catalog_versions_one_current on catalog_versions (is_current) where is_current;

create table food_items (
  id text primary key,                      -- "fdc:<fdcId>"
  fdc_id integer not null unique,
  description text not null,
  data_type text not null,
  category text,
  ndb_number text,
  publication_date text,
  nutrients_per_100g jsonb not null,
  portions jsonb not null,
  source jsonb not null,
  catalog_version text not null references catalog_versions (version),
  updated_at timestamptz not null default now()
);
create index food_items_description_lower on food_items (lower(description));

-- One global sequence orders every change; per-user writes are serialized with an
-- advisory lock so a user's change feed never skips a lower, later-committed value.
create sequence change_seq;

create table recipes (
  id uuid primary key,
  user_id uuid not null references "users" ("id") on delete cascade,
  title text not null,
  servings numeric not null,
  body jsonb not null,
  nutrition jsonb,
  version integer not null,
  server_seq bigint not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index recipes_user_seq on recipes (user_id, server_seq);
create index recipes_user_live on recipes (user_id, updated_at desc) where deleted_at is null;

-- Immutable history: every accepted version with the nutrition snapshot and catalog version it used.
create table recipe_revisions (
  recipe_id uuid not null references recipes (id) on delete cascade,
  version integer not null,
  user_id uuid not null references "users" ("id") on delete cascade,
  body jsonb,
  nutrition jsonb,
  catalog_version text,
  deleted boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (recipe_id, version)
);

-- Idempotency ledger: one row per client operation id, storing the result returned.
create table sync_operations (
  user_id uuid not null references "users" ("id") on delete cascade,
  op_id uuid not null,
  op_type text not null,
  entity_id uuid not null,
  result jsonb,
  created_at timestamptz not null default now(),
  primary key (user_id, op_id)
);
