-- Lets the daily maintenance job find old idempotency records and expired sessions cheaply.
create index sync_operations_created on sync_operations (created_at);
create index sessions_expires on "sessions" ("expiresAt");
