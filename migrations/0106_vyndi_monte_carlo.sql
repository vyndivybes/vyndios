-- VYNDI Monte Carlo Uncertainty Engine — Package G
-- First governed use: program schedule/cost uncertainty from explicit triangular O/M/P inputs.
-- Physical engineering response probabilities remain blocked until explicit response models exist.

create table if not exists vyndi_monte_carlo_runs (
  id text primary key,
  program_id text not null references vyndi_programs(id) on delete restrict,
  method text not null check (method='MONTE_CARLO_TRIANGULAR_V1'),
  iterations integer not null check (iterations between 100 and 100000),
  seed integer not null,
  input_json jsonb not null,
  result_json jsonb not null,
  source_reference text not null,
  actor_user_id text not null,
  actor_role text not null,
  created_at timestamptz not null default now()
);

create index if not exists vyndi_monte_carlo_runs_program_idx
  on vyndi_monte_carlo_runs(program_id,created_at desc,id desc);

comment on table vyndi_monte_carlo_runs is
  'Immutable seeded Monte Carlo program uncertainty evidence. It samples explicit task schedule/cost O/M/P distributions and recomputes critical path each iteration. It is not a physical material/FEA/validation response model.';
