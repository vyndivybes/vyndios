-- Founder/director-paid People & Office expenditure authority.
-- Business expenses paid personally create a current liability to the founder/director.
-- Company Bank 1000 and canonical cash remain unchanged until an evidenced reimbursement is posted.

alter table vyndi_people_office_actual_expenditures
  add column if not exists funding_source text not null default 'company_bank';

alter table vyndi_people_office_actual_expenditures
  add column if not exists governance_marker text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname='vyndi_people_office_actual_funding_source_check'
  ) then
    alter table vyndi_people_office_actual_expenditures
      add constraint vyndi_people_office_actual_funding_source_check
      check (funding_source in ('company_bank','founder_personal'));
  end if;
end;
$$;

create table if not exists vyndi_founder_reimbursements (
  id text primary key,
  expenditure_id text not null references vyndi_people_office_actual_expenditures(id) on delete restrict,
  plan_month integer not null check (plan_month between 1 and 36),
  reimbursed_on date not null,
  amount_inr numeric(18,2) not null check (amount_inr > 0),
  evidence_reference text not null unique,
  journal_id text not null unique,
  actual_revision integer not null check (actual_revision > 0),
  new_closing_cash_lakh numeric(18,4) not null,
  created_by text not null,
  created_at timestamptz not null default now()
);
create index if not exists vyndi_founder_reimbursement_idx
  on vyndi_founder_reimbursements(expenditure_id,plan_month,reimbursed_on,created_at);

-- Compatibility-preserving v2 create path. The v1 function remains available for
-- existing company-bank clients; new application code uses this function.
create or replace function create_vyndi_people_office_actual_expenditure_v2(
  p_id text,
  p_source_type text,
  p_source_id text,
  p_plan_month integer,
  p_incurred_on date,
  p_description text,
  p_amount_inr numeric,
  p_source_reference text,
  p_notes text,
  p_funding_source text,
  p_actor_user_id text,
  p_actor_role text
) returns text
language plpgsql
as $$
declare
  v_result text;
  v_liability text;
begin
  if p_funding_source not in ('company_bank','founder_personal') then
    raise exception 'Unsupported funding source %.',p_funding_source;
  end if;

  v_result:=create_vyndi_people_office_actual_expenditure(
    p_id,p_source_type,p_source_id,p_plan_month,p_incurred_on,p_description,
    p_amount_inr,p_source_reference,p_notes,p_actor_user_id,p_actor_role
  );

  update vyndi_people_office_actual_expenditures
     set funding_source=p_funding_source,
         liability_account_code=case when p_funding_source='founder_personal' then '2400' else liability_account_code end,
         updated_at=now()
   where id=p_id
   returning liability_account_code into v_liability;

  insert into vyndi_audit_events(
    id,entity_type,entity_id,action,actor_user_id,actor_role,source_reference,payload_json)
  values(
    'AUD-'||p_id||'-FUNDING','people_office_actual_expenditure',p_id,'funding_source_classified',
    p_actor_user_id,p_actor_role,p_source_reference,
    jsonb_build_object(
      'fundingSource',p_funding_source,
      'liabilityAccount',v_liability,
      'companyCashMoved',false
    )
  );

  return v_result;
end;
$$;

-- V2 approval makes the present sole-operator condition explicit rather than
-- fabricating an independent approver. Founder-personal spend is accrued as
-- Dr expense / Cr 2400 Founder / Director Current Account with no bank movement.
create or replace function approve_vyndi_people_office_actual_expenditure_v2(
  p_id text,
  p_actor_user_id text,
  p_actor_role text,
  p_sole_operator_self_approval boolean
) returns text
language plpgsql
as $$
declare
  v_funding_source text;
  v_source_reference text;
  v_result text;
begin
  select funding_source,source_reference
    into v_funding_source,v_source_reference
    from vyndi_people_office_actual_expenditures
   where id=p_id;

  if not found then
    raise exception 'People & Office actual expenditure not found.';
  end if;

  if v_funding_source='founder_personal' and not coalesce(p_sole_operator_self_approval,false) then
    raise exception 'Founder-paid expenditure requires explicit sole-operator self-approval disclosure.';
  end if;

  if v_funding_source='founder_personal' then
    update vyndi_people_office_actual_expenditures
       set liability_account_code='2400',
           governance_marker='SOLE_OPERATOR_SELF_APPROVAL',
           updated_at=now()
     where id=p_id;
  end if;

  v_result:=approve_vyndi_people_office_actual_expenditure(
    p_id,p_actor_user_id,p_actor_role
  );

  if v_funding_source='founder_personal' then
    insert into vyndi_audit_events(
      id,entity_type,entity_id,action,actor_user_id,actor_role,source_reference,payload_json)
    values(
      'AUD-'||p_id||'-SOLE-OPERATOR','people_office_actual_expenditure',p_id,
      'sole_operator_self_approval_disclosed',p_actor_user_id,p_actor_role,v_source_reference,
      jsonb_build_object(
        'governanceMarker','SOLE_OPERATOR_SELF_APPROVAL',
        'fundingSource','founder_personal',
        'liabilityAccount','2400',
        'companyCashMoved',false
      )
    )
    on conflict (id) do nothing;
  end if;

  return v_result;
end;
$$;

-- Guard the existing company-bank payment path. If an old caller attempts to
-- settle founder-personal spend through it, the insert fails and the enclosing
-- transaction rolls back its journal/cash work.
create or replace function guard_vyndi_people_office_company_payment()
returns trigger
language plpgsql
as $$
declare
  v_funding_source text;
begin
  select funding_source into v_funding_source
    from vyndi_people_office_actual_expenditures
   where id=new.expenditure_id;

  if v_funding_source='founder_personal' then
    raise exception 'Company payment path is not permitted for founder-personal expenditure; use founder reimbursement.';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_vyndi_people_office_company_payment_guard
  on vyndi_people_office_actual_payments;
create trigger trg_vyndi_people_office_company_payment_guard
before insert on vyndi_people_office_actual_payments
for each row execute function guard_vyndi_people_office_company_payment();

create or replace function post_vyndi_founder_reimbursement(
  p_id text,
  p_expenditure_id text,
  p_payment_plan_month integer,
  p_reimbursed_on date,
  p_amount_inr numeric,
  p_evidence_reference text,
  p_actor_user_id text,
  p_actor_role text
) returns table(
  reimbursement_id text,
  journal_id text,
  new_closing_cash_lakh numeric,
  actual_revision integer,
  expenditure_status text
)
language plpgsql
as $$
declare
  v_row vyndi_people_office_actual_expenditures%rowtype;
  v_reimbursed numeric;
  v_open numeric;
  v_journal text;
  v_cash numeric;
  v_revision integer;
  v_status text;
begin
  if p_payment_plan_month not between 1 and 36 then
    raise exception 'Reimbursement cash plan month must be between 1 and 36.';
  end if;
  if trim(coalesce(p_evidence_reference,''))='' then
    raise exception 'Reimbursement evidence reference is required.';
  end if;
  if coalesce(p_amount_inr,0)<=0 then
    raise exception 'Reimbursement amount must be positive.';
  end if;

  perform pg_advisory_xact_lock(hashtext('founder-reimbursement|'||p_expenditure_id)::bigint);
  select * into v_row
    from vyndi_people_office_actual_expenditures
   where id=p_expenditure_id
   for update;

  if not found then raise exception 'People & Office actual expenditure not found.'; end if;
  if v_row.funding_source<>'founder_personal' then
    raise exception 'Founder reimbursement requires founder-personal funding source.';
  end if;
  if v_row.lifecycle_status not in ('approved','part_paid') then
    raise exception 'Founder reimbursement requires an approved open expenditure.';
  end if;
  if v_row.liability_account_code<>'2400' then
    raise exception 'Founder-paid expenditure must accrue to account 2400 before reimbursement.';
  end if;

  if exists(select 1 from vyndi_founder_reimbursements where id=p_id) then
    raise exception 'Founder reimbursement id already exists.';
  end if;
  if exists(select 1 from vyndi_founder_reimbursements where evidence_reference=trim(p_evidence_reference)) then
    raise exception 'Founder reimbursement evidence reference has already been used.';
  end if;

  select coalesce(sum(amount_inr),0) into v_reimbursed
    from vyndi_founder_reimbursements
   where expenditure_id=p_expenditure_id;
  v_open:=round(v_row.amount_inr-v_reimbursed,2);
  if round(p_amount_inr,2)>v_open then
    raise exception 'Reimbursement % exceeds open founder payable balance %.',round(p_amount_inr,2),v_open;
  end if;

  v_journal:=post_vyndi_finance_journal(
    'FIN-FOUNDER-REIMB-'||p_id,
    p_reimbursed_on,
    'founder_reimbursement',
    p_id,
    'Founder / Director reimbursement · '||v_row.description,
    jsonb_build_array(
      jsonb_build_object('accountCode','2400','debitInr',round(p_amount_inr,2),'memo','Settle Founder / Director Current Account'),
      jsonb_build_object('accountCode','1000','creditInr',round(p_amount_inr,2),'memo','Company bank reimbursement · '||trim(p_evidence_reference))
    )
  );

  select c.new_closing_cash_lakh,c.actual_revision into v_cash,v_revision
    from apply_vyndi_verified_cash_movement(
      p_payment_plan_month,
      -round(p_amount_inr,2)/100000.0,
      'founder-reimbursement:'||p_id||'; '||trim(p_evidence_reference),
      p_actor_user_id,
      p_actor_role
    ) c;

  v_status:=case
    when round(v_reimbursed+p_amount_inr,2)>=v_row.amount_inr then 'paid'
    else 'part_paid'
  end;

  insert into vyndi_founder_reimbursements(
    id,expenditure_id,plan_month,reimbursed_on,amount_inr,evidence_reference,
    journal_id,actual_revision,new_closing_cash_lakh,created_by)
  values(
    p_id,p_expenditure_id,p_payment_plan_month,p_reimbursed_on,round(p_amount_inr,2),
    trim(p_evidence_reference),v_journal,v_revision,v_cash,p_actor_user_id
  );

  update vyndi_people_office_actual_expenditures
     set lifecycle_status=v_status,updated_at=now()
   where id=p_expenditure_id;

  insert into vyndi_audit_events(
    id,entity_type,entity_id,action,actor_user_id,actor_role,source_reference,payload_json)
  values(
    'AUD-'||p_id,'founder_reimbursement',p_id,'posted',p_actor_user_id,p_actor_role,
    trim(p_evidence_reference),
    jsonb_build_object(
      'expenditureId',p_expenditure_id,
      'fundingSource','founder_personal',
      'liabilityAccount','2400',
      'bankAccount','1000',
      'amountInr',round(p_amount_inr,2),
      'journalId',v_journal,
      'paymentPlanMonth',p_payment_plan_month,
      'newClosingCashLakh',v_cash,
      'actualRevision',v_revision,
      'status',v_status
    )
  );

  return query select p_id,v_journal,v_cash,v_revision,v_status;
end;
$$;

create or replace view vyndi_people_office_actual_spend_authority as
select e.id,e.source_type,e.source_id,e.source_label,e.source_category,e.plan_month,e.incurred_on,
       e.description,e.amount_inr,e.debit_account_code,e.liability_account_code,e.lifecycle_status,
       e.source_reference,e.notes,e.obligation_journal_id,e.created_by,e.submitted_by,e.submitted_at,
       e.approved_by,e.approved_at,e.created_at,e.updated_at,
       (case when e.funding_source='founder_personal'
             then coalesce(r.amount_reimbursed_inr,0)
             else coalesce(p.amount_paid_inr,0) end)::numeric(18,2) as amount_paid_inr,
       greatest(
         e.amount_inr-
         case when e.funding_source='founder_personal'
              then coalesce(r.amount_reimbursed_inr,0)
              else coalesce(p.amount_paid_inr,0) end,
         0
       )::numeric(18,2) as amount_open_inr,
       case when e.funding_source='founder_personal' then r.last_reimbursed_on else p.last_paid_on end as last_paid_on,
       case when e.funding_source='founder_personal' then r.last_reimbursement_plan_month else p.last_payment_plan_month end as last_payment_plan_month,
       e.funding_source,
       e.governance_marker,
       coalesce(r.amount_reimbursed_inr,0)::numeric(18,2) as amount_reimbursed_inr
  from vyndi_people_office_actual_expenditures e
  left join (
    select expenditure_id,sum(amount_inr) as amount_paid_inr,max(paid_on) as last_paid_on,
           max(plan_month) as last_payment_plan_month
      from vyndi_people_office_actual_payments
     group by expenditure_id
  ) p on p.expenditure_id=e.id
  left join (
    select expenditure_id,sum(amount_inr) as amount_reimbursed_inr,max(reimbursed_on) as last_reimbursed_on,
           max(plan_month) as last_reimbursement_plan_month
      from vyndi_founder_reimbursements
     group by expenditure_id
  ) r on r.expenditure_id=e.id;

comment on table vyndi_founder_reimbursements is
  'Append-only evidenced company-bank reimbursements of founder/director personally funded business expenditure. Reimbursement settles account 2400 and then moves Bank 1000 plus canonical cash.';
comment on column vyndi_people_office_actual_expenditures.funding_source is
  'company_bank = ordinary company-funded obligation; founder_personal = business expenditure paid from founder/director personal funds and accrued to account 2400.';
comment on column vyndi_people_office_actual_expenditures.governance_marker is
  'Explicit governance disclosure. Current sole-operator founder self-approval uses SOLE_OPERATOR_SELF_APPROVAL.';
