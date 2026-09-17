-- Consolidate Payroll and Fixed Asset controls onto governed People & Office source authority.
-- Existing legacy records remain readable. New fixed assets must originate from approved capital
-- expenditure. New payroll controls must link to an approved payroll obligation; they are
-- compliance evidence only and cannot invent a second payment or cash truth.

alter table epr_finance_fixed_assets
  add column if not exists source_expenditure_id text references vyndi_people_office_actual_expenditures(id) on delete restrict;

update epr_finance_fixed_assets a
   set source_expenditure_id=substring(a.asset_id from 5)
 where a.source_expenditure_id is null
   and a.asset_id like 'POA-%'
   and exists(
     select 1
       from vyndi_people_office_actual_expenditures e
      where e.id=substring(a.asset_id from 5)
        and e.source_type='asset'
        and e.debit_account_code='1500'
        and e.lifecycle_status in ('approved','part_paid','paid')
   );

create unique index if not exists epr_finance_fixed_asset_source_expenditure_uidx
  on epr_finance_fixed_assets(source_expenditure_id)
  where source_expenditure_id is not null;

create or replace function guard_vyndi_fixed_asset_source_authority()
returns trigger
language plpgsql
as $$
declare
  v_exp vyndi_people_office_actual_expenditures%rowtype;
begin
  -- Legacy rows are preserved in place. They cannot be created through this post-migration path.
  if tg_op='UPDATE' and old.source_expenditure_id is null and new.source_expenditure_id is null then
    return new;
  end if;

  if tg_op='INSERT' and new.source_expenditure_id is null and new.asset_id like 'POA-%' then
    new.source_expenditure_id:=substring(new.asset_id from 5);
  end if;

  if new.source_expenditure_id is null then
    raise exception 'Fixed assets must be derived from an approved People & Office capital expenditure; manual asset creation is disabled.';
  end if;

  if tg_op='UPDATE' and old.source_expenditure_id is not null
     and new.source_expenditure_id is distinct from old.source_expenditure_id then
    raise exception 'Fixed-asset source expenditure authority is immutable.';
  end if;

  select * into v_exp
    from vyndi_people_office_actual_expenditures
   where id=new.source_expenditure_id
     and source_type='asset'
     and debit_account_code='1500'
     and lifecycle_status in ('approved','part_paid','paid');
  if not found then
    raise exception 'Fixed asset source must be an approved People & Office capital expenditure.';
  end if;

  if abs(round(new.acquisition_cost_inr,2)-round(v_exp.amount_inr,2))>0.01 then
    raise exception 'Fixed asset acquisition cost must equal governed capital expenditure amount %.',v_exp.amount_inr;
  end if;
  if new.capitalization_date is distinct from v_exp.incurred_on then
    raise exception 'Fixed asset capitalization date must equal governed expenditure incurred date %.',v_exp.incurred_on;
  end if;
  if trim(coalesce(new.source_reference,''))<>trim(v_exp.source_reference) then
    raise exception 'Fixed asset source evidence must equal governed capital expenditure evidence.';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_vyndi_fixed_asset_source_authority on epr_finance_fixed_assets;
create trigger trg_vyndi_fixed_asset_source_authority
before insert or update on epr_finance_fixed_assets
for each row execute function guard_vyndi_fixed_asset_source_authority();

alter table epr_finance_payroll_controls
  add column if not exists source_expenditure_id text references vyndi_people_office_actual_expenditures(id) on delete restrict;

create unique index if not exists epr_finance_payroll_source_expenditure_uidx
  on epr_finance_payroll_controls(source_expenditure_id)
  where source_expenditure_id is not null;

create or replace function guard_vyndi_payroll_control_source_authority()
returns trigger
language plpgsql
as $$
declare
  v_exp vyndi_people_office_actual_expenditures%rowtype;
begin
  -- Existing legacy payroll controls stay readable and editable only as legacy records.
  if tg_op='UPDATE' and old.source_expenditure_id is null and new.source_expenditure_id is null then
    return new;
  end if;

  if new.source_expenditure_id is null then
    raise exception 'New payroll controls require a governed People & Office payroll expenditure.';
  end if;

  if tg_op='UPDATE' and old.source_expenditure_id is not null
     and new.source_expenditure_id is distinct from old.source_expenditure_id then
    raise exception 'Payroll source expenditure authority is immutable.';
  end if;

  select * into v_exp
    from vyndi_people_office_actual_expenditures
   where id=new.source_expenditure_id
     and source_type='cost_item'
     and source_category='payroll'
     and debit_account_code='6100'
     and liability_account_code='2200'
     and lifecycle_status in ('approved','part_paid','paid');
  if not found then
    raise exception 'Payroll control source must be an approved People & Office payroll expenditure.';
  end if;

  if abs(round(new.employer_cost_inr,2)-round(v_exp.amount_inr,2))>0.01 then
    raise exception 'Payroll employer cost must equal governed payroll obligation amount %.',v_exp.amount_inr;
  end if;
  if new.deductions_inr>new.gross_pay_inr then
    raise exception 'Payroll deductions cannot exceed gross pay.';
  end if;
  if new.statutory_payable_inr>new.employer_cost_inr then
    raise exception 'Payroll statutory payable cannot exceed governed employer cost.';
  end if;

  if trim(coalesce(new.payment_reference,''))<>'' and not exists(
    select 1 from vyndi_people_office_actual_payments p
     where p.expenditure_id=new.source_expenditure_id
       and p.evidence_reference=trim(new.payment_reference)
  ) then
    raise exception 'Payroll payment evidence must match a governed People & Office payment for the linked expenditure.';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_vyndi_payroll_control_source_authority on epr_finance_payroll_controls;
create trigger trg_vyndi_payroll_control_source_authority
before insert or update on epr_finance_payroll_controls
for each row execute function guard_vyndi_payroll_control_source_authority();

create or replace function save_vyndi_linked_payroll_control(
  p_payroll_id text,
  p_source_expenditure_id text,
  p_period text,
  p_gross_pay_inr numeric,
  p_deductions_inr numeric,
  p_employer_cost_inr numeric,
  p_statutory_payable_inr numeric,
  p_payment_reference text,
  p_return_evidence_reference text,
  p_actor_user_id text,
  p_actor_role text
) returns text
language plpgsql
as $$
declare
  v_existing epr_finance_payroll_controls%rowtype;
begin
  if trim(coalesce(p_payroll_id,''))='' then raise exception 'Payroll id is required.'; end if;
  if trim(coalesce(p_source_expenditure_id,''))='' then
    raise exception 'Governed payroll expenditure id is required.';
  end if;
  if p_period !~ '^\\d{4}-\\d{2}$' then raise exception 'Payroll period must use YYYY-MM.'; end if;
  if coalesce(p_gross_pay_inr,0)<0 or coalesce(p_deductions_inr,0)<0
     or coalesce(p_employer_cost_inr,0)<0 or coalesce(p_statutory_payable_inr,0)<0 then
    raise exception 'Payroll control amounts cannot be negative.';
  end if;

  select * into v_existing from epr_finance_payroll_controls where payroll_id=upper(trim(p_payroll_id)) for update;
  if found and v_existing.source_expenditure_id is not null
     and v_existing.source_expenditure_id<>trim(p_source_expenditure_id) then
    raise exception 'Payroll control is already linked to another governed expenditure.';
  end if;

  insert into epr_finance_payroll_controls(
    payroll_id,source_expenditure_id,period,gross_pay_inr,deductions_inr,employer_cost_inr,
    statutory_payable_inr,payment_reference,return_evidence_reference,approved_by,approved_at)
  values(
    upper(trim(p_payroll_id)),trim(p_source_expenditure_id),p_period,round(p_gross_pay_inr,2),
    round(p_deductions_inr,2),round(p_employer_cost_inr,2),round(p_statutory_payable_inr,2),
    nullif(trim(coalesce(p_payment_reference,'')),''),
    nullif(trim(coalesce(p_return_evidence_reference,'')),''),
    p_actor_user_id,now())
  on conflict (payroll_id) do update set
    source_expenditure_id=excluded.source_expenditure_id,
    period=excluded.period,
    gross_pay_inr=excluded.gross_pay_inr,
    deductions_inr=excluded.deductions_inr,
    employer_cost_inr=excluded.employer_cost_inr,
    statutory_payable_inr=excluded.statutory_payable_inr,
    payment_reference=excluded.payment_reference,
    return_evidence_reference=excluded.return_evidence_reference,
    approved_by=excluded.approved_by,
    approved_at=now();

  return upper(trim(p_payroll_id));
end;
$$;

comment on column epr_finance_fixed_assets.source_expenditure_id is
  'Canonical People & Office capital-expenditure authority for governed assets. Null identifies legacy rows created before source-authority consolidation.';
comment on column epr_finance_payroll_controls.source_expenditure_id is
  'Canonical People & Office payroll-expenditure authority. New payroll controls are compliance evidence linked to this source and never create payment or cash.';
comment on function save_vyndi_linked_payroll_control(text,text,text,numeric,numeric,numeric,numeric,text,text,text,text) is
  'Writes payroll compliance evidence only after reconciling employer cost and payment evidence to the governed People & Office payroll expenditure.';
