-- The included companion (an owner-provided OpenAI key) has its own counters: a daily
-- per-person cap and a monthly spend cap estimated from token counts. Rows outlive a deleted
-- account (user_id set null) so deleting and re-creating accounts can't reset the monthly total.
-- Per-day counters only: no prompts, replies or tool data are stored.
create table ai_house_usage (
  id bigserial primary key,
  user_id uuid references "users" ("id") on delete set null,
  day date not null,
  model text not null,
  requests integer not null default 0,
  input_tokens bigint not null default 0,
  output_tokens bigint not null default 0,
  unique (user_id, day, model)
);
create index ai_house_usage_day on ai_house_usage (day);
