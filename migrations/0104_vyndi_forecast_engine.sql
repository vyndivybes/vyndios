-- VYNDI Forecast Engine — Package E
-- Three-point schedule/cost inputs are explicit. PERT outputs are planning approximations, not commitments.

alter table vyndi_program_tasks
  add column if not exists optimistic_days numeric(10,2),
  add column if not exists most_likely_days numeric(10,2),
  add column if not exists pessimistic_days numeric(10,2),
  add column if not exists cost_forecast_required boolean not null default false,
  add column if not exists cost_optimistic_lakh numeric(18,4),
  add column if not exists cost_most_likely_lakh numeric(18,4),
  add column if not exists cost_pessimistic_lakh numeric(18,4);

do $$
begin
  if not exists(select 1 from pg_constraint where conname='vyndi_program_task_schedule_pert_chk') then
    alter table vyndi_program_tasks add constraint vyndi_program_task_schedule_pert_chk
      check (
        (optimistic_days is null or optimistic_days>0)
        and (most_likely_days is null or most_likely_days>0)
        and (pessimistic_days is null or pessimistic_days>0)
        and (
          optimistic_days is null or most_likely_days is null or pessimistic_days is null
          or (optimistic_days<=most_likely_days and most_likely_days<=pessimistic_days)
        )
      );
  end if;
  if not exists(select 1 from pg_constraint where conname='vyndi_program_task_cost_pert_chk') then
    alter table vyndi_program_tasks add constraint vyndi_program_task_cost_pert_chk
      check (
        (cost_optimistic_lakh is null or cost_optimistic_lakh>=0)
        and (cost_most_likely_lakh is null or cost_most_likely_lakh>=0)
        and (cost_pessimistic_lakh is null or cost_pessimistic_lakh>=0)
        and (
          cost_optimistic_lakh is null or cost_most_likely_lakh is null or cost_pessimistic_lakh is null
          or (cost_optimistic_lakh<=cost_most_likely_lakh and cost_most_likely_lakh<=cost_pessimistic_lakh)
        )
      );
  end if;
end $$;

create table if not exists vyndi_program_forecast_runs (
  id text primary key,
  program_id text not null references vyndi_programs(id) on delete restrict,
  method text not null check (method='PERT_NORMAL_APPROXIMATION'),
  input_json jsonb not null,
  result_json jsonb not null,
  source_reference text not null,
  actor_user_id text not null,
  actor_role text not null,
  created_at timestamptz not null default now()
);

create index if not exists vyndi_program_forecast_runs_program_idx
  on vyndi_program_forecast_runs(program_id,created_at desc);

comment on table vyndi_program_forecast_runs is
  'Immutable governed schedule/cost forecast snapshots. P50/P80/P95 are PERT-normal planning approximations from explicit three-point inputs, not promised dates or Monte Carlo results.';
