create table if not exists vyndi_auth_rate_limits (
  key_hash text primary key,
  window_started_at timestamptz not null default now(),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  updated_at timestamptz not null default now()
);

comment on table vyndi_auth_rate_limits is
  'Shared authentication abuse-rate window state. Stores only SHA-256 keys derived from request source and endpoint; never raw IP addresses, credentials or tokens.';

create index if not exists idx_vyndi_auth_rate_limits_updated_at
  on vyndi_auth_rate_limits(updated_at);
