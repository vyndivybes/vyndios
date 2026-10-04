-- VYNDI Manufacturing & Quality Intelligence — Package H
-- Extends canonical Quality authority with dimensional measurement evidence and immutable intelligence snapshots.

create table if not exists vyndi_quality_measurements (
  id text primary key,
  inspection_id text references vyndi_quality_inspections(id) on delete restrict,
  traveller_id text references epr_travellers(id) on delete restrict,
  job_card_id text references epr_production_job_cards(id) on delete restrict,
  characteristic_code text not null,
  characteristic_name text not null,
  unit text not null,
  measured_value numeric(18,6) not null,
  nominal_value numeric(18,6),
  lower_spec_limit numeric(18,6),
  upper_spec_limit numeric(18,6),
  measurement_method text not null,
  equipment_ref text,
  source_reference text not null,
  recorded_by text not null,
  recorded_role text not null,
  recorded_at timestamptz not null default now(),
  check (
    lower_spec_limit is null or upper_spec_limit is null
    or lower_spec_limit < upper_spec_limit
  )
);

create index if not exists vyndi_quality_measurements_characteristic_idx
  on vyndi_quality_measurements(characteristic_code,recorded_at,id);

create table if not exists vyndi_quality_intelligence_runs (
  id text primary key,
  result_json jsonb not null,
  source_reference text not null,
  actor_user_id text not null,
  actor_role text not null,
  created_at timestamptz not null default now()
);

comment on table vyndi_quality_measurements is
  'Canonical dimensional/process measurement evidence for capability analysis. Cp/Cpk is withheld until sample size and specification-limit evidence are sufficient.';
comment on table vyndi_quality_intelligence_runs is
  'Immutable quality/manufacturing intelligence snapshots derived from canonical inspection, NCR/CAPA, release, measurement and job-cost evidence.';
