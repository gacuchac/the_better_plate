-- Cook profile (FEATURE_COOK_PROFILE_ENABLED): someone who cooks for others keeps, per cooked meal,
-- the recipes, the groceries bought for it (from receipts), the time spent and other costs, so
-- charging the people they cook for is one statement. No payments are taken in the app, and no tax
-- is added to the cook's services. Money is in integer cents of the cook's currency.

create table cooks (
  user_id uuid primary key references "users" ("id") on delete cascade,
  business_name text not null default '' check (length(business_name) <= 80),
  currency text not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  hourly_rate_cents integer check (hourly_rate_cents between 0 and 10000000),
  flat_fee_cents integer check (flat_fee_cents between 0 and 10000000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- People the cook cooks for who aren't (yet) in the app: a name and the cook's own notes
-- (allergies included). An invite by email is optional; once the invited person signs in with that
-- verified email and accepts, the client is linked to their account and sees their history.
create table cook_clients (
  id uuid primary key,
  cook_id uuid not null references cooks (user_id) on delete cascade,
  name text not null check (length(name) between 1 and 80),
  notes text not null default '' check (length(notes) <= 2000),
  hourly_rate_cents integer check (hourly_rate_cents between 0 and 10000000),
  invite_email text check (invite_email = lower(invite_email) and length(invite_email) between 3 and 254),
  invited_at timestamptz,
  invite_sent_at timestamptz,
  linked_user_id uuid references "users" ("id") on delete set null,
  linked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index cook_clients_cook on cook_clients (cook_id);
create index cook_clients_invite on cook_clients (invite_email) where invite_email is not null;
create index cook_clients_linked on cook_clients (linked_user_id) where linked_user_id is not null;
create unique index cook_clients_one_link on cook_clients (cook_id, linked_user_id) where linked_user_id is not null;

-- What the cook last paid for a food, per kilogram: from confirmed receipt lines, or typed in.
create table ingredient_prices (
  cook_id uuid not null references cooks (user_id) on delete cascade,
  food_id text not null,
  cents_per_kg numeric(12, 2) not null check (cents_per_kg >= 0),
  source text not null check (source in ('receipt', 'manual')),
  updated_at timestamptz not null default now(),
  primary key (cook_id, food_id)
);

-- A cooked meal: for one target (the cook, a group, one member of a group, or a client), with its
-- recipes, receipts, time and costs. target_name is kept so the meal still reads after the target goes.
create table cook_meals (
  id uuid primary key,
  cook_id uuid not null references cooks (user_id) on delete cascade,
  name text not null check (length(name) between 1 and 120),
  cooked_on date not null,
  target_kind text not null check (target_kind in ('me', 'group', 'member', 'client')),
  group_id uuid references groups (id) on delete set null,
  member_id uuid references group_members (id) on delete set null,
  client_id uuid references cook_clients (id) on delete set null,
  target_name text not null default '',
  hourly_rate_cents integer check (hourly_rate_cents between 0 and 10000000),
  flat_fee_cents integer check (flat_fee_cents between 0 and 10000000),
  cooking_seconds integer not null default 0 check (cooking_seconds between 0 and 864000),
  timer_started_at timestamptz,
  shopping_minutes integer not null default 0 check (shopping_minutes between 0 and 14400),
  travel_minutes integer not null default 0 check (travel_minutes between 0 and 14400),
  notes text not null default '' check (length(notes) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index cook_meals_cook on cook_meals (cook_id, cooked_on desc);
create index cook_meals_client on cook_meals (client_id) where client_id is not null;
create index cook_meals_group on cook_meals (group_id) where group_id is not null;

-- A recipe as cooked for a meal: a snapshot (title, servings, ingredients with grams), so later
-- edits to the recipe don't change what was cooked.
create table cook_meal_recipes (
  id uuid primary key,
  meal_id uuid not null references cook_meals (id) on delete cascade,
  recipe_id uuid,
  title text not null,
  description text not null default '',
  servings numeric(8, 2) not null check (servings > 0),
  ingredients jsonb not null,
  created_at timestamptz not null default now()
);
create index cook_meal_recipes_meal on cook_meal_recipes (meal_id);

-- Other costs of a meal (a rented dish, parking). Not taxed by the app.
create table cook_expenses (
  id uuid primary key,
  meal_id uuid not null references cook_meals (id) on delete cascade,
  label text not null check (length(label) between 1 and 120),
  amount_cents integer not null check (amount_cents between 0 and 10000000),
  created_at timestamptz not null default now()
);
create index cook_expenses_meal on cook_expenses (meal_id);

-- Grocery receipts: read from a photo (kept for the cook only, never shared) or typed in. A draft
-- until the cook confirms every line: which meal it was for, or personal (never billed).
create table cook_receipts (
  id uuid primary key,
  cook_id uuid not null references cooks (user_id) on delete cascade,
  store text not null default '' check (length(store) <= 120),
  purchased_on date,
  subtotal_cents integer check (subtotal_cents between 0 and 100000000),
  tax_cents integer not null default 0 check (tax_cents between 0 and 100000000),
  total_cents integer check (total_cents between 0 and 100000000),
  status text not null default 'draft' check (status in ('draft', 'confirmed')),
  image bytea,
  image_mime text,
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index cook_receipts_cook on cook_receipts (cook_id, created_at desc);

create table cook_receipt_lines (
  id uuid primary key,
  receipt_id uuid not null references cook_receipts (id) on delete cascade,
  position integer not null,
  text text not null check (length(text) <= 200),
  price_cents integer not null check (price_cents between -10000000 and 10000000),
  food_id text,
  grams numeric(10, 2) check (grams > 0),
  meal_id uuid references cook_meals (id) on delete set null,
  personal boolean not null default false,
  -- The receipt's tax spread over the billed lines when the receipt is confirmed.
  tax_cents integer not null default 0,
  check (not (personal and meal_id is not null))
);
create index cook_receipt_lines_receipt on cook_receipt_lines (receipt_id, position);
create index cook_receipt_lines_meal on cook_receipt_lines (meal_id) where meal_id is not null;

-- Statements: several meals for one target added up. Frozen (snapshot) once sent; a meal is on at
-- most one statement that isn't void, so nothing is billed twice.
create table cook_statements (
  id uuid primary key,
  cook_id uuid not null references cooks (user_id) on delete cascade,
  title text not null check (length(title) between 1 and 120),
  target_kind text not null check (target_kind in ('me', 'group', 'member', 'client')),
  group_id uuid references groups (id) on delete set null,
  member_id uuid references group_members (id) on delete set null,
  client_id uuid references cook_clients (id) on delete set null,
  target_name text not null default '',
  status text not null default 'draft' check (status in ('draft', 'sent', 'paid', 'void')),
  snapshot jsonb,
  sent_at timestamptz,
  paid_at timestamptz,
  voided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index cook_statements_cook on cook_statements (cook_id, created_at desc);

create table cook_statement_meals (
  statement_id uuid not null references cook_statements (id) on delete cascade,
  meal_id uuid not null references cook_meals (id) on delete cascade,
  primary key (statement_id, meal_id)
);
create index cook_statement_meals_meal on cook_statement_meals (meal_id);

-- What the cook chose to share of a meal or a statement: always the basics; groceries, time and
-- totals only when switched on. The snapshot is built on the server from those parts only. Shown to
-- the linked client, to the meal's group (money parts to its owner and admins only), and to anyone
-- with the link while link_token is set.
create table cook_shares (
  id uuid primary key,
  cook_id uuid not null references cooks (user_id) on delete cascade,
  meal_id uuid references cook_meals (id) on delete cascade,
  statement_id uuid references cook_statements (id) on delete cascade,
  parts jsonb not null,
  snapshot jsonb not null,
  link_token uuid unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((meal_id is null) <> (statement_id is null))
);
create unique index cook_shares_meal on cook_shares (meal_id) where meal_id is not null;
create unique index cook_shares_statement on cook_shares (statement_id) where statement_id is not null;

-- Invite emails to clients, for a daily per-cook cap. Deleted by the nightly job after two days.
create table cook_invite_sends (
  id bigserial primary key,
  cook_id uuid not null references cooks (user_id) on delete cascade,
  sent_at timestamptz not null default now()
);
create index cook_invite_sends_cook on cook_invite_sends (cook_id, sent_at desc);

-- A group's owner can keep plain members from sharing cooked meals with the group.
alter table groups add column cook_member_shares boolean not null default true;
