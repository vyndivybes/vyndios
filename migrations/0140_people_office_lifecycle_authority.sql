-- People & Office operational lifecycle authority
-- Extends the existing canonical vyndi_people_records master with append-only
-- specialist ledgers and fail-closed cross-ledger exit governance.

alter table vyndi_people_records
  add column if not exists record_revision integer not null default 1,
  add column if not exists operational_status text not null default 'planned',
  add column if not exists employee_code text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname='vyndi_people_records_record_revision_chk') then
    alter table vyndi_people_records add constraint vyndi_people_records_record_revision_chk
      check (record_revision > 0);
  end if;
  if not exists (select 1 from pg_constraint where conname='vyndi_people_records_operational_status_chk') then
    alter table vyndi_people_records add constraint vyndi_people_records_operational_status_chk
      check (operational_status in ('planned','active','on_leave','exiting','inactive'));
  end if;
end $$;

create unique index if not exists vyndi_people_records_employee_code_uq
  on vyndi_people_records(employee_code)
  where employee_code is not null and btrim(employee_code)<>'';

update vyndi_people_records
set operational_status=case
  when lifecycle_status='approved' and engagement_type<>'planned_role' then 'active'
  when lifecycle_status in ('inactive','superseded') then 'inactive'
  else 'planned'
end
where operational_status='planned';

create table if not exists vyndi_people_employment_ledger (
  id text primary key,
  person_id text not null references vyndi_people_records(id) on delete restrict,
  event_type text not null check (event_type in (
    'joined','role_change','transfer','promotion','compensation_change',
    'status_change','exit_initiated','separated'
  )),
  effective_on date not null,
  details_json jsonb not null default '{}'::jsonb,
  person_revision integer not null check (person_revision > 0),
  source_ref text not null,
  evidence_ref text not null,
  recorded_by text not null,
  recorded_role text not null,
  created_at timestamptz not null default now()
);
create index if not exists vyndi_people_employment_person_idx
  on vyndi_people_employment_ledger(person_id,effective_on desc,created_at desc);

create table if not exists vyndi_people_attendance_ledger (
  id text primary key,
  person_id text not null references vyndi_people_records(id) on delete restrict,
  work_date date not null,
  revision integer not null check (revision > 0),
  attendance_status text not null check (attendance_status in ('present','absent','leave','holiday','remote','travel')),
  worked_hours numeric(8,3) not null default 0 check (worked_hours >= 0 and worked_hours <= 24),
  overtime_hours numeric(8,3) not null default 0 check (overtime_hours >= 0 and overtime_hours <= 24),
  notes text not null default '',
  source_ref text not null,
  evidence_ref text not null,
  recorded_by text not null,
  recorded_role text not null,
  created_at timestamptz not null default now(),
  unique(person_id,work_date,revision),
  check (worked_hours + overtime_hours <= 24)
);
create index if not exists vyndi_people_attendance_person_date_idx
  on vyndi_people_attendance_ledger(person_id,work_date desc,revision desc);

create table if not exists vyndi_people_leave_ledger (
  id text primary key,
  person_id text not null references vyndi_people_records(id) on delete restrict,
  leave_type text not null,
  transaction_type text not null check (transaction_type in ('entitlement','accrual','approved_leave','cancellation','adjustment','expiry')),
  direction text not null check (direction in ('credit','debit')),
  quantity_days numeric(10,3) not null check (quantity_days > 0),
  effective_on date not null,
  related_reference text,
  notes text not null default '',
  source_ref text not null,
  evidence_ref text not null,
  recorded_by text not null,
  recorded_role text not null,
  created_at timestamptz not null default now()
);
create index if not exists vyndi_people_leave_person_idx
  on vyndi_people_leave_ledger(person_id,leave_type,effective_on desc,created_at desc);

create table if not exists vyndi_people_qualification_ledger (
  id text primary key,
  person_id text not null references vyndi_people_records(id) on delete restrict,
  qualification_code text not null,
  qualification_title text not null,
  event_type text not null check (event_type in ('obtained','renewed','superseded','revoked')),
  effective_on date not null,
  valid_until date,
  certificate_ref text,
  notes text not null default '',
  source_ref text not null,
  evidence_ref text not null,
  recorded_by text not null,
  recorded_role text not null,
  created_at timestamptz not null default now(),
  check (valid_until is null or valid_until >= effective_on)
);
create index if not exists vyndi_people_qualification_person_idx
  on vyndi_people_qualification_ledger(person_id,qualification_code,effective_on desc,created_at desc);

create table if not exists vyndi_people_asset_custody_ledger (
  id text primary key,
  person_id text not null references vyndi_people_records(id) on delete restrict,
  asset_id text not null references vyndi_people_office_assets(id) on delete restrict,
  event_type text not null check (event_type in ('issue','transfer_in','transfer_out','return')),
  occurred_at timestamptz not null default now(),
  notes text not null default '',
  source_ref text not null,
  evidence_ref text not null,
  recorded_by text not null,
  recorded_role text not null,
  created_at timestamptz not null default now()
);
create index if not exists vyndi_people_asset_custody_person_idx
  on vyndi_people_asset_custody_ledger(person_id,asset_id,occurred_at desc,created_at desc);

create table if not exists vyndi_people_access_ledger (
  id text primary key,
  person_id text not null references vyndi_people_records(id) on delete restrict,
  access_ref text not null,
  event_type text not null check (event_type in ('grant','change','suspend','revoke')),
  role_scope text not null default '',
  occurred_at timestamptz not null default now(),
  notes text not null default '',
  source_ref text not null,
  evidence_ref text not null,
  recorded_by text not null,
  recorded_role text not null,
  created_at timestamptz not null default now()
);
create index if not exists vyndi_people_access_person_idx
  on vyndi_people_access_ledger(person_id,access_ref,occurred_at desc,created_at desc);

create table if not exists vyndi_people_payroll_readiness_ledger (
  id text primary key,
  person_id text not null references vyndi_people_records(id) on delete restrict,
  period_key text not null,
  readiness_status text not null check (readiness_status in ('pending','ready','hold','settled')),
  basis_json jsonb not null default '{}'::jsonb,
  source_ref text not null,
  evidence_ref text not null,
  recorded_by text not null,
  recorded_role text not null,
  created_at timestamptz not null default now()
);
create index if not exists vyndi_people_payroll_readiness_person_idx
  on vyndi_people_payroll_readiness_ledger(person_id,period_key,created_at desc);

create table if not exists vyndi_people_exit_cases (
  id text primary key,
  person_id text not null references vyndi_people_records(id) on delete restrict,
  effective_on date not null,
  status text not null default 'open' check (status in ('open','closed','cancelled')),
  opened_person_revision integer not null check (opened_person_revision > 0),
  source_ref text not null,
  evidence_ref text not null,
  opened_by text not null,
  opened_role text not null,
  finalized_by text,
  finalized_role text,
  finalized_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists vyndi_people_exit_open_person_uq
  on vyndi_people_exit_cases(person_id)
  where status='open';

create table if not exists vyndi_people_exit_clearance_ledger (
  id text primary key,
  exit_case_id text not null references vyndi_people_exit_cases(id) on delete restrict,
  person_id text not null references vyndi_people_records(id) on delete restrict,
  clearance_type text not null check (clearance_type in (
    'handover','leave_reconciliation','payroll_settlement','asset_return','access_revocation','department_clearance'
  )),
  clearance_status text not null check (clearance_status in ('pending','cleared','waived','blocked')),
  revision integer not null check (revision > 0),
  notes text not null default '',
  source_ref text not null,
  evidence_ref text not null,
  recorded_by text not null,
  recorded_role text not null,
  created_at timestamptz not null default now(),
  unique(exit_case_id,clearance_type,revision)
);
create index if not exists vyndi_people_exit_clearance_case_idx
  on vyndi_people_exit_clearance_ledger(exit_case_id,clearance_type,revision desc);

create or replace view vyndi_people_attendance_current as
select distinct on (person_id,work_date)
  id,person_id,work_date,revision,attendance_status,worked_hours,overtime_hours,notes,
  source_ref,evidence_ref,recorded_by,recorded_role,created_at
from vyndi_people_attendance_ledger
order by person_id,work_date,revision desc,created_at desc,id desc;

create or replace view vyndi_people_leave_balance as
select
  person_id,
  leave_type,
  coalesce(sum(case when direction='credit' then quantity_days else -quantity_days end),0)::numeric(12,3) as balance_days,
  max(effective_on) as last_effective_on
from vyndi_people_leave_ledger
group by person_id,leave_type;

create or replace view vyndi_people_qualification_current as
select distinct on (person_id,qualification_code)
  id,person_id,qualification_code,qualification_title,event_type,effective_on,valid_until,
  certificate_ref,notes,source_ref,evidence_ref,recorded_by,recorded_role,created_at,
  case
    when event_type in ('revoked','superseded') then false
    when valid_until is null then true
    else valid_until>=current_date
  end as currently_valid
from vyndi_people_qualification_ledger
order by person_id,qualification_code,effective_on desc,created_at desc,id desc;

create or replace view vyndi_people_asset_custody_current as
select distinct on (asset_id)
  id,person_id,asset_id,event_type,occurred_at,notes,source_ref,evidence_ref,recorded_by,recorded_role,created_at,
  (event_type in ('issue','transfer_in')) as in_custody
from vyndi_people_asset_custody_ledger
order by asset_id,occurred_at desc,created_at desc,id desc;

create or replace view vyndi_people_access_current as
select distinct on (person_id,access_ref)
  id,person_id,access_ref,event_type,role_scope,occurred_at,notes,source_ref,evidence_ref,recorded_by,recorded_role,created_at,
  (event_type in ('grant','change','suspend')) as requires_exit_revocation
from vyndi_people_access_ledger
order by person_id,access_ref,occurred_at desc,created_at desc,id desc;

create or replace view vyndi_people_payroll_readiness_current as
select distinct on (person_id,period_key)
  id,person_id,period_key,readiness_status,basis_json,source_ref,evidence_ref,recorded_by,recorded_role,created_at
from vyndi_people_payroll_readiness_ledger
order by person_id,period_key,created_at desc,id desc;

create or replace view vyndi_people_exit_clearance_current as
select distinct on (exit_case_id,clearance_type)
  id,exit_case_id,person_id,clearance_type,clearance_status,revision,notes,
  source_ref,evidence_ref,recorded_by,recorded_role,created_at
from vyndi_people_exit_clearance_ledger
order by exit_case_id,clearance_type,revision desc,created_at desc,id desc;

create or replace view vyndi_people_exit_readiness as
select
  c.id as exit_case_id,
  c.person_id,
  c.status as exit_status,
  coalesce(cust.open_asset_custody_count,0)::int as open_asset_custody_count,
  coalesce(acc.active_access_count,0)::int as active_access_count,
  (coalesce(pay.payroll_settled,false) or coalesce(clr.payroll_clearance_ready,false)) as payroll_settled,
  coalesce(clr.handover_ready,false) as handover_ready,
  coalesce(clr.leave_reconciled,false) as leave_reconciled,
  coalesce(clr.department_clearance_ready,false) as department_clearance_ready,
  (
    coalesce(cust.open_asset_custody_count,0)=0
    and coalesce(acc.active_access_count,0)=0
    and (coalesce(pay.payroll_settled,false) or coalesce(clr.payroll_clearance_ready,false))
    and coalesce(clr.handover_ready,false)
    and coalesce(clr.leave_reconciled,false)
    and coalesce(clr.department_clearance_ready,false)
  ) as can_finalize
from vyndi_people_exit_cases c
left join lateral (
  select count(*)::int as open_asset_custody_count
  from vyndi_people_asset_custody_current ac
  where ac.person_id=c.person_id and ac.in_custody
) cust on true
left join lateral (
  select count(*)::int as active_access_count
  from vyndi_people_access_current aa
  where aa.person_id=c.person_id and aa.requires_exit_revocation
) acc on true
left join lateral (
  select coalesce((
    select pr.readiness_status='settled'
    from vyndi_people_payroll_readiness_current pr
    where pr.person_id=c.person_id
    order by pr.created_at desc,pr.period_key desc,pr.id desc
    limit 1
  ),false) as payroll_settled
) pay on true
left join lateral (
  select
    coalesce(bool_or(clearance_type='handover' and clearance_status in ('cleared','waived')),false) as handover_ready,
    coalesce(bool_or(clearance_type='leave_reconciliation' and clearance_status in ('cleared','waived')),false) as leave_reconciled,
    coalesce(bool_or(clearance_type='payroll_settlement' and clearance_status in ('cleared','waived')),false) as payroll_clearance_ready,
    coalesce(bool_or(clearance_type='department_clearance' and clearance_status in ('cleared','waived')),false) as department_clearance_ready
  from vyndi_people_exit_clearance_current ec
  where ec.exit_case_id=c.id
) clr on true;

create or replace view vyndi_people_office_operational_summary as
select
  (select count(*)::int from vyndi_people_records where operational_status='active') as active_people_count,
  (select count(*)::int from vyndi_people_records where operational_status='exiting') as exiting_people_count,
  (select count(*)::int from vyndi_people_attendance_current where work_date=current_date and attendance_status in ('present','remote','travel')) as present_today_count,
  (select count(*)::int from vyndi_people_asset_custody_current where in_custody) as open_asset_custody_count,
  (select count(*)::int from vyndi_people_access_current where requires_exit_revocation) as active_access_count,
  (select count(*)::int from vyndi_people_qualification_current where not currently_valid) as invalid_qualification_count,
  (select count(*)::int from vyndi_people_exit_readiness where exit_status='open' and not can_finalize) as blocked_exit_count;

create or replace function record_vyndi_people_employment_event(
  p_id text,
  p_person_id text,
  p_event_type text,
  p_effective_on date,
  p_details_json jsonb,
  p_operational_status text,
  p_expected_revision integer,
  p_source_ref text,
  p_evidence_ref text,
  p_actor text,
  p_role text
) returns table (new_revision integer, resulting_operational_status text)
language plpgsql
as $$
declare
  v_person record;
  v_next_revision integer;
  v_status text;
begin
  select pr.id,pr.record_revision,pr.operational_status
    into v_person
    from vyndi_people_records pr
   where pr.id=p_person_id
   for update;
  if not found then raise exception 'People record not found.'; end if;
  if v_person.record_revision<>p_expected_revision then
    raise exception 'Stale People record revision: expected %, current %.',p_expected_revision,v_person.record_revision;
  end if;
  if p_event_type not in ('joined','role_change','transfer','promotion','compensation_change','status_change','exit_initiated','separated') then
    raise exception 'Invalid employment event type.';
  end if;
  v_status:=coalesce(p_operational_status,v_person.operational_status);
  if v_status not in ('planned','active','on_leave','exiting','inactive') then
    raise exception 'Invalid People operational status.';
  end if;

  v_next_revision:=v_person.record_revision+1;
  update vyndi_people_records
     set operational_status=v_status,record_revision=v_next_revision,updated_at=now()
   where id=p_person_id;

  insert into vyndi_people_employment_ledger(
    id,person_id,event_type,effective_on,details_json,person_revision,source_ref,evidence_ref,recorded_by,recorded_role
  ) values (
    p_id,p_person_id,p_event_type,p_effective_on,coalesce(p_details_json,'{}'::jsonb),v_next_revision,
    p_source_ref,p_evidence_ref,p_actor,p_role
  );

  return query select v_next_revision,v_status;
end;
$$;

create or replace function record_vyndi_people_attendance(
  p_id text,p_person_id text,p_work_date date,p_attendance_status text,p_worked_hours numeric,p_overtime_hours numeric,
  p_notes text,p_source_ref text,p_evidence_ref text,p_actor text,p_role text
) returns table (attendance_revision integer)
language plpgsql
as $$
declare v_revision integer;
begin
  if not exists(select 1 from vyndi_people_records where id=p_person_id) then raise exception 'People record not found.'; end if;
  perform pg_advisory_xact_lock(hashtext(p_person_id || '|' || p_work_date::text)::bigint);
  select coalesce(max(revision),0)+1 into v_revision
    from vyndi_people_attendance_ledger where person_id=p_person_id and work_date=p_work_date;
  insert into vyndi_people_attendance_ledger(
    id,person_id,work_date,revision,attendance_status,worked_hours,overtime_hours,notes,source_ref,evidence_ref,recorded_by,recorded_role
  ) values (
    p_id,p_person_id,p_work_date,v_revision,p_attendance_status,coalesce(p_worked_hours,0),coalesce(p_overtime_hours,0),
    coalesce(p_notes,''),p_source_ref,p_evidence_ref,p_actor,p_role
  );
  return query select v_revision;
end;
$$;

create or replace function post_vyndi_people_leave_transaction(
  p_id text,p_person_id text,p_leave_type text,p_transaction_type text,p_direction text,p_quantity_days numeric,
  p_effective_on date,p_related_reference text,p_notes text,p_source_ref text,p_evidence_ref text,p_actor text,p_role text
) returns table (balance_days numeric)
language plpgsql
as $$
declare v_balance numeric;
begin
  if not exists(select 1 from vyndi_people_records where id=p_person_id) then raise exception 'People record not found.'; end if;
  perform pg_advisory_xact_lock(hashtext(p_person_id || '|' || lower(trim(p_leave_type)))::bigint);
  select coalesce(sum(case when direction='credit' then quantity_days else -quantity_days end),0)
    into v_balance from vyndi_people_leave_ledger where person_id=p_person_id and leave_type=p_leave_type;
  if p_direction='debit' and v_balance<p_quantity_days then
    raise exception 'Insufficient leave balance for %: available %, requested %.',p_leave_type,v_balance,p_quantity_days;
  end if;
  insert into vyndi_people_leave_ledger(
    id,person_id,leave_type,transaction_type,direction,quantity_days,effective_on,related_reference,notes,
    source_ref,evidence_ref,recorded_by,recorded_role
  ) values (
    p_id,p_person_id,p_leave_type,p_transaction_type,p_direction,p_quantity_days,p_effective_on,p_related_reference,
    coalesce(p_notes,''),p_source_ref,p_evidence_ref,p_actor,p_role
  );
  select coalesce(sum(case when direction='credit' then quantity_days else -quantity_days end),0)
    into v_balance from vyndi_people_leave_ledger where person_id=p_person_id and leave_type=p_leave_type;
  return query select v_balance;
end;
$$;

create or replace function record_vyndi_people_qualification(
  p_id text,p_person_id text,p_qualification_code text,p_qualification_title text,p_event_type text,
  p_effective_on date,p_valid_until date,p_certificate_ref text,p_notes text,p_source_ref text,p_evidence_ref text,
  p_actor text,p_role text
) returns text
language plpgsql
as $$
begin
  if not exists(select 1 from vyndi_people_records where id=p_person_id) then raise exception 'People record not found.'; end if;
  insert into vyndi_people_qualification_ledger(
    id,person_id,qualification_code,qualification_title,event_type,effective_on,valid_until,certificate_ref,
    notes,source_ref,evidence_ref,recorded_by,recorded_role
  ) values (
    p_id,p_person_id,p_qualification_code,p_qualification_title,p_event_type,p_effective_on,p_valid_until,p_certificate_ref,
    coalesce(p_notes,''),p_source_ref,p_evidence_ref,p_actor,p_role
  );
  return p_id;
end;
$$;

create or replace function record_vyndi_people_asset_custody(
  p_id text,p_person_id text,p_asset_id text,p_event_type text,p_occurred_at timestamptz,p_notes text,
  p_source_ref text,p_evidence_ref text,p_actor text,p_role text
) returns text
language plpgsql
as $$
begin
  if not exists(select 1 from vyndi_people_records where id=p_person_id) then raise exception 'People record not found.'; end if;
  insert into vyndi_people_asset_custody_ledger(
    id,person_id,asset_id,event_type,occurred_at,notes,source_ref,evidence_ref,recorded_by,recorded_role
  ) values (
    p_id,p_person_id,p_asset_id,p_event_type,coalesce(p_occurred_at,now()),coalesce(p_notes,''),
    p_source_ref,p_evidence_ref,p_actor,p_role
  );
  return p_id;
end;
$$;

create or replace function record_vyndi_people_access_event(
  p_id text,p_person_id text,p_access_ref text,p_event_type text,p_role_scope text,p_occurred_at timestamptz,p_notes text,
  p_source_ref text,p_evidence_ref text,p_actor text,p_role text
) returns text
language plpgsql
as $$
begin
  if not exists(select 1 from vyndi_people_records where id=p_person_id) then raise exception 'People record not found.'; end if;
  insert into vyndi_people_access_ledger(
    id,person_id,access_ref,event_type,role_scope,occurred_at,notes,source_ref,evidence_ref,recorded_by,recorded_role
  ) values (
    p_id,p_person_id,p_access_ref,p_event_type,coalesce(p_role_scope,''),coalesce(p_occurred_at,now()),coalesce(p_notes,''),
    p_source_ref,p_evidence_ref,p_actor,p_role
  );
  return p_id;
end;
$$;

create or replace function record_vyndi_people_payroll_readiness(
  p_id text,p_person_id text,p_period_key text,p_readiness_status text,p_basis_json jsonb,
  p_source_ref text,p_evidence_ref text,p_actor text,p_role text
) returns text
language plpgsql
as $$
begin
  if not exists(select 1 from vyndi_people_records where id=p_person_id) then raise exception 'People record not found.'; end if;
  if p_readiness_status in ('ready','settled')
     and (
       coalesce((p_basis_json->>'attendanceReconciled')::boolean,false)=false
       or coalesce((p_basis_json->>'leaveReconciled')::boolean,false)=false
     ) then
    raise exception 'Payroll readiness requires attendance and leave reconciliation evidence.';
  end if;
  insert into vyndi_people_payroll_readiness_ledger(
    id,person_id,period_key,readiness_status,basis_json,source_ref,evidence_ref,recorded_by,recorded_role
  ) values (
    p_id,p_person_id,p_period_key,p_readiness_status,coalesce(p_basis_json,'{}'::jsonb),
    p_source_ref,p_evidence_ref,p_actor,p_role
  );
  return p_id;
end;
$$;

create or replace function initiate_vyndi_people_exit(
  p_case_id text,p_person_id text,p_effective_on date,p_expected_revision integer,
  p_source_ref text,p_evidence_ref text,p_actor text,p_role text
) returns table (new_revision integer)
language plpgsql
as $$
declare v_person record; v_next integer;
begin
  select id,record_revision,operational_status into v_person
    from vyndi_people_records where id=p_person_id for update;
  if not found then raise exception 'People record not found.'; end if;
  if v_person.record_revision<>p_expected_revision then
    raise exception 'Stale People record revision: expected %, current %.',p_expected_revision,v_person.record_revision;
  end if;
  if v_person.operational_status='inactive' then raise exception 'Inactive People record cannot enter exit workflow.'; end if;
  if exists(select 1 from vyndi_people_exit_cases where person_id=p_person_id and status='open') then
    raise exception 'An open exit case already exists for this person.';
  end if;

  v_next:=v_person.record_revision+1;
  insert into vyndi_people_exit_cases(
    id,person_id,effective_on,status,opened_person_revision,source_ref,evidence_ref,opened_by,opened_role
  ) values (
    p_case_id,p_person_id,p_effective_on,'open',v_next,p_source_ref,p_evidence_ref,p_actor,p_role
  );
  update vyndi_people_records set operational_status='exiting',record_revision=v_next,updated_at=now()
   where id=p_person_id;
  insert into vyndi_people_employment_ledger(
    id,person_id,event_type,effective_on,details_json,person_revision,source_ref,evidence_ref,recorded_by,recorded_role
  ) values (
    p_case_id || '-EMP',p_person_id,'exit_initiated',p_effective_on,
    jsonb_build_object('exitCaseId',p_case_id),v_next,p_source_ref,p_evidence_ref,p_actor,p_role
  );
  return query select v_next;
end;
$$;

create or replace function record_vyndi_people_exit_clearance(
  p_id text,p_exit_case_id text,p_clearance_type text,p_clearance_status text,p_notes text,
  p_source_ref text,p_evidence_ref text,p_actor text,p_role text
) returns table (clearance_revision integer)
language plpgsql
as $$
declare v_case record; v_revision integer;
begin
  select id,person_id,status into v_case from vyndi_people_exit_cases where id=p_exit_case_id for update;
  if not found then raise exception 'People exit case not found.'; end if;
  if v_case.status<>'open' then raise exception 'Only open exit cases may receive clearance evidence.'; end if;
  select coalesce(max(revision),0)+1 into v_revision
    from vyndi_people_exit_clearance_ledger where exit_case_id=p_exit_case_id and clearance_type=p_clearance_type;
  insert into vyndi_people_exit_clearance_ledger(
    id,exit_case_id,person_id,clearance_type,clearance_status,revision,notes,source_ref,evidence_ref,recorded_by,recorded_role
  ) values (
    p_id,p_exit_case_id,v_case.person_id,p_clearance_type,p_clearance_status,v_revision,coalesce(p_notes,''),
    p_source_ref,p_evidence_ref,p_actor,p_role
  );
  return query select v_revision;
end;
$$;

create or replace function finalize_vyndi_people_exit(
  p_exit_case_id text,p_expected_revision integer,p_source_ref text,p_evidence_ref text,p_actor text,p_role text
) returns table (new_revision integer, person_status text)
language plpgsql
as $$
declare
  v_case record;
  v_person record;
  v_ready record;
  v_next integer;
begin
  select * into v_case from vyndi_people_exit_cases where id=p_exit_case_id for update;
  if not found then raise exception 'People exit case not found.'; end if;
  if v_case.status<>'open' then raise exception 'Only open exit cases can be finalized.'; end if;

  select id,record_revision,engagement_type into v_person
    from vyndi_people_records where id=v_case.person_id for update;
  if not found then raise exception 'People record not found.'; end if;
  if v_person.record_revision<>p_expected_revision then
    raise exception 'Stale People record revision: expected %, current %.',p_expected_revision,v_person.record_revision;
  end if;

  select * into v_ready from vyndi_people_exit_readiness where exit_case_id=p_exit_case_id;
  if coalesce(v_ready.open_asset_custody_count,0)>0 then
    raise exception 'People exit is blocked by open asset custody.';
  end if;
  if coalesce(v_ready.active_access_count,0)>0 then
    raise exception 'People exit is blocked by active access; revoke access before finalization.';
  end if;
  if not coalesce(v_ready.payroll_settled,false) then
    raise exception 'People exit is blocked because payroll settlement is not ready.';
  end if;
  if not coalesce(v_ready.leave_reconciled,false) then
    raise exception 'People exit is blocked until leave_reconciliation is cleared.';
  end if;
  if not coalesce(v_ready.handover_ready,false) then
    raise exception 'People exit is blocked until handover is cleared.';
  end if;
  if not coalesce(v_ready.department_clearance_ready,false) then
    raise exception 'People exit is blocked until department_clearance is cleared.';
  end if;

  v_next:=v_person.record_revision+1;
  update vyndi_people_exit_cases
     set status='closed',finalized_by=p_actor,finalized_role=p_role,finalized_at=now(),updated_at=now()
   where id=p_exit_case_id;
  update vyndi_people_records
     set lifecycle_status='inactive',operational_status='inactive',record_revision=v_next,updated_at=now()
   where id=v_case.person_id;
  insert into vyndi_people_employment_ledger(
    id,person_id,event_type,effective_on,details_json,person_revision,source_ref,evidence_ref,recorded_by,recorded_role
  ) values (
    p_exit_case_id || '-SEP',v_case.person_id,'separated',v_case.effective_on,
    jsonb_build_object('exitCaseId',p_exit_case_id),v_next,p_source_ref,p_evidence_ref,p_actor,p_role
  );

  return query select v_next,'inactive'::text;
end;
$$;

comment on table vyndi_people_employment_ledger is 'Append-only employment lifecycle events linked to the canonical People record.';
comment on table vyndi_people_attendance_ledger is 'Append-only attendance revisions. Current day state is derived from the highest revision.';
comment on table vyndi_people_leave_ledger is 'Append-only leave credits/debits. Balance is derived, never overwritten.';
comment on table vyndi_people_qualification_ledger is 'Append-only training and qualification evidence with validity/renewal/revocation history.';
comment on table vyndi_people_asset_custody_ledger is 'Append-only asset issue/transfer/return evidence used by exit clearance.';
comment on table vyndi_people_access_ledger is 'Append-only access/IAM events used by exit clearance.';
comment on table vyndi_people_payroll_readiness_ledger is 'Append-only payroll readiness/settlement evidence by period.';
comment on function finalize_vyndi_people_exit(text,integer,text,text,text,text) is
  'Fail-closed exit finalization. Asset custody, access, payroll, leave reconciliation, handover and department clearance must all be closed.';
