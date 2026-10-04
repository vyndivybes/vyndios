-- VYNDI Package N — Forecast Learning Loop
-- Immutable pre-period forecast vintages + revisioned actual close evidence.
-- Learning never backfills a forecast after the target period has started.

create table if not exists vyndi_forecast_vintages (
  id text primary key,
  approved_plan_id text not null references vyndi_plan_revisions(id) on delete restrict,
  approved_plan_revision integer not null check (approved_plan_revision>0),
  horizon_start date not null,
  cutoff_at timestamptz not null,
  captured_at timestamptz not null default now(),
  source_sha text not null check (length(trim(source_sha))>=7),
  source_reference text not null,
  captured_by text not null,
  captured_role text not null
);

create table if not exists vyndi_forecast_vintage_lines (
  vintage_id text not null references vyndi_forecast_vintages(id) on delete restrict,
  period_start date not null,
  plan_month integer not null check (plan_month between 1 and 36),
  product_id text not null check (product_id in ('aluminium','carbon','premiumCarbon')),
  plan_qty numeric(18,4) not null check (plan_qty>=0),
  committed_qty numeric(18,4) not null check (committed_qty>=0),
  forecast_qty numeric(18,4) not null check (forecast_qty>=0),
  source_reference text not null,
  primary key(vintage_id,period_start,product_id)
);
create index if not exists vyndi_forecast_vintage_period_idx
  on vyndi_forecast_vintage_lines(period_start,product_id,vintage_id);

create table if not exists vyndi_learning_period_closes (
  id text primary key,
  period_start date not null,
  period_end date not null,
  plan_month integer not null check (plan_month between 1 and 36),
  revision integer not null check (revision>0),
  actual_units numeric(18,4) not null check (actual_units>=0),
  revenue_lakh numeric(18,4) not null,
  procurement_cash_lakh numeric(18,4) not null,
  closing_cash_lakh numeric(18,4),
  cash_verified boolean not null default false,
  actual_revision integer,
  source_reference text not null,
  closed_by text not null,
  closed_role text not null,
  closed_at timestamptz not null default now(),
  unique(period_start,revision),
  check(period_end>=period_start)
);

create table if not exists vyndi_learning_period_close_products (
  close_id text not null references vyndi_learning_period_closes(id) on delete restrict,
  product_id text not null check (product_id in ('aluminium','carbon','premiumCarbon')),
  actual_qty numeric(18,4) not null check (actual_qty>=0),
  source_reference text not null,
  primary key(close_id,product_id)
);
create index if not exists vyndi_learning_close_period_idx
  on vyndi_learning_period_closes(period_start,revision desc);

create table if not exists vyndi_forecast_learning_runs (
  id text primary key,
  as_of timestamptz not null,
  minimum_closed_periods integer not null check (minimum_closed_periods>=1),
  eligible_closed_periods integer not null check (eligible_closed_periods>=0),
  available boolean not null,
  result_json jsonb not null,
  source_reference text not null,
  created_by text not null,
  created_role text not null,
  created_at timestamptz not null default now()
);

comment on table vyndi_forecast_vintages is
  'Immutable forecast vintages tied to an approved operating-plan revision and explicit cutoff. A vintage captured on/after a target period start is never eligible to score that period.';
comment on table vyndi_learning_period_closes is
  'Revisioned period-close evidence. Later corrections create a new revision; earlier close records remain immutable and are logically superseded, never rewritten.';
comment on table vyndi_forecast_learning_runs is
  'Immutable advisory forecast-learning snapshots. They do not modify approved plans or transaction truth.';

create or replace function vyndi_reject_forecast_learning_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'Forecast learning evidence is immutable: % on % is not permitted.',tg_op,tg_table_name;
end;
$$;

drop trigger if exists trg_vyndi_forecast_vintages_immutable on vyndi_forecast_vintages;
create trigger trg_vyndi_forecast_vintages_immutable
before update or delete on vyndi_forecast_vintages
for each row execute function vyndi_reject_forecast_learning_mutation();

drop trigger if exists trg_vyndi_forecast_vintage_lines_immutable on vyndi_forecast_vintage_lines;
create trigger trg_vyndi_forecast_vintage_lines_immutable
before update or delete on vyndi_forecast_vintage_lines
for each row execute function vyndi_reject_forecast_learning_mutation();

drop trigger if exists trg_vyndi_learning_period_closes_immutable on vyndi_learning_period_closes;
create trigger trg_vyndi_learning_period_closes_immutable
before update or delete on vyndi_learning_period_closes
for each row execute function vyndi_reject_forecast_learning_mutation();

drop trigger if exists trg_vyndi_learning_period_close_products_immutable on vyndi_learning_period_close_products;
create trigger trg_vyndi_learning_period_close_products_immutable
before update or delete on vyndi_learning_period_close_products
for each row execute function vyndi_reject_forecast_learning_mutation();

drop trigger if exists trg_vyndi_forecast_learning_runs_immutable on vyndi_forecast_learning_runs;
create trigger trg_vyndi_forecast_learning_runs_immutable
before update or delete on vyndi_forecast_learning_runs
for each row execute function vyndi_reject_forecast_learning_mutation();

create or replace function capture_vyndi_forecast_vintage(
  p_id text,
  p_plan_id text,
  p_plan_revision integer,
  p_horizon_start date,
  p_cutoff_at timestamptz,
  p_source_sha text,
  p_source_reference text,
  p_lines jsonb,
  p_actor_user_id text,
  p_actor_role text
) returns text
language plpgsql
as $$
declare
  v_count integer;
begin
  if trim(coalesce(p_source_reference,''))='' then raise exception 'Forecast vintage source reference is required.'; end if;
  if length(trim(coalesce(p_source_sha,'')))<7 then raise exception 'Forecast vintage source SHA is required.'; end if;
  if jsonb_typeof(p_lines)<>'array' or jsonb_array_length(p_lines)=0 then raise exception 'Forecast vintage lines are required.'; end if;
  if not exists(
    select 1 from vyndi_plan_revisions
     where id=p_plan_id and revision=p_plan_revision and status='approved'
  ) then raise exception 'Forecast vintage requires the current approved operating-plan revision.'; end if;

  insert into vyndi_forecast_vintages(
    id,approved_plan_id,approved_plan_revision,horizon_start,cutoff_at,source_sha,source_reference,captured_by,captured_role
  ) values(
    p_id,p_plan_id,p_plan_revision,p_horizon_start,p_cutoff_at,trim(p_source_sha),trim(p_source_reference),p_actor_user_id,p_actor_role
  );

  insert into vyndi_forecast_vintage_lines(
    vintage_id,period_start,plan_month,product_id,plan_qty,committed_qty,forecast_qty,source_reference
  )
  select
    p_id,x.period_start,x.plan_month,x.product_id,x.plan_qty,x.committed_qty,x.forecast_qty,trim(p_source_reference)
  from jsonb_to_recordset(p_lines) as x(
    period_start date,
    plan_month integer,
    product_id text,
    plan_qty numeric,
    committed_qty numeric,
    forecast_qty numeric
  );

  get diagnostics v_count=row_count;
  if v_count<>jsonb_array_length(p_lines) then raise exception 'Forecast vintage line count mismatch.'; end if;

  insert into vyndi_audit_events(
    id,entity_type,entity_id,entity_revision,action,actor_user_id,actor_role,source_reference,payload_json
  ) values(
    'AUD-FCST-VINTAGE-'||p_id,'forecast_vintage',p_id,p_plan_revision,'captured',
    p_actor_user_id,p_actor_role,trim(p_source_reference),
    jsonb_build_object('approvedPlanId',p_plan_id,'approvedPlanRevision',p_plan_revision,'horizonStart',p_horizon_start,'cutoffAt',p_cutoff_at,'lineCount',v_count,'sourceSha',trim(p_source_sha))
  );
  return p_id;
end;
$$;

create or replace function close_vyndi_learning_period(
  p_id text,
  p_period_start date,
  p_period_end date,
  p_plan_month integer,
  p_actual_units numeric,
  p_revenue_lakh numeric,
  p_procurement_cash_lakh numeric,
  p_closing_cash_lakh numeric,
  p_cash_verified boolean,
  p_actual_revision integer,
  p_source_reference text,
  p_products jsonb,
  p_actor_user_id text,
  p_actor_role text
) returns table(close_id text,revision integer)
language plpgsql
as $$
declare
  v_revision integer;
  v_count integer;
begin
  if trim(coalesce(p_source_reference,''))='' then raise exception 'Learning period close source reference is required.'; end if;
  if p_period_end>=current_date then raise exception 'Learning period cannot close before the calendar period has ended.'; end if;
  if p_plan_month<1 or p_plan_month>36 then raise exception 'Learning plan month must be between 1 and 36.'; end if;
  if jsonb_typeof(p_products)<>'array' then raise exception 'Learning period product actuals must be an array.'; end if;

  perform pg_advisory_xact_lock(hashtext('forecast-learning-close|'||p_period_start::text)::bigint);
  select coalesce(max(c.revision),0)+1 into v_revision
    from vyndi_learning_period_closes c where c.period_start=p_period_start;

  insert into vyndi_learning_period_closes(
    id,period_start,period_end,plan_month,revision,actual_units,revenue_lakh,procurement_cash_lakh,
    closing_cash_lakh,cash_verified,actual_revision,source_reference,closed_by,closed_role
  ) values(
    p_id,p_period_start,p_period_end,p_plan_month,v_revision,
    greatest(coalesce(p_actual_units,0),0),coalesce(p_revenue_lakh,0),coalesce(p_procurement_cash_lakh,0),
    p_closing_cash_lakh,coalesce(p_cash_verified,false),p_actual_revision,
    trim(p_source_reference),p_actor_user_id,p_actor_role
  );

  insert into vyndi_learning_period_close_products(close_id,product_id,actual_qty,source_reference)
  select p_id,x.product_id,greatest(coalesce(x.actual_qty,0),0),trim(p_source_reference)
  from jsonb_to_recordset(p_products) as x(product_id text,actual_qty numeric);
  get diagnostics v_count=row_count;

  insert into vyndi_audit_events(
    id,entity_type,entity_id,entity_revision,action,actor_user_id,actor_role,source_reference,payload_json
  ) values(
    'AUD-FCST-CLOSE-'||p_id,'forecast_learning_close',p_id,v_revision,'closed',
    p_actor_user_id,p_actor_role,trim(p_source_reference),
    jsonb_build_object('periodStart',p_period_start,'periodEnd',p_period_end,'planMonth',p_plan_month,'revision',v_revision,
      'actualUnits',p_actual_units,'revenueLakh',p_revenue_lakh,'procurementCashLakh',p_procurement_cash_lakh,
      'closingCashLakh',p_closing_cash_lakh,'cashVerified',p_cash_verified,'actualRevision',p_actual_revision,'productRows',v_count)
  );

  return query select p_id,v_revision;
end;
$$;

create or replace function save_vyndi_forecast_learning_run(
  p_id text,
  p_as_of timestamptz,
  p_minimum_closed_periods integer,
  p_eligible_closed_periods integer,
  p_available boolean,
  p_result_json jsonb,
  p_source_reference text,
  p_actor_user_id text,
  p_actor_role text
) returns text
language plpgsql
as $$
begin
  if trim(coalesce(p_source_reference,''))='' then raise exception 'Forecast learning snapshot source reference is required.'; end if;
  insert into vyndi_forecast_learning_runs(
    id,as_of,minimum_closed_periods,eligible_closed_periods,available,result_json,source_reference,created_by,created_role
  ) values(
    p_id,p_as_of,p_minimum_closed_periods,p_eligible_closed_periods,p_available,p_result_json,trim(p_source_reference),p_actor_user_id,p_actor_role
  );
  insert into vyndi_audit_events(
    id,entity_type,entity_id,entity_revision,action,actor_user_id,actor_role,source_reference,payload_json
  ) values(
    'AUD-FCST-LEARN-'||p_id,'forecast_learning_run',p_id,1,'captured',
    p_actor_user_id,p_actor_role,trim(p_source_reference),
    jsonb_build_object('asOf',p_as_of,'minimumClosedPeriods',p_minimum_closed_periods,'eligibleClosedPeriods',p_eligible_closed_periods,'available',p_available)
  );
  return p_id;
end;
$$;
