-- Recipe photos: openly licensed photos copied from Openverse, or images generated on the
-- person's own OpenAI key. Stored here (not hot-linked) so they work offline-cached, carry
-- their provenance, and are only served to their owner.
create table recipe_images (
  id uuid primary key,
  user_id uuid not null references "users" ("id") on delete cascade,
  kind text not null check (kind in ('photo', 'generated')),
  mime text not null check (mime in ('image/jpeg', 'image/png', 'image/webp')),
  bytes bytea not null check (octet_length(bytes) <= 3000000),
  -- photo: source, source id, title, creator, license, URLs (see PhotoCreditSchema)
  credit jsonb,
  -- generated: provider and model
  generator jsonb,
  created_at timestamptz not null default now(),
  check ((kind = 'photo') = (credit is not null)),
  check ((kind = 'generated') = (generator is not null))
);
create index recipe_images_user on recipe_images (user_id, created_at);
