-- Favorites and opt-in community recipes (owner request 2026-11-11: a home page with trending,
-- favorites and an "up for an adventure" pick instead of every recipe).

-- A person's favorite recipes. Personal even for group recipes, so a favorite is its own record,
-- not a field on the shared recipe. Create-only and tombstoned like water so offline taps sync once.
create table recipe_favorites (
  id uuid primary key,
  user_id uuid not null references "users" ("id") on delete cascade,
  recipe_id uuid not null,
  server_seq bigint not null,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index recipe_favorites_user_seq on recipe_favorites (user_id, server_seq);
create unique index recipe_favorites_one_live on recipe_favorites (user_id, recipe_id) where deleted_at is null;

-- Recipes their authors chose to share with everyone signed in. Like share links, the listing holds a
-- snapshot of the version the author reviewed: no account, name, email, meals or other recipes.
-- Unsharing (or deleting the recipe, or a moderator hiding it) clears the snapshot.
create table community_recipes (
  id uuid primary key,                           -- public listing id (gen_random_uuid on the server)
  user_id uuid not null references "users" ("id") on delete cascade,
  recipe_id uuid not null references recipes (id) on delete cascade,
  recipe_version integer not null,
  include_method boolean not null,
  snapshot jsonb not null,
  food_ids text[] not null default '{}',         -- catalog food ids in the snapshot, for "something different"
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unshared_at timestamptz,
  hidden_at timestamptz                          -- set when enough different people report it
);
create unique index community_recipes_one_live on community_recipes (recipe_id) where unshared_at is null;
create index community_recipes_live on community_recipes (created_at desc) where unshared_at is null and hidden_at is null;

-- Someone saved a copy of a community recipe into their own kitchen. Trending counts distinct savers
-- over a recent window; the saver is never shown to anyone.
create table community_saves (
  community_id uuid not null references community_recipes (id) on delete cascade,
  user_id uuid not null references "users" ("id") on delete cascade,
  recipe_id uuid not null,                       -- the copy in the saver's kitchen
  created_at timestamptz not null default now(),
  primary key (community_id, user_id)
);
create index community_saves_recent on community_saves (created_at desc);

-- Reports from signed-in people. One per person per listing; enough distinct reports hide it.
create table community_reports (
  community_id uuid not null references community_recipes (id) on delete cascade,
  user_id uuid not null references "users" ("id") on delete cascade,
  reason text not null check (reason in ('not_food', 'offensive', 'unsafe', 'spam', 'other')),
  created_at timestamptz not null default now(),
  primary key (community_id, user_id)
);
