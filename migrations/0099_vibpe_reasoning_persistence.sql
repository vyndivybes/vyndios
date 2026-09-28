-- VIBPE P0 reasoning persistence and calibration telemetry.
-- This migration adds durable advisory context and immutable answer receipts.
-- It does not create transaction-writing authority for VIBPE.

create table if not exists vyndi_vibpe_decision_sessions (
  owner_key text not null,
  session_key text not null,
  state_json jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (owner_key, session_key)
);

create table if not exists vyndi_vibpe_answer_receipts (
  answer_id text primary key,
  owner_key text not null,
  session_key text not null,
  intent text not null,
  data_mode text not null check (data_mode in ('live','partial','degraded','fixture','assumption-dependent')),
  receipt_json jsonb not null,
  created_at timestamptz not null
);

create index if not exists vyndi_vibpe_answer_receipts_session_idx
  on vyndi_vibpe_answer_receipts(owner_key, session_key, created_at desc);

create table if not exists vyndi_vibpe_answer_quality_events (
  id bigserial primary key,
  answer_id text not null references vyndi_vibpe_answer_receipts(answer_id) on delete cascade,
  event_type text not null check (event_type in ('accepted','corrected','rejected','outcome')),
  predicted_confidence numeric(5,4),
  observed_correct boolean,
  details_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists vyndi_vibpe_answer_quality_events_answer_idx
  on vyndi_vibpe_answer_quality_events(answer_id, created_at desc);

comment on table vyndi_vibpe_decision_sessions is
  'Durable advisory VIBPE conversational/decision context. Never a business transaction authority.';
comment on table vyndi_vibpe_answer_receipts is
  'Immutable evidence/reasoning receipts for substantive VIBPE answers.';
comment on table vyndi_vibpe_answer_quality_events is
  'Human correction/outcome telemetry used to calibrate VIBPE confidence and benchmark quality.';
