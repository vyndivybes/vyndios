-- VYNDI Engineering Scenario Engine — Package F
-- Scenario snapshots are advisory. They do not mutate governed Engineering, Program, Risk or transaction authority.

create table if not exists vyndi_engineering_scenario_runs (
  id text primary key,
  scenario_name text not null,
  source_node_id text not null,
  target_task_id text,
  source_repository text not null,
  source_commit text not null,
  as_of_date date not null,
  assumption_json jsonb not null,
  baseline_json jsonb not null,
  scenario_json jsonb not null,
  impact_json jsonb not null,
  linked_program_tasks jsonb not null default '[]'::jsonb,
  linked_risks jsonb not null default '[]'::jsonb,
  source_reference text not null,
  actor_user_id text not null,
  actor_role text not null,
  created_at timestamptz not null default now()
);

create index if not exists vyndi_engineering_scenario_runs_created_idx
  on vyndi_engineering_scenario_runs(created_at desc,id desc);

comment on table vyndi_engineering_scenario_runs is
  'Immutable advisory engineering what-if snapshots. Scenario assumptions are isolated from governed plan/engineering records and never authorize configuration change or release.';
