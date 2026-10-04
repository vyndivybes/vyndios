-- VYNDI Earned Value Intelligence — Package K
-- Extends the governed Master Program with evidence-backed physical progress and actual-cost evidence.
-- EV is derived; it is never entered as an editable amount.

alter table vyndi_program_tasks
  add column if not exists progress_pct numeric(5,2),
  add column if not exists progress_evidence_ref text,
  add column if not exists actual_cost_lakh numeric(18,4),
  add column if not exists actual_cost_source_ref text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname='vyndi_program_tasks_progress_pct_chk') then
    alter table vyndi_program_tasks add constraint vyndi_program_tasks_progress_pct_chk
      check (progress_pct is null or progress_pct between 0 and 100);
  end if;
  if not exists (select 1 from pg_constraint where conname='vyndi_program_tasks_actual_cost_chk') then
    alter table vyndi_program_tasks add constraint vyndi_program_tasks_actual_cost_chk
      check (actual_cost_lakh is null or actual_cost_lakh >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname='vyndi_program_tasks_progress_evidence_chk') then
    alter table vyndi_program_tasks add constraint vyndi_program_tasks_progress_evidence_chk
      check (progress_pct is null or nullif(btrim(progress_evidence_ref),'') is not null);
  end if;
  if not exists (select 1 from pg_constraint where conname='vyndi_program_tasks_actual_cost_evidence_chk') then
    alter table vyndi_program_tasks add constraint vyndi_program_tasks_actual_cost_evidence_chk
      check (actual_cost_lakh is null or nullif(btrim(actual_cost_source_ref),'') is not null);
  end if;
end $$;

create table if not exists vyndi_earned_value_runs (
  id text primary key,
  program_id text not null references vyndi_programs(id) on delete restrict,
  as_of_date date not null,
  method text not null check (method='VYNDI_EVM_1'),
  input_json jsonb not null,
  result_json jsonb not null,
  source_reference text not null,
  actor_user_id text not null,
  actor_role text not null,
  created_at timestamptz not null default now()
);

create index if not exists vyndi_earned_value_runs_program_idx
  on vyndi_earned_value_runs(program_id,as_of_date desc,created_at desc,id desc);

comment on column vyndi_program_tasks.progress_pct is
  'Evidence-backed physical progress percentage for an in-progress task. Earned Value is calculated from this field and BAC; EV itself is never stored as an editable task input.';
comment on column vyndi_program_tasks.actual_cost_lakh is
  'Governed actual cost evidence for task performance measurement; source evidence is mandatory whenever a value is present.';
comment on table vyndi_earned_value_runs is
  'Immutable governed Earned Value snapshots containing BAC/PV/EV/AC, CPI/SPI, variances and forecast-at-completion measures. Advisory only; no budget, payment, schedule or release authority.';
