-- Read-only recipe share links. The link id is a random UUID; the snapshot holds only the fields
-- the owner reviewed (no account, email, meals or diary). Revoking clears the snapshot.
create table share_snapshots (
  id uuid primary key,                        -- the public link id (gen_random_uuid on the server)
  user_id uuid not null references "users" ("id") on delete cascade,
  recipe_id uuid not null references recipes (id) on delete cascade,
  recipe_version integer not null,            -- the revision that was shared; later edits do not leak
  include_method boolean not null,
  snapshot jsonb not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  revoked_at timestamptz
);
create index share_snapshots_owner on share_snapshots (user_id, created_at desc);
create index share_snapshots_recipe on share_snapshots (recipe_id) where revoked_at is null;
