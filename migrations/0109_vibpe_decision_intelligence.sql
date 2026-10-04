-- VIBPE Decision Intelligence — Package J
-- Immutable advisory packets only. No approval, transaction, release, funding or risk-acceptance authority is created.

create table if not exists vyndi_decision_intelligence_runs (
  id text primary key,
  result_json jsonb not null,
  source_reference text not null,
  actor_user_id text not null,
  actor_role text not null,
  created_at timestamptz not null default now()
);

create index if not exists vyndi_decision_intelligence_runs_created_idx
  on vyndi_decision_intelligence_runs(created_at desc,id desc);

comment on table vyndi_decision_intelligence_runs is
  'Immutable advisory VIBPE decision-option snapshots. Option ordering uses explicit governance priority, never an invented utility score. Human authority remains mandatory for all controlled actions.';
