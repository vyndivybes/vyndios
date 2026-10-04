-- VYNDI Program/Gate Planning Engine — Package B
-- Extends the canonical Integrated Operating Plan with a governed task/dependency graph.
-- No schedule probability is inferred here; probabilistic forecasting is a later engine.

create table if not exists vyndi_programs (
  id text primary key,
  title text not null,
  description text not null default '',
  status text not null default 'active' check (status in ('draft','active','on_hold','closed')),
  source_reference text not null,
  record_revision integer not null default 1 check (record_revision > 0),
  updated_by text not null,
  updated_at timestamptz not null default now()
);

insert into vyndi_programs(id,title,description,status,source_reference,updated_by)
values(
  'VYNDI-MASTER-PROGRAM',
  'VYNDI Master Program',
  'Governed program/gate plan linked to the Integrated Operating Plan. Task dates and durations require explicit controlled entry.',
  'active',
  'integrated-operating-plan',
  'system:migration-0101'
)
on conflict(id) do nothing;

create table if not exists vyndi_program_tasks (
  id text primary key,
  program_id text not null references vyndi_programs(id) on delete restrict,
  title text not null,
  domain text not null default 'program',
  work_package text not null default '',
  owner text,
  status text not null default 'planned'
    check (status in ('planned','ready','in_progress','blocked','complete','waived')),
  duration_days integer not null check (duration_days > 0),
  planned_start date,
  planned_finish date,
  actual_start date,
  actual_finish date,
  gate_id text,
  required_inputs jsonb not null default '[]'::jsonb,
  required_evidence jsonb not null default '[]'::jsonb,
  risk_ids jsonb not null default '[]'::jsonb,
  estimated_effort_hours numeric(12,2),
  actual_effort_hours numeric(12,2),
  cost_lakh numeric(18,4),
  confidence numeric(5,4),
  technical_maturity integer,
  source_reference text not null,
  record_revision integer not null default 1 check (record_revision > 0),
  updated_by text not null,
  updated_at timestamptz not null default now(),
  check (planned_finish is null or planned_start is null or planned_finish >= planned_start),
  check (actual_finish is null or actual_start is null or actual_finish >= actual_start),
  check (estimated_effort_hours is null or estimated_effort_hours >= 0),
  check (actual_effort_hours is null or actual_effort_hours >= 0),
  check (cost_lakh is null or cost_lakh >= 0),
  check (confidence is null or confidence between 0 and 1),
  check (technical_maturity is null or technical_maturity between 0 and 100)
);

create index if not exists vyndi_program_tasks_program_idx
  on vyndi_program_tasks(program_id,status,id);

create table if not exists vyndi_program_dependencies (
  program_id text not null references vyndi_programs(id) on delete restrict,
  predecessor_id text not null references vyndi_program_tasks(id) on delete restrict,
  successor_id text not null references vyndi_program_tasks(id) on delete restrict,
  dependency_type text not null default 'finish_to_start'
    check (dependency_type='finish_to_start'),
  lag_days integer not null default 0 check (lag_days >= 0),
  source_reference text not null,
  created_by text not null,
  created_at timestamptz not null default now(),
  primary key(program_id,predecessor_id,successor_id),
  check (predecessor_id<>successor_id)
);

create or replace view vyndi_program_plan_authority as
select
  t.*,
  coalesce(jsonb_agg(
    jsonb_build_object(
      'predecessorId',d.predecessor_id,
      'lagDays',d.lag_days,
      'sourceReference',d.source_reference
    )
  ) filter (where d.predecessor_id is not null),'[]'::jsonb) as predecessors
from vyndi_program_tasks t
left join vyndi_program_dependencies d
  on d.program_id=t.program_id and d.successor_id=t.id
group by t.id;

comment on table vyndi_program_tasks is
  'Governed program tasks/work packages. Duration, owners, dates, evidence, risk links, effort and cost are explicit planning inputs, not inferred facts.';
comment on table vyndi_program_dependencies is
  'Governed finish-to-start task relationships used by deterministic critical-path calculation.';
comment on view vyndi_program_plan_authority is
  'Canonical program-plan read model. Critical path is calculated in application logic from persisted tasks and dependencies; probabilistic forecasts are not produced by this view.';
