-- Food preferences each person states (allergies, likes, dislikes) and feedback after a meal.
-- Allergies are only what people tell us: nothing is inferred, diagnosed or tested.

-- One record per person or profile. id is the subject: the user's own id, or a profile's id
-- (profiles arrive in 016). user_id is the account whose kitchen holds the record and syncs it.
create table food_preferences (
  id uuid primary key,
  user_id uuid not null references "users" ("id") on delete cascade,
  profile_id uuid,
  -- listed: allergies are in `allergens`; none: told us none; prefer_not: chose not to say.
  allergy_answer text not null check (allergy_answer in ('listed', 'none', 'prefer_not')),
  allergens text[] not null default '{}',
  likes jsonb not null default '[]',          -- catalog food ids
  dislikes jsonb not null default '[]',       -- catalog food ids
  notes text not null default '',
  version integer not null,
  server_seq bigint not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (allergy_answer = 'listed' or cardinality(allergens) = 0)
);
create index food_preferences_user_seq on food_preferences (user_id, server_seq);

-- How a logged meal went. id is the eaten log's id; editable, versioned like plans.
create table meal_feedback (
  id uuid primary key references consumption_events (id) on delete cascade,
  user_id uuid not null references "users" ("id") on delete cascade,
  rating text check (rating in ('liked', 'disliked')),
  comment text not null default '',
  disliked_food_ids jsonb not null default '[]',
  version integer not null,
  server_seq bigint not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index meal_feedback_user_seq on meal_feedback (user_id, server_seq);
