-- Governed Funding lifecycle authority.
-- Cash receipts remain authoritative in vyndi_cash_funding_receipts.
-- These ledgers add debt obligation and grant utilisation truth without double-counting cash.

create table if not exists vyndi_funding_loans (
  id text primary key,
  lender_name text not null,
  facility_reference text not null unique,
  principal_limit_lakh numeric(18,4) not null check (principal_limit_lakh > 0),
  annual_interest_rate_pct numeric(9,4) not null default 0 check (annual_interest_rate_pct >= 0 and annual_interest_rate_pct <= 100),
  start_on date not null,
  maturity_on date,
  status text not null default 'proposed' check (status in ('proposed','active','closed','defaulted')),
  source_reference text not null,
  evidence_reference text not null,
  created_by text not null,
  created_role text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (maturity_on is null or maturity_on >= start_on)
);

create table if not exists vyndi_funding_loan_ledger (
  id text primary key,
  loan_id text not null references vyndi_funding_loans(id) on delete restrict,
  event_type text not null check (event_type in ('drawdown','interest_accrual','principal_repayment','interest_repayment','fee','adjustment')),
  effective_on date not null,
  plan_month integer check (plan_month between 1 and 36),
  principal_delta_lakh numeric(18,4) not null default 0,
  interest_delta_lakh numeric(18,4) not null default 0,
  cash_delta_lakh numeric(18,4) not null default 0,
  funding_receipt_id text references vyndi_cash_funding_receipts(id) on delete restrict,
  monthly_actual_revision integer,
  evidence_reference text not null,
  notes text not null default '',
  recorded_by text not null,
  recorded_role text not null,
  created_at timestamptz not null default now()
);
create unique index if not exists vyndi_funding_loan_drawdown_receipt_uq
  on vyndi_funding_loan_ledger(funding_receipt_id)
  where funding_receipt_id is not null;
create index if not exists vyndi_funding_loan_ledger_idx
  on vyndi_funding_loan_ledger(loan_id,effective_on,created_at,id);

create table if not exists vyndi_funding_grants (
  id text primary key,
  grant_name text not null,
  provider_name text not null,
  award_reference text not null unique,
  awarded_lakh numeric(18,4) not null check (awarded_lakh > 0),
  award_on date not null,
  valid_from date,
  valid_until date,
  status text not null default 'awarded' check (status in ('awarded','active','closed','breached')),
  source_reference text not null,
  evidence_reference text not null,
  created_by text not null,
  created_role text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (valid_until is null or valid_from is null or valid_until >= valid_from)
);

create table if not exists vyndi_funding_grant_receipts (
  id text primary key,
  grant_id text not null references vyndi_funding_grants(id) on delete restrict,
  funding_receipt_id text not null unique references vyndi_cash_funding_receipts(id) on delete restrict,
  amount_lakh numeric(18,4) not null check (amount_lakh > 0),
  received_on date not null,
  evidence_reference text not null,
  recorded_by text not null,
  recorded_role text not null,
  created_at timestamptz not null default now()
);
create index if not exists vyndi_funding_grant_receipt_idx
  on vyndi_funding_grant_receipts(grant_id,received_on,id);

create table if not exists vyndi_funding_grant_utilisation (
  id text primary key,
  grant_id text not null references vyndi_funding_grants(id) on delete restrict,
  plan_month integer not null check (plan_month between 1 and 36),
  spent_on date not null,
  amount_lakh numeric(18,4) not null check (amount_lakh > 0),
  utilisation_category text not null,
  expense_reference text,
  evidence_reference text not null,
  notes text not null default '',
  recorded_by text not null,
  recorded_role text not null,
  created_at timestamptz not null default now()
);
create index if not exists vyndi_funding_grant_utilisation_idx
  on vyndi_funding_grant_utilisation(grant_id,spent_on,id);

create table if not exists vyndi_funding_grant_conditions (
  id text primary key,
  grant_id text not null references vyndi_funding_grants(id) on delete restrict,
  condition_code text not null,
  condition_title text not null,
  condition_status text not null check (condition_status in ('pending','met','waived','breached')),
  due_on date,
  revision integer not null check (revision > 0),
  evidence_reference text not null,
  notes text not null default '',
  recorded_by text not null,
  recorded_role text not null,
  created_at timestamptz not null default now(),
  unique(grant_id,condition_code,revision)
);
create index if not exists vyndi_funding_grant_condition_idx
  on vyndi_funding_grant_conditions(grant_id,condition_code,revision desc);

create or replace function deny_vyndi_funding_ledger_mutation() returns trigger
language plpgsql as $$
begin
  raise exception 'Funding lifecycle ledgers are append-only.';
end;
$$;

drop trigger if exists trg_vyndi_funding_loan_ledger_append_only on vyndi_funding_loan_ledger;
create trigger trg_vyndi_funding_loan_ledger_append_only
before update or delete on vyndi_funding_loan_ledger
for each row execute function deny_vyndi_funding_ledger_mutation();

drop trigger if exists trg_vyndi_funding_grant_receipts_append_only on vyndi_funding_grant_receipts;
create trigger trg_vyndi_funding_grant_receipts_append_only
before update or delete on vyndi_funding_grant_receipts
for each row execute function deny_vyndi_funding_ledger_mutation();

drop trigger if exists trg_vyndi_funding_grant_utilisation_append_only on vyndi_funding_grant_utilisation;
create trigger trg_vyndi_funding_grant_utilisation_append_only
before update or delete on vyndi_funding_grant_utilisation
for each row execute function deny_vyndi_funding_ledger_mutation();

drop trigger if exists trg_vyndi_funding_grant_conditions_append_only on vyndi_funding_grant_conditions;
create trigger trg_vyndi_funding_grant_conditions_append_only
before update or delete on vyndi_funding_grant_conditions
for each row execute function deny_vyndi_funding_ledger_mutation();

create or replace view vyndi_funding_loan_balance as
select
  l.id as loan_id,
  l.lender_name,
  l.facility_reference,
  l.principal_limit_lakh,
  l.annual_interest_rate_pct,
  l.start_on,
  l.maturity_on,
  l.status,
  coalesce(sum(e.principal_delta_lakh),0)::numeric(18,4) as principal_outstanding_lakh,
  coalesce(sum(e.interest_delta_lakh),0)::numeric(18,4) as accrued_interest_lakh,
  (coalesce(sum(e.principal_delta_lakh),0)+coalesce(sum(e.interest_delta_lakh),0))::numeric(18,4) as total_outstanding_lakh,
  coalesce(sum(e.cash_delta_lakh),0)::numeric(18,4) as lifecycle_cash_delta_lakh,
  count(e.id)::int as ledger_event_count
from vyndi_funding_loans l
left join vyndi_funding_loan_ledger e on e.loan_id=l.id
group by l.id,l.lender_name,l.facility_reference,l.principal_limit_lakh,l.annual_interest_rate_pct,l.start_on,l.maturity_on,l.status;

create or replace view vyndi_funding_grant_condition_current as
select distinct on (grant_id,condition_code)
  id,grant_id,condition_code,condition_title,condition_status,due_on,revision,evidence_reference,notes,
  recorded_by,recorded_role,created_at
from vyndi_funding_grant_conditions
order by grant_id,condition_code,revision desc,created_at desc,id desc;

create or replace view vyndi_funding_grant_balance as
select
  g.id as grant_id,
  g.grant_name,
  g.provider_name,
  g.award_reference,
  g.awarded_lakh,
  g.status,
  coalesce(r.received_lakh,0)::numeric(18,4) as received_lakh,
  coalesce(u.utilised_lakh,0)::numeric(18,4) as utilised_lakh,
  greatest(coalesce(r.received_lakh,0)-coalesce(u.utilised_lakh,0),0)::numeric(18,4) as available_to_utilise_lakh,
  greatest(g.awarded_lakh-coalesce(r.received_lakh,0),0)::numeric(18,4) as award_not_received_lakh,
  coalesce(c.open_condition_count,0)::int as open_condition_count,
  coalesce(c.breached_condition_count,0)::int as breached_condition_count
from vyndi_funding_grants g
left join lateral (
  select sum(amount_lakh) as received_lakh from vyndi_funding_grant_receipts where grant_id=g.id
) r on true
left join lateral (
  select sum(amount_lakh) as utilised_lakh from vyndi_funding_grant_utilisation where grant_id=g.id
) u on true
left join lateral (
  select
    count(*) filter (where condition_status='pending')::int as open_condition_count,
    count(*) filter (where condition_status='breached')::int as breached_condition_count
  from vyndi_funding_grant_condition_current where grant_id=g.id
) c on true;

create or replace function create_vyndi_funding_loan(
  p_id text,p_lender_name text,p_facility_reference text,p_principal_limit_lakh numeric,
  p_annual_interest_rate_pct numeric,p_start_on date,p_maturity_on date,
  p_source_reference text,p_evidence_reference text,p_actor_user_id text,p_actor_role text
) returns text
language plpgsql as $$
begin
  if p_actor_role not in ('admin','management','finance') then raise exception 'Funding loan creation requires Finance authority.'; end if;
  insert into vyndi_funding_loans(
    id,lender_name,facility_reference,principal_limit_lakh,annual_interest_rate_pct,start_on,maturity_on,
    status,source_reference,evidence_reference,created_by,created_role
  ) values (
    p_id,trim(p_lender_name),trim(p_facility_reference),p_principal_limit_lakh,p_annual_interest_rate_pct,
    p_start_on,p_maturity_on,'proposed',trim(p_source_reference),trim(p_evidence_reference),p_actor_user_id,p_actor_role
  );
  insert into vyndi_audit_events(id,entity_type,entity_id,action,actor_user_id,actor_role,source_reference,payload_json)
  values('AUD-'||p_id||'-CREATE','funding_loan',p_id,'FUNDING_LOAN_CREATED',p_actor_user_id,p_actor_role,p_evidence_reference,
    jsonb_build_object('lender',p_lender_name,'limitLakh',p_principal_limit_lakh,'interestRatePct',p_annual_interest_rate_pct));
  return p_id;
end;
$$;

create or replace function register_vyndi_loan_drawdown(
  p_id text,p_loan_id text,p_funding_receipt_id text,p_notes text,p_evidence_reference text,
  p_actor_user_id text,p_actor_role text
) returns table(principal_outstanding_lakh numeric,accrued_interest_lakh numeric,total_outstanding_lakh numeric)
language plpgsql as $$
declare v_loan record; v_receipt record; v_balance record;
begin
  if p_actor_role not in ('admin','management','finance') then raise exception 'Loan drawdown registration requires Finance authority.'; end if;
  select * into v_loan from vyndi_funding_loans where id=p_loan_id for update;
  if not found then raise exception 'Funding loan not found.'; end if;
  select * into v_receipt from vyndi_cash_funding_receipts
   where id=p_funding_receipt_id and funding_source='loan' and verified=true;
  if not found then raise exception 'Loan drawdown requires an existing verified cash funding receipt with funding_source=''loan''.'; end if;
  if exists(select 1 from vyndi_funding_loan_ledger where funding_receipt_id=p_funding_receipt_id) then
    raise exception 'This loan cash receipt is already linked to a drawdown.';
  end if;
  select coalesce(sum(principal_delta_lakh),0) as principal into v_balance
    from vyndi_funding_loan_ledger where loan_id=p_loan_id;
  if coalesce(v_balance.principal,0)+v_receipt.amount_lakh>v_loan.principal_limit_lakh then
    raise exception 'Loan drawdown exceeds the controlled facility principal limit.';
  end if;

  insert into vyndi_funding_loan_ledger(
    id,loan_id,event_type,effective_on,plan_month,principal_delta_lakh,interest_delta_lakh,cash_delta_lakh,
    funding_receipt_id,evidence_reference,notes,recorded_by,recorded_role
  ) values (
    p_id,p_loan_id,'drawdown',v_receipt.received_on,v_receipt.plan_month,v_receipt.amount_lakh,0,0,
    p_funding_receipt_id,p_evidence_reference,coalesce(p_notes,''),p_actor_user_id,p_actor_role
  );
  update vyndi_funding_loans set status='active',updated_at=now() where id=p_loan_id and status='proposed';

  return query
    select b.principal_outstanding_lakh,b.accrued_interest_lakh,b.total_outstanding_lakh
    from vyndi_funding_loan_balance b where b.loan_id=p_loan_id;
end;
$$;

create or replace function accrue_vyndi_loan_interest(
  p_id text,p_loan_id text,p_effective_on date,p_interest_lakh numeric,p_evidence_reference text,
  p_notes text,p_actor_user_id text,p_actor_role text
) returns table(principal_outstanding_lakh numeric,accrued_interest_lakh numeric,total_outstanding_lakh numeric)
language plpgsql as $$
begin
  if p_actor_role not in ('admin','management','finance') then raise exception 'Loan interest accrual requires Finance authority.'; end if;
  if p_interest_lakh<=0 then raise exception 'Loan interest accrual must be positive.'; end if;
  if not exists(select 1 from vyndi_funding_loans where id=p_loan_id and status='active') then
    raise exception 'Interest may accrue only on an active loan.';
  end if;
  insert into vyndi_funding_loan_ledger(
    id,loan_id,event_type,effective_on,interest_delta_lakh,evidence_reference,notes,recorded_by,recorded_role
  ) values (
    p_id,p_loan_id,'interest_accrual',p_effective_on,p_interest_lakh,p_evidence_reference,coalesce(p_notes,''),p_actor_user_id,p_actor_role
  );
  return query
    select b.principal_outstanding_lakh,b.accrued_interest_lakh,b.total_outstanding_lakh
    from vyndi_funding_loan_balance b where b.loan_id=p_loan_id;
end;
$$;

create or replace function post_vyndi_loan_repayment(
  p_id text,p_loan_id text,p_plan_month integer,p_paid_on date,p_principal_lakh numeric,p_interest_lakh numeric,
  p_evidence_reference text,p_notes text,p_actor_user_id text,p_actor_role text
) returns table(principal_outstanding_lakh numeric,accrued_interest_lakh numeric,total_outstanding_lakh numeric,new_closing_cash_lakh numeric,actual_revision integer)
language plpgsql as $$
declare v_balance record; v_cash record; v_total numeric;
begin
  if p_actor_role not in ('admin','management','finance') then raise exception 'Loan repayment requires Finance authority.'; end if;
  if coalesce(p_principal_lakh,0)<0 or coalesce(p_interest_lakh,0)<0 or coalesce(p_principal_lakh,0)+coalesce(p_interest_lakh,0)<=0 then
    raise exception 'Loan repayment must contain a positive principal and/or interest amount.';
  end if;
  perform pg_advisory_xact_lock(hashtext('funding-loan|'||p_loan_id)::bigint);
  select * into v_balance from vyndi_funding_loan_balance where loan_id=p_loan_id;
  if not found then raise exception 'Funding loan not found.'; end if;
  if coalesce(p_principal_lakh,0)>v_balance.principal_outstanding_lakh then
    raise exception 'Principal repayment exceeds principal outstanding.';
  end if;
  if coalesce(p_interest_lakh,0)>v_balance.accrued_interest_lakh then
    raise exception 'Interest repayment exceeds accrued interest.';
  end if;

  v_total:=coalesce(p_principal_lakh,0)+coalesce(p_interest_lakh,0);
  select * into v_cash from apply_vyndi_verified_cash_movement(
    p_plan_month,-v_total,p_evidence_reference,p_actor_user_id,p_actor_role
  );

  if coalesce(p_principal_lakh,0)>0 then
    insert into vyndi_funding_loan_ledger(
      id,loan_id,event_type,effective_on,plan_month,principal_delta_lakh,cash_delta_lakh,
      monthly_actual_revision,evidence_reference,notes,recorded_by,recorded_role
    ) values (
      p_id||'-P',p_loan_id,'principal_repayment',p_paid_on,p_plan_month,-p_principal_lakh,-p_principal_lakh,
      v_cash.actual_revision,p_evidence_reference,coalesce(p_notes,''),p_actor_user_id,p_actor_role
    );
  end if;
  if coalesce(p_interest_lakh,0)>0 then
    insert into vyndi_funding_loan_ledger(
      id,loan_id,event_type,effective_on,plan_month,interest_delta_lakh,cash_delta_lakh,
      monthly_actual_revision,evidence_reference,notes,recorded_by,recorded_role
    ) values (
      p_id||'-I',p_loan_id,'interest_repayment',p_paid_on,p_plan_month,-p_interest_lakh,-p_interest_lakh,
      v_cash.actual_revision,p_evidence_reference,coalesce(p_notes,''),p_actor_user_id,p_actor_role
    );
  end if;

  select * into v_balance from vyndi_funding_loan_balance where loan_id=p_loan_id;
  if v_balance.total_outstanding_lakh=0 then
    update vyndi_funding_loans set status='closed',updated_at=now() where id=p_loan_id;
  end if;

  return query select
    v_balance.principal_outstanding_lakh,v_balance.accrued_interest_lakh,v_balance.total_outstanding_lakh,
    v_cash.new_closing_cash_lakh,v_cash.actual_revision;
end;
$$;

create or replace function create_vyndi_funding_grant(
  p_id text,p_grant_name text,p_provider_name text,p_award_reference text,p_awarded_lakh numeric,
  p_award_on date,p_valid_from date,p_valid_until date,p_source_reference text,p_evidence_reference text,
  p_actor_user_id text,p_actor_role text
) returns text
language plpgsql as $$
begin
  if p_actor_role not in ('admin','management','finance') then raise exception 'Funding grant creation requires Finance authority.'; end if;
  insert into vyndi_funding_grants(
    id,grant_name,provider_name,award_reference,awarded_lakh,award_on,valid_from,valid_until,status,
    source_reference,evidence_reference,created_by,created_role
  ) values (
    p_id,trim(p_grant_name),trim(p_provider_name),trim(p_award_reference),p_awarded_lakh,p_award_on,p_valid_from,p_valid_until,
    'awarded',trim(p_source_reference),trim(p_evidence_reference),p_actor_user_id,p_actor_role
  );
  return p_id;
end;
$$;

create or replace function register_vyndi_grant_receipt(
  p_id text,p_grant_id text,p_funding_receipt_id text,p_evidence_reference text,p_actor_user_id text,p_actor_role text
) returns table(received_lakh numeric,utilised_lakh numeric,available_to_utilise_lakh numeric,open_condition_count integer)
language plpgsql as $$
declare v_grant record; v_receipt record; v_received numeric; v_balance record;
begin
  if p_actor_role not in ('admin','management','finance') then raise exception 'Grant receipt registration requires Finance authority.'; end if;
  select * into v_grant from vyndi_funding_grants where id=p_grant_id for update;
  if not found then raise exception 'Funding grant not found.'; end if;
  select * into v_receipt from vyndi_cash_funding_receipts
   where id=p_funding_receipt_id and funding_source='grant' and verified=true;
  if not found then raise exception 'Grant receipt requires an existing verified cash funding receipt with funding_source=''grant''.'; end if;
  select coalesce(sum(amount_lakh),0) into v_received from vyndi_funding_grant_receipts where grant_id=p_grant_id;
  if v_received+v_receipt.amount_lakh>v_grant.awarded_lakh then
    raise exception 'Grant receipts cannot exceed the controlled award amount.';
  end if;
  insert into vyndi_funding_grant_receipts(
    id,grant_id,funding_receipt_id,amount_lakh,received_on,evidence_reference,recorded_by,recorded_role
  ) values (
    p_id,p_grant_id,p_funding_receipt_id,v_receipt.amount_lakh,v_receipt.received_on,p_evidence_reference,p_actor_user_id,p_actor_role
  );
  update vyndi_funding_grants set status='active',updated_at=now() where id=p_grant_id and status='awarded';
  return query
    select b.received_lakh,b.utilised_lakh,b.available_to_utilise_lakh,b.open_condition_count
    from vyndi_funding_grant_balance b where b.grant_id=p_grant_id;
end;
$$;

create or replace function post_vyndi_grant_utilisation(
  p_id text,p_grant_id text,p_plan_month integer,p_spent_on date,p_amount_lakh numeric,p_utilisation_category text,
  p_expense_reference text,p_evidence_reference text,p_notes text,p_actor_user_id text,p_actor_role text
) returns table(received_lakh numeric,utilised_lakh numeric,available_to_utilise_lakh numeric,open_condition_count integer)
language plpgsql as $$
declare v_balance record;
begin
  if p_actor_role not in ('admin','management','finance') then raise exception 'Grant utilisation requires Finance authority.'; end if;
  if p_amount_lakh<=0 then raise exception 'Grant utilisation amount must be positive.'; end if;
  perform pg_advisory_xact_lock(hashtext('funding-grant|'||p_grant_id)::bigint);
  select * into v_balance from vyndi_funding_grant_balance where grant_id=p_grant_id;
  if not found then raise exception 'Funding grant not found.'; end if;
  if v_balance.breached_condition_count>0 then raise exception 'Grant utilisation is blocked by a breached grant condition.'; end if;
  if p_amount_lakh>v_balance.available_to_utilise_lakh then
    raise exception 'Grant utilisation cannot exceed received grant funds available to utilise.';
  end if;
  insert into vyndi_funding_grant_utilisation(
    id,grant_id,plan_month,spent_on,amount_lakh,utilisation_category,expense_reference,evidence_reference,notes,recorded_by,recorded_role
  ) values (
    p_id,p_grant_id,p_plan_month,p_spent_on,p_amount_lakh,trim(p_utilisation_category),nullif(trim(coalesce(p_expense_reference,'')),''),
    p_evidence_reference,coalesce(p_notes,''),p_actor_user_id,p_actor_role
  );
  return query
    select b.received_lakh,b.utilised_lakh,b.available_to_utilise_lakh,b.open_condition_count
    from vyndi_funding_grant_balance b where b.grant_id=p_grant_id;
end;
$$;

create or replace function record_vyndi_grant_condition(
  p_id text,p_grant_id text,p_condition_code text,p_condition_title text,p_condition_status text,p_due_on date,
  p_evidence_reference text,p_notes text,p_actor_user_id text,p_actor_role text
) returns table(condition_revision integer,open_condition_count integer)
language plpgsql as $$
declare v_revision integer; v_open integer;
begin
  if p_actor_role not in ('admin','management','finance') then raise exception 'Grant condition recording requires Finance authority.'; end if;
  if not exists(select 1 from vyndi_funding_grants where id=p_grant_id) then raise exception 'Funding grant not found.'; end if;
  perform pg_advisory_xact_lock(hashtext('grant-condition|'||p_grant_id||'|'||p_condition_code)::bigint);
  select coalesce(max(revision),0)+1 into v_revision from vyndi_funding_grant_conditions
   where grant_id=p_grant_id and condition_code=p_condition_code;
  insert into vyndi_funding_grant_conditions(
    id,grant_id,condition_code,condition_title,condition_status,due_on,revision,evidence_reference,notes,recorded_by,recorded_role
  ) values (
    p_id,p_grant_id,trim(p_condition_code),trim(p_condition_title),p_condition_status,p_due_on,v_revision,
    p_evidence_reference,coalesce(p_notes,''),p_actor_user_id,p_actor_role
  );
  select open_condition_count into v_open from vyndi_funding_grant_balance where grant_id=p_grant_id;
  if p_condition_status='breached' then update vyndi_funding_grants set status='breached',updated_at=now() where id=p_grant_id; end if;
  return query select v_revision,coalesce(v_open,0);
end;
$$;

comment on view vyndi_funding_loan_balance is
  'Derived debt position. Loan drawdowns reference existing verified cash receipts; cash is not posted again.';
comment on view vyndi_funding_grant_balance is
  'Derived grant award, receipt, utilisation and condition position. Utilisation cannot exceed received grant funds.';
