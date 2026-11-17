-- People a group admin adds by email before they have an account (owner request 2026-11-17), and
-- meals admins share with their group as a simplified card that members can like or pass on.

-- A person added by email who hasn't joined yet. Kept apart from group_members so no group query
-- ever meets a member without an account. Joining (after signing in with this verified email and
-- tapping Join) moves them into group_members. Unused invites are deleted after expires_at.
create table group_pending_members (
  id uuid primary key,
  group_id uuid not null references groups (id) on delete cascade,
  email text not null check (email = lower(email) and length(email) between 3 and 254),
  display_name text not null,
  role text not null check (role in ('admin', 'member')),
  invited_by uuid references "users" ("id") on delete set null,
  created_at timestamptz not null default now(),
  emailed_at timestamptz,
  expires_at timestamptz not null,
  unique (group_id, email)
);
create index group_pending_members_email on group_pending_members (email);

-- Invite emails sent, for the per-person daily cap. Deleted by the nightly job after two days.
create table group_invite_sends (
  id bigserial primary key,
  user_id uuid not null references "users" ("id") on delete cascade,
  group_id uuid not null references groups (id) on delete cascade,
  sent_at timestamptz not null default now()
);
create index group_invite_sends_user on group_invite_sends (user_id, sent_at desc);

-- A meal an admin shared with the group: a snapshot (title, short description, photo reference,
-- estimated nutrients per serving), never the ingredients or the method. Later recipe edits don't
-- change it. Withdrawing deletes it and its reactions.
create table group_meal_shares (
  id uuid primary key,
  group_id uuid not null references groups (id) on delete cascade,
  created_by uuid not null references "users" ("id") on delete cascade,
  recipe_id uuid references recipes (id) on delete set null,
  snapshot jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index group_meal_shares_group on group_meal_shares (group_id, created_at desc);

-- One reaction per person per shared meal, with an optional comment. Seen by the person and the
-- group's admins. Leaving the group (or the share being withdrawn) deletes it.
create table group_meal_reactions (
  share_id uuid not null references group_meal_shares (id) on delete cascade,
  member_id uuid not null references group_members (id) on delete cascade,
  reaction text not null check (reaction in ('like', 'dislike')),
  comment text not null default '' check (length(comment) <= 280),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (share_id, member_id)
);
create index group_meal_reactions_member on group_meal_reactions (member_id);
