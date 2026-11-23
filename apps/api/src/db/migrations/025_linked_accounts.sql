-- Linked accounts (FEATURE_LINKED_ACCOUNTS_ENABLED, ADR-015): an account owner shares chosen areas of
-- their account with another person, each area off, view or change. Only the owner sends the request,
-- by the other person's email; nothing is shared until that person, signed in with that verified email,
-- accepts. The owner can change any area or end the link at any time.

create table account_links (
  id uuid primary key,
  owner_user_id uuid not null references "users" ("id") on delete cascade,
  -- The email the owner typed, lower case. The person it reaches is matched by this verified email.
  email text not null check (email = lower(email) and length(email) between 3 and 254),
  -- Set when the person accepts (or when the request was sent to an existing account).
  delegate_user_id uuid references "users" ("id") on delete cascade,
  status text not null check (status in ('requested', 'active', 'declined', 'cancelled', 'removed', 'expired')),
  -- {"areas": {"recipes": "off|view|change", ...}, "aiApps": false}
  permissions jsonb not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  accepted_at timestamptz,
  updated_at timestamptz not null default now(),
  ended_at timestamptz,
  ended_by uuid references "users" ("id") on delete set null
);
-- One live link per owner and person.
create unique index account_links_live on account_links (owner_user_id, email) where status in ('requested', 'active');
create index account_links_owner on account_links (owner_user_id, created_at desc);
create index account_links_delegate on account_links (delegate_user_id) where delegate_user_id is not null;
create index account_links_email on account_links (email) where status = 'requested';

-- Requests one owner sent, for the daily limit; rows older than two days are cleared nightly.
create table account_link_sends (
  owner_user_id uuid not null references "users" ("id") on delete cascade,
  sent_at timestamptz not null default now()
);
create index account_link_sends_owner on account_link_sends (owner_user_id, sent_at);

-- What was done in an account by someone it is linked to, and changes to the link itself.
-- Kept 12 months. The account owner and the person who acted both see their entries.
create table linked_activity (
  id uuid primary key default gen_random_uuid(),
  account_user_id uuid not null references "users" ("id") on delete cascade,
  -- Who acted; cleared if that account is deleted, the name copy stays so the owner's history reads.
  actor_user_id uuid references "users" ("id") on delete set null,
  actor_name text not null,
  link_id uuid references account_links (id) on delete set null,
  via text not null check (via in ('app', 'connector')),
  app_name text,
  client_id text,
  action text not null,
  target_id text,
  created_at timestamptz not null default now()
);
create index linked_activity_account on linked_activity (account_user_id, created_at desc);
create index linked_activity_actor on linked_activity (actor_user_id, created_at desc) where actor_user_id is not null;
