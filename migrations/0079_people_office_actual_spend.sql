-- Governed People & Office actual expenditure -> obligation -> payment -> cash authority chain.
-- Planning/approved budget records remain upstream intent. Only an approved actual expenditure
-- creates an accounting obligation; only an evidenced payment moves Bank and canonical cash.
-- Accrual month and payment/cash month are explicit and intentionally separate.

create table if not exists vyndi_people_office_actual_expenditures (
  id text primary key,
  source_type text not null check (source_type in ('cost_item','asset')),
  source_id text not null,
  source_label text not null,
  source_category text not null,
  plan_month integer not null check (plan_month between 1 and 36),
  incurred_on date not null,
  description text not null,
  amount_inr numeric(18,2) not null check (amount_inr > 0),
  debit_account_code text not null,
  liability_account_code text not null,
  lifecycle_status text not null default 'draft'
    check (lifecycle_status in ('draft','pending_approval','approved','part_paid','paid')),
  source_reference text not null,
  notes text not null default '',
  obligation_journal_id text,
  created_by text not null,
  submitted_by text,
  submitted_at timestamptz,
  approved_by text,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists vyndi_people_office_actual_status_idx
  on vyndi_people_office_actual_expenditures(lifecycle_status,plan_month,incurred_on desc);
create index if not exists vyndi_people_office_actual_source_idx
  on vyndi_people_office_actual_expenditures(source_type,source_id,plan_month);

create table if not exists vyndi_people_office_actual_payments (
  id text primary key,
  expenditure_id text not null references vyndi_people_office_actual_expenditures(id) on delete restrict,
  plan_month integer not null check (plan_month between 1 and 36),
  paid_on date not null,
  amount_inr numeric(18,2) not null check (amount_inr > 0),
  evidence_reference text not null unique,
  journal_id text not null unique,
  actual_revision integer not null check (actual_revision > 0),
  new_closing_cash_lakh numeric(18,4) not null,
  created_by text not null,
  created_at timestamptz not null default now()
);
create index if not exists vyndi_people_office_actual_payment_idx
  on vyndi_people_office_actual_payments(expenditure_id,plan_month,paid_on,created_at);

-- Reusable bridge for a verified bank movement whose governed plan month is known explicitly.
-- This does not infer a plan month from a calendar date.
create or replace function apply_vyndi_verified_cash_movement(
  p_plan_month integer,
  p_delta_lakh numeric,
  p_source_reference text,
  p_actor_user_id text,
  p_actor_role text
) returns table(new_closing_cash_lakh numeric, actual_revision integer)
language plpgsql
as $$
declare
  v_actual vyndi_monthly_actuals%rowtype;
  v_new_cash numeric;
  v_revision integer;
  v_source text;
begin
  if p_plan_month not between 1 and 36 then
    raise exception 'Cash movement plan month must be between 1 and 36.';
  end if;
  if coalesce(p_delta_lakh,0)=0 then
    raise exception 'Cash movement must be non-zero.';
  end if;
  if trim(coalesce(p_source_reference,''))='' then
    raise exception 'Cash movement evidence reference is required.';
  end if;

  perform pg_advisory_xact_lock(hashtext('cash-actual|'||p_plan_month)::bigint);
  select * into v_actual
    from vyndi_monthly_actuals
   where plan_month=p_plan_month and verified=true and closing_cash is not null
   for update;
  if not found then
    raise exception 'M% has no verified closing-cash baseline. Post or verify canonical cash before this bank movement.',p_plan_month;
  end if;

  v_new_cash:=round(v_actual.closing_cash+p_delta_lakh,4);
  v_source:=concat_ws('; ',nullif(trim(coalesce(v_actual.source_reference,'')),''),trim(p_source_reference));

  v_revision:=save_vyndi_monthly_actual(
    p_plan_month,
    v_actual.revenue,
    v_actual.units,
    v_actual.cogs,
    v_actual.opex,
    v_new_cash,
    v_actual.inventory,
    v_actual.receivables,
    v_actual.payables,
    v_source,
    true,
    p_actor_user_id,
    p_actor_role
  );

  return query select v_new_cash,v_revision;
end;
$$;

create or replace function create_vyndi_people_office_actual_expenditure(
  p_id text,
  p_source_type text,
  p_source_id text,
  p_plan_month integer,
  p_incurred_on date,
  p_description text,
  p_amount_inr numeric,
  p_source_reference text,
  p_notes text,
  p_actor_user_id text,
  p_actor_role text
) returns text
language plpgsql
as $$
declare
  v_label text;
  v_category text;
  v_debit text;
  v_liability text;
begin
  if trim(coalesce(p_source_reference,''))='' then
    raise exception 'Actual expenditure evidence/source reference is required.';
  end if;
  if trim(coalesce(p_description,''))='' then
    raise exception 'Actual expenditure description is required.';
  end if;
  if coalesce(p_amount_inr,0)<=0 then
    raise exception 'Actual expenditure amount must be positive.';
  end if;
  if p_plan_month not between 1 and 36 then
    raise exception 'Actual expenditure accrual plan month must be between 1 and 36.';
  end if;

  if p_source_type='cost_item' then
    select name,cost_group into v_label,v_category
      from vyndi_people_office_cost_items
     where id=p_source_id and lifecycle_status='approved';
    if not found then raise exception 'Actual cost requires an approved People & Office cost item.'; end if;
    v_debit:=case v_category
      when 'payroll' then '6100'
      when 'office' then '6200'
      when 'statutory' then '6300'
      when 'outsourcing' then '6400'
      else null end;
    v_liability:=case when v_category in ('payroll','statutory') then '2200' else '2000' end;
  elsif p_source_type='asset' then
    select name,asset_class into v_label,v_category
      from vyndi_people_office_assets
     where id=p_source_id and lifecycle_status='approved';
    if not found then raise exception 'Actual asset spend requires an approved People & Office asset item.'; end if;
    v_debit:=case when v_category='office_admin' then '1500' else '6200' end;
    v_liability:='2000';
  else
    raise exception 'Unsupported People & Office source type %.',p_source_type;
  end if;

  if v_debit is null then raise exception 'No controlled accounting map exists for source %.',p_source_id; end if;

  insert into vyndi_people_office_actual_expenditures(
    id,source_type,source_id,source_label,source_category,plan_month,incurred_on,description,
    amount_inr,debit_account_code,liability_account_code,lifecycle_status,source_reference,notes,created_by)
  values(
    p_id,p_source_type,p_source_id,v_label,v_category,p_plan_month,p_incurred_on,trim(p_description),
    round(p_amount_inr,2),v_debit,v_liability,'draft',trim(p_source_reference),coalesce(p_notes,''),p_actor_user_id);

  insert into vyndi_audit_events(
    id,entity_type,entity_id,action,actor_user_id,actor_role,source_reference,payload_json)
  values(
    'AUD-'||p_id||'-DRAFT','people_office_actual_expenditure',p_id,'draft_created',p_actor_user_id,p_actor_role,
    p_source_reference,jsonb_build_object('sourceType',p_source_type,'sourceId',p_source_id,'accrualPlanMonth',p_plan_month,
      'amountInr',round(p_amount_inr,2),'debitAccount',v_debit,'liabilityAccount',v_liability));
  return p_id;
end;
$$;

create or replace function submit_vyndi_people_office_actual_expenditure(
  p_id text,p_actor_user_id text,p_actor_role text
) returns text
language plpgsql
as $$
begin
  update vyndi_people_office_actual_expenditures
     set lifecycle_status='pending_approval',submitted_by=p_actor_user_id,submitted_at=now(),updated_at=now()
   where id=p_id and lifecycle_status='draft';
  if not found then raise exception 'Only a draft actual expenditure may be submitted.'; end if;

  insert into vyndi_audit_events(id,entity_type,entity_id,action,actor_user_id,actor_role,payload_json)
  values('AUD-'||p_id||'-SUBMIT','people_office_actual_expenditure',p_id,'submitted_for_approval',
    p_actor_user_id,p_actor_role,jsonb_build_object('to','pending_approval'));
  return p_id;
end;
$$;

create or replace function approve_vyndi_people_office_actual_expenditure(
  p_id text,p_actor_user_id text,p_actor_role text
) returns text
language plpgsql
as $$
declare
  v_row vyndi_people_office_actual_expenditures%rowtype;
  v_journal text;
begin
  perform pg_advisory_xact_lock(hashtext('people-office-actual|'||p_id)::bigint);
  select * into v_row from vyndi_people_office_actual_expenditures where id=p_id for update;
  if not found then raise exception 'People & Office actual expenditure not found.'; end if;
  if v_row.lifecycle_status in ('approved','part_paid','paid') then return p_id; end if;
  if v_row.lifecycle_status<>'pending_approval' then
    raise exception 'Only a pending actual expenditure may be approved.';
  end if;

  if v_row.source_type='cost_item' and not exists(
    select 1 from vyndi_people_office_cost_items where id=v_row.source_id and lifecycle_status='approved') then
    raise exception 'Source cost item is no longer approved.';
  end if;
  if v_row.source_type='asset' and not exists(
    select 1 from vyndi_people_office_assets where id=v_row.source_id and lifecycle_status='approved') then
    raise exception 'Source asset item is no longer approved.';
  end if;

  v_journal:=post_vyndi_finance_journal(
    'FIN-POEXP-'||v_row.id,
    v_row.incurred_on,
    'people_office_obligation',
    v_row.id,
    'People & Office actual obligation · '||v_row.description,
    jsonb_build_array(
      jsonb_build_object('accountCode',v_row.debit_account_code,'debitInr',v_row.amount_inr,'memo',v_row.source_label),
      jsonb_build_object('accountCode',v_row.liability_account_code,'creditInr',v_row.amount_inr,'memo','Approved expenditure obligation')
    )
  );

  update vyndi_people_office_actual_expenditures
     set lifecycle_status='approved',approved_by=p_actor_user_id,approved_at=now(),obligation_journal_id=v_journal,updated_at=now()
   where id=p_id;

  if v_row.source_type='asset' and v_row.debit_account_code='1500' then
    insert into epr_finance_fixed_assets(
      asset_id,description,capitalization_date,acquisition_cost_inr,useful_life_months,source_reference,status)
    select 'POA-'||v_row.id,v_row.source_label||' · '||v_row.description,v_row.incurred_on,v_row.amount_inr,
           greatest(a.useful_life_months,1),v_row.source_reference,'active'
      from vyndi_people_office_assets a where a.id=v_row.source_id
    on conflict (asset_id) do nothing;
  end if;

  insert into vyndi_audit_events(
    id,entity_type,entity_id,action,actor_user_id,actor_role,source_reference,payload_json)
  values(
    'AUD-'||p_id||'-APPROVED','people_office_actual_expenditure',p_id,'approved_and_accrued',p_actor_user_id,p_actor_role,
    v_row.source_reference,jsonb_build_object('journalId',v_journal,'accrualPlanMonth',v_row.plan_month,'amountInr',v_row.amount_inr,
      'debitAccount',v_row.debit_account_code,'liabilityAccount',v_row.liability_account_code,'cashMoved',false));
  return p_id;
end;
$$;

create or replace function post_vyndi_people_office_actual_payment(
  p_id text,
  p_expenditure_id text,
  p_payment_plan_month integer,
  p_paid_on date,
  p_amount_inr numeric,
  p_evidence_reference text,
  p_actor_user_id text,
  p_actor_role text
) returns table(
  payment_id text,
  journal_id text,
  new_closing_cash_lakh numeric,
  actual_revision integer,
  expenditure_status text
)
language plpgsql
as $$
declare
  v_row vyndi_people_office_actual_expenditures%rowtype;
  v_paid numeric;
  v_open numeric;
  v_journal text;
  v_cash numeric;
  v_revision integer;
  v_status text;
begin
  if p_payment_plan_month not between 1 and 36 then
    raise exception 'Payment cash plan month must be between 1 and 36.';
  end if;
  if trim(coalesce(p_evidence_reference,''))='' then
    raise exception 'Payment evidence reference is required.';
  end if;
  if coalesce(p_amount_inr,0)<=0 then raise exception 'Payment amount must be positive.'; end if;

  perform pg_advisory_xact_lock(hashtext('people-office-payment|'||p_expenditure_id)::bigint);
  select * into v_row from vyndi_people_office_actual_expenditures where id=p_expenditure_id for update;
  if not found then raise exception 'People & Office actual expenditure not found.'; end if;
  if v_row.lifecycle_status not in ('approved','part_paid') then
    raise exception 'Payment requires an approved open expenditure.';
  end if;

  if exists(select 1 from vyndi_people_office_actual_payments where id=p_id) then
    raise exception 'Payment id already exists.';
  end if;
  if exists(select 1 from vyndi_people_office_actual_payments where evidence_reference=trim(p_evidence_reference)) then
    raise exception 'Payment evidence reference has already been used.';
  end if;

  select coalesce(sum(amount_inr),0) into v_paid
    from vyndi_people_office_actual_payments where expenditure_id=p_expenditure_id;
  v_open:=round(v_row.amount_inr-v_paid,2);
  if round(p_amount_inr,2)>v_open then
    raise exception 'Payment % exceeds open expenditure balance %.',round(p_amount_inr,2),v_open;
  end if;

  v_journal:=post_vyndi_finance_journal(
    'FIN-POEXP-PAY-'||p_id,
    p_paid_on,
    'people_office_payment',
    p_id,
    'People & Office payment · '||v_row.description,
    jsonb_build_array(
      jsonb_build_object('accountCode',v_row.liability_account_code,'debitInr',round(p_amount_inr,2),'memo','Settle approved expenditure obligation'),
      jsonb_build_object('accountCode','1000','creditInr',round(p_amount_inr,2),'memo','Bank payment · '||trim(p_evidence_reference))
    )
  );

  select c.new_closing_cash_lakh,c.actual_revision into v_cash,v_revision
    from apply_vyndi_verified_cash_movement(
      p_payment_plan_month,
      -round(p_amount_inr,2)/100000.0,
      'people-office-payment:'||p_id||'; '||trim(p_evidence_reference),
      p_actor_user_id,
      p_actor_role
    ) c;

  v_status:=case when round(v_paid+p_amount_inr,2)>=v_row.amount_inr then 'paid' else 'part_paid' end;

  insert into vyndi_people_office_actual_payments(
    id,expenditure_id,plan_month,paid_on,amount_inr,evidence_reference,journal_id,actual_revision,new_closing_cash_lakh,created_by)
  values(
    p_id,p_expenditure_id,p_payment_plan_month,p_paid_on,round(p_amount_inr,2),trim(p_evidence_reference),v_journal,v_revision,v_cash,p_actor_user_id);

  update vyndi_people_office_actual_expenditures
     set lifecycle_status=v_status,updated_at=now()
   where id=p_expenditure_id;

  insert into vyndi_audit_events(
    id,entity_type,entity_id,action,actor_user_id,actor_role,source_reference,payload_json)
  values(
    'AUD-'||p_id,'people_office_actual_payment',p_id,'posted',p_actor_user_id,p_actor_role,trim(p_evidence_reference),
    jsonb_build_object('expenditureId',p_expenditure_id,'accrualPlanMonth',v_row.plan_month,'paymentPlanMonth',p_payment_plan_month,
      'amountInr',round(p_amount_inr,2),'journalId',v_journal,'bankAccount','1000',
      'newClosingCashLakh',v_cash,'actualRevision',v_revision,'status',v_status));

  return query select p_id,v_journal,v_cash,v_revision,v_status;
end;
$$;

create or replace view vyndi_people_office_actual_spend_authority as
select e.id,e.source_type,e.source_id,e.source_label,e.source_category,e.plan_month,e.incurred_on,
       e.description,e.amount_inr,e.debit_account_code,e.liability_account_code,e.lifecycle_status,
       e.source_reference,e.notes,e.obligation_journal_id,e.created_by,e.submitted_by,e.submitted_at,
       e.approved_by,e.approved_at,e.created_at,e.updated_at,
       coalesce(p.amount_paid_inr,0)::numeric(18,2) as amount_paid_inr,
       greatest(e.amount_inr-coalesce(p.amount_paid_inr,0),0)::numeric(18,2) as amount_open_inr,
       p.last_paid_on,p.last_payment_plan_month
  from vyndi_people_office_actual_expenditures e
  left join (
    select expenditure_id,sum(amount_inr) as amount_paid_inr,max(paid_on) as last_paid_on,
           max(plan_month) as last_payment_plan_month
      from vyndi_people_office_actual_payments group by expenditure_id
  ) p on p.expenditure_id=e.id;

comment on table vyndi_people_office_actual_expenditures is
  'Actual People & Office obligations. Approved planning records do not create accounting entries until an actual expenditure is separately submitted and approved.';
comment on table vyndi_people_office_actual_payments is
  'Append-only evidenced bank payments against approved People & Office actual obligations. Each payment carries its own explicit cash plan month, posts GL, and revises verified canonical cash.';
comment on function apply_vyndi_verified_cash_movement(integer,numeric,text,text,text) is
  'Reusable verified monthly cash bridge for bank movements with an explicit governed plan month; never infers month from calendar date.';