-- VYNDI Supplier Risk Forecasting — Package I
-- Immutable intelligence snapshots derived from approved supplier-lane authority and actual PO/GRN performance.

create table if not exists vyndi_supplier_risk_runs (
  id text primary key,
  result_json jsonb not null,
  source_reference text not null,
  actor_user_id text not null,
  actor_role text not null,
  created_at timestamptz not null default now()
);

comment on table vyndi_supplier_risk_runs is
  'Immutable Supplier Risk snapshots. Governed lane reliability/ratings, empirical delivery history, actual lead-time drift, incoming rejection and alternate-source coverage remain separate evidence dimensions.';
