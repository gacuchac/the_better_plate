-- People added by email join the group on their first sign-in (once they agree to the privacy notice),
-- with no tap. Home then tells them who added them and offers Leave, until they dismiss it.
alter table group_members
  add column joined_by_email boolean not null default false,
  add column added_by uuid references "users" ("id") on delete set null,
  add column welcome_seen_at timestamptz;

create index group_members_welcome_idx on group_members (user_id) where joined_by_email and welcome_seen_at is null;
