-- Groups (a family, a nutritionist and their clients): an owner and admins plan meals for members.
-- Kids are profiles owned by a parent's account: no email, password or login, no birthdate.

create table profiles (
  id uuid primary key,
  owner_user_id uuid not null references "users" ("id") on delete cascade,
  name text not null,
  version integer not null,
  server_seq bigint not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index profiles_owner_seq on profiles (owner_user_id, server_seq);

alter table food_preferences add constraint food_preferences_profile_fk foreign key (profile_id) references profiles (id) on delete cascade;

create table groups (
  id uuid primary key,
  name text not null,
  owner_user_id uuid not null references "users" ("id") on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- A member is a person (user_id) or a profile (profile_id). display_name is how a person appears to
-- the group, chosen by them, so emails are never shown to other members.
create table group_members (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references groups (id) on delete cascade,
  user_id uuid references "users" ("id") on delete cascade,
  profile_id uuid references profiles (id) on delete cascade,
  role text not null check (role in ('owner', 'admin', 'member')),
  display_name text not null,
  created_at timestamptz not null default now(),
  check ((user_id is null) <> (profile_id is null)),
  check (profile_id is null or role = 'member'),
  unique (group_id, user_id),
  unique (group_id, profile_id)
);
create unique index group_members_one_owner on group_members (group_id) where role = 'owner';
create index group_members_user on group_members (user_id) where user_id is not null;
create index group_members_profile on group_members (profile_id) where profile_id is not null;

-- Single-use invite links; the id is the unguessable token in the link.
create table group_invites (
  id uuid primary key,
  group_id uuid not null references groups (id) on delete cascade,
  role text not null check (role in ('admin', 'member')),
  created_by uuid not null references "users" ("id") on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz,
  used_by uuid references "users" ("id") on delete set null,
  revoked_at timestamptz
);
create index group_invites_group on group_invites (group_id, created_at desc);

-- Group recipes: any admin can edit them, every member can read them. user_id stays the creator.
alter table recipes add column group_id uuid references groups (id) on delete set null;
create index recipes_group_seq on recipes (group_id, server_seq) where group_id is not null;

-- Plans: for whom (a profile, or the account itself), which group planned it, who last planned it,
-- and whether it waits for an admin's approval.
alter table planned_meals
  add column profile_id uuid references profiles (id) on delete cascade,
  add column group_id uuid references groups (id) on delete set null,
  add column author_user_id uuid references "users" ("id") on delete set null,
  add column status text not null default 'planned' check (status in ('planned', 'proposed', 'declined'));
create index planned_meals_profile_date on planned_meals (profile_id, local_date) where deleted_at is null and profile_id is not null;

alter table consumption_events add column profile_id uuid references profiles (id) on delete cascade;
create index consumption_events_profile_date on consumption_events (profile_id, local_date) where deleted_at is null and profile_id is not null;

alter table meal_feedback add column profile_id uuid references profiles (id) on delete cascade;
