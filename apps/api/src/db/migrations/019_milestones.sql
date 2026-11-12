-- Milestones people choose to share with everyone signed in, and preset cheers on them
-- (owner decision 2026-11-12: the journey, not the numbers; reactions only, no comments).

-- A shared milestone holds a kind from a fixed list, the week it happened and, for "tried something
-- new", one catalog food. No text, amounts, goals or meals. Stopping sharing deletes the row and its cheers.
create table milestone_posts (
  id uuid primary key,
  user_id uuid not null references "users" ("id") on delete cascade,
  kind text not null check (kind in ('new_plant', 'home_dinners', 'new_recipe', 'community_cooked', 'planned_and_ate')),
  week text not null check (week ~ '^\d{4}-W\d{2}$'),
  food_id text,                                  -- catalog food id; no foreign key, like recipes, so catalog refreshes never block
  created_at timestamptz not null default now(),
  check ((kind = 'new_plant') = (food_id is not null))
);
-- One milestone of each kind per person per week.
create unique index milestone_posts_one_per_week on milestone_posts (user_id, kind, week);
create index milestone_posts_recent on milestone_posts (created_at desc);

-- One cheer per person per milestone; changing it replaces the old one. Nobody sees who cheered.
create table milestone_cheers (
  post_id uuid not null references milestone_posts (id) on delete cascade,
  user_id uuid not null references "users" ("id") on delete cascade,
  cheer text not null check (cheer in ('well_done', 'keep_going', 'love_this')),
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);
