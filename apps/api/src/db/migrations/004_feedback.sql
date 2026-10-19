-- User-submitted issue reports. Personal content is limited to what the person reviewed and sent.
create table feedback_reports (
  id uuid primary key,                       -- client-generated: retries never create duplicates
  user_id uuid references "users" ("id") on delete cascade,   -- deleting an account deletes its reports
  kind text not null check (kind in ('bug', 'feedback', 'suggestion')),
  message text not null,
  activity jsonb not null,                   -- readable steps the person chose to include
  context jsonb not null,                    -- route, app version, device class, request ids, sanitized error
  screenshot bytea,                          -- optional, only after the person previewed it
  screenshot_type text,
  status text not null default 'new' check (status in ('new', 'triaged', 'in_progress', 'resolved', 'wont_fix')),
  created_at timestamptz not null default now()
);
create index feedback_reports_status on feedback_reports (status, created_at desc);
