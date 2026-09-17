-- Governed sales credit -> receivable -> collection -> canonical cash chain.
-- Existing historical invoices are not assigned invented credit terms. New controlled invoices
-- use issue_vyndi_credit_tax_invoice so due date, evidence and credit terms are explicit.

alter table vyndi_invoices add column if not exists credit_terms_days integer;
alter table vyndi_invoices add column if not exists due_on date;
alter table vyndi_invoices add column if not exists credit_terms_reference text;
alter table vyndi_invoices add column if not exists credit_profile_status text not null default 'legacy_unclassified';

alter table vyndi_invoices drop constraint if exists vyndi_invoices_credit_terms_days_check;
alter table vyndi_invoices add constraint vyndi_invoices_credit_terms_days_check
  check (credit_terms_days is null or credit_terms_days between 0 and 365);
alter table vyndi_invoices drop constraint if exists vyndi_invoices_credit_profile_status_check;
alter table vyndi_invoices add constraint vyndi_invoices_credit_profile_status_check
  check (credit_profile_status in ('legacy_unclassified','controlled'));
alter table vyndi_invoices drop constraint if exists vyndi_invoices_credit_profile_integrity_check;
alter table vyndi_invoices add constraint vyndi_invoices_credit_profile_integrity_check
  check (
    credit_profile_status='legacy_unclassified'
    or (credit_terms_days is not null and due_on is not null and trim(coalesce(credit_terms_reference,''))<>'')
  );
create index if not exists vyndi_invoices_due_idx
  on vyndi_invoices(status,credit_profile_status,due_on);

alter table vyndi_collections add column if not exists cash_actual_revision integer;
alter table vyndi_collections add column if not exists new_closing_cash_lakh numeric(18,4);
alter table vyndi_collections add column if not exists cash_reversal_revision integer;
alter table vyndi_collections add column if not exists reversed_closing_cash_lakh numeric(18,4);

-- Make the shared cash bridge safe for transactions that simultaneously change
-- transaction-controlled revenue/units/receivables. Those fields are refreshed from
-- vyndi_monthly_transaction_actuals by save_vyndi_monthly_actual rather than replaying
-- the pre-movement monthly-actual snapshot.
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
    null,
    null,
    v_actual.cogs,
    v_actual.opex,
    v_new_cash,
    v_actual.inventory,
    null,
    v_actual.payables,
    v_source,
    true,
    p_actor_user_id,
    p_actor_role
  );

  return query select v_new_cash,v_revision;
end;
$$;

create or replace function issue_vyndi_credit_tax_invoice(
  p_id text,p_shipment_id text,p_source_reference text,
  p_recipient_name text,p_recipient_gstin text,p_recipient_address text,p_delivery_address text,
  p_place_of_supply_code text,p_hsn_sac text,p_item_description text,p_unit_code text,
  p_tax_rate_pct numeric,p_tax_mode text,p_reverse_charge boolean,p_e_invoice_required boolean,
  p_irn text,p_irn_ack_number text,p_irn_ack_at timestamptz,p_tax_evidence_reference text,
  p_credit_terms_days integer,p_credit_terms_reference text,
  p_actor_user_id text,p_actor_role text
) returns table(invoice_id text, amount_lakh numeric, gross_amount_inr numeric, due_on date)
language plpgsql
as $$
declare
  v_id text;
  v_amount numeric;
  v_gross numeric;
  v_due date;
  v_existing record;
begin
  if p_credit_terms_days not between 0 and 365 then
    raise exception 'Credit terms must be between 0 and 365 days.';
  end if;
  if trim(coalesce(p_credit_terms_reference,''))='' then
    raise exception 'Credit terms evidence/reference is required.';
  end if;

  select id,status,credit_profile_status,credit_terms_days,due_on,credit_terms_reference,
         amount_lakh,gross_amount_inr
    into v_existing
    from vyndi_invoices where id=p_id;
  if found then
    if v_existing.status='issued'
       and v_existing.credit_profile_status='controlled'
       and v_existing.credit_terms_days=p_credit_terms_days
       and v_existing.credit_terms_reference=trim(p_credit_terms_reference) then
      return query select p_id,v_existing.amount_lakh,v_existing.gross_amount_inr,v_existing.due_on;
      return;
    end if;
    raise exception 'Invoice id already exists and cannot be assigned or changed to a different credit profile.';
  end if;

  select x.invoice_id,x.amount_lakh,x.gross_amount_inr
    into v_id,v_amount,v_gross
    from issue_vyndi_tax_invoice(
      p_id,p_shipment_id,p_source_reference,
      p_recipient_name,p_recipient_gstin,p_recipient_address,p_delivery_address,
      p_place_of_supply_code,p_hsn_sac,p_item_description,p_unit_code,
      p_tax_rate_pct,p_tax_mode,p_reverse_charge,p_e_invoice_required,
      p_irn,p_irn_ack_number,p_irn_ack_at,p_tax_evidence_reference,
      p_actor_user_id,p_actor_role
    ) x;

  if v_id is null then raise exception 'Controlled tax invoice did not return an invoice record.'; end if;
  v_due:=current_date+p_credit_terms_days;

  update vyndi_invoices
     set credit_terms_days=p_credit_terms_days,
         due_on=v_due,
         credit_terms_reference=trim(p_credit_terms_reference),
         credit_profile_status='controlled'
   where id=v_id and status='issued';

  insert into vyndi_audit_events(
    id,entity_type,entity_id,entity_revision,action,actor_user_id,actor_role,source_reference,payload_json)
  values(
    'AUD-CREDIT-'||v_id||'-R1','invoice_credit_profile',v_id,1,'controlled_terms_set',
    p_actor_user_id,p_actor_role,trim(p_credit_terms_reference),
    jsonb_build_object('creditTermsDays',p_credit_terms_days,'dueOn',v_due,
      'invoiceId',v_id,'grossAmountInr',v_gross)
  );

  return query select v_id,v_amount,v_gross,v_due;
end;
$$;

-- Gross invoice value, including output GST, is the receivable. Revenue remains net/taxable.
create or replace view vyndi_monthly_transaction_actuals as
with months as (select generate_series(1,36)::integer as plan_month),
invoice_month as (
  select plan_month,sum(amount_lakh)::numeric(18,4) revenue,sum(units)::numeric(14,4) units
    from vyndi_invoices where status='issued' group by plan_month
),
invoice_cume as (
  select m.plan_month,
         coalesce((select sum(case when i.gross_amount_inr>0 then i.gross_amount_inr/100000.0 else i.amount_lakh end)
                     from vyndi_invoices i where i.status='issued' and i.plan_month<=m.plan_month),0)::numeric(18,4) invoiced
    from months m
),
collection_cume as (
  select m.plan_month,coalesce((select sum(c.amount_lakh) from vyndi_collections c where c.status='posted' and c.plan_month<=m.plan_month),0)::numeric(18,4) collected
    from months m
)
select m.plan_month,coalesce(im.revenue,0)::numeric(18,4) revenue,coalesce(im.units,0)::numeric(14,4) units,
       greatest(ic.invoiced-cc.collected,0)::numeric(18,4) receivables
  from months m left join invoice_month im using(plan_month)
  join invoice_cume ic using(plan_month) join collection_cume cc using(plan_month);

comment on view vyndi_monthly_transaction_actuals is
  'Canonical transaction-derived revenue, units and gross trade receivables. Revenue excludes output GST; receivables include the customer gross invoice obligation.';

create or replace function post_vyndi_collection(
  p_id text,p_invoice_id text,p_plan_month integer,p_amount_lakh numeric,p_source_reference text,
  p_actor_user_id text,p_actor_role text
) returns text
language plpgsql
as $$
declare
  v_invoice_amount numeric;
  v_collected numeric;
  v_snapshot jsonb;
  v_cash numeric;
  v_revision integer;
begin
  if p_plan_month not between 1 and 36 then raise exception 'Collection cash plan month must be between 1 and 36.'; end if;
  if trim(coalesce(p_source_reference,''))='' then raise exception 'Collection source reference is required.'; end if;
  perform pg_advisory_xact_lock(hashtext('collection|' || p_id)::bigint);
  if exists(select 1 from vyndi_collections where id=p_id) then
    if exists(select 1 from vyndi_collections where id=p_id and invoice_id=p_invoice_id and plan_month=p_plan_month and amount_lakh=p_amount_lakh and status='posted') then return p_id; end if;
    raise exception 'Collection id already exists with different state.';
  end if;
  if exists(select 1 from vyndi_collections where trim(source_reference)=trim(p_source_reference)) then
    raise exception 'Collection bank evidence/reference has already been used.';
  end if;

  select case when gross_amount_inr>0 then gross_amount_inr/100000.0 else amount_lakh end into v_invoice_amount
    from vyndi_invoices where id=p_invoice_id and status='issued';
  if not found then raise exception 'Issued invoice not found.'; end if;
  select coalesce(sum(amount_lakh),0) into v_collected from vyndi_collections where invoice_id=p_invoice_id and status='posted';
  if p_amount_lakh<=0 or v_collected+p_amount_lakh>v_invoice_amount+0.000001 then
    raise exception 'Collection exceeds open gross invoice receivable.';
  end if;

  insert into vyndi_collections(id,invoice_id,plan_month,amount_lakh,source_reference,posted_by)
  values(p_id,p_invoice_id,p_plan_month,p_amount_lakh,trim(p_source_reference),p_actor_user_id);

  select c.new_closing_cash_lakh,c.actual_revision into v_cash,v_revision
    from apply_vyndi_verified_cash_movement(
      p_plan_month,
      p_amount_lakh,
      'customer-collection:'||p_id||'; '||trim(p_source_reference),
      p_actor_user_id,
      p_actor_role
    ) c;

  update vyndi_collections
     set cash_actual_revision=v_revision,new_closing_cash_lakh=v_cash
   where id=p_id;

  v_snapshot:=jsonb_build_object(
    'collectionId',p_id,'invoiceId',p_invoice_id,'cashPlanMonth',p_plan_month,
    'amountLakh',p_amount_lakh,'bankAccount','1000','newClosingCashLakh',v_cash,
    'actualRevision',v_revision);
  insert into vyndi_audit_events(id,entity_type,entity_id,entity_revision,action,actor_user_id,actor_role,source_reference,payload_json)
  values('AUD-COL-'||p_id||'-R1','collection',p_id,1,'posted',p_actor_user_id,p_actor_role,trim(p_source_reference),v_snapshot);
  return p_id;
end;
$$;

create or replace function reverse_vyndi_collection(
  p_id text,p_reason text,p_actor_user_id text,p_actor_role text
) returns integer
language plpgsql
as $$
declare
  v_row vyndi_collections%rowtype;
  v_revision integer;
  v_cash numeric;
  v_cash_revision integer;
begin
  if trim(coalesce(p_reason,''))='' then raise exception 'Collection reversal reason is required.'; end if;
  perform pg_advisory_xact_lock(hashtext('collection|' || p_id)::bigint);
  select * into v_row from vyndi_collections where id=p_id for update;
  if not found then raise exception 'Posted collection not found.'; end if;
  if v_row.status='reversed' then return v_row.revision; end if;

  update vyndi_collections
     set status='reversed',revision=revision+1,reversed_by=p_actor_user_id,reversed_at=now(),reversal_reason=p_reason
   where id=p_id and status='posted'
   returning revision into v_revision;
  if not found then raise exception 'Posted collection not found.'; end if;

  -- Legacy collections that never moved canonical cash are not retrospectively adjusted.
  if v_row.cash_actual_revision is not null then
    select c.new_closing_cash_lakh,c.actual_revision into v_cash,v_cash_revision
      from apply_vyndi_verified_cash_movement(
        v_row.plan_month,
        -v_row.amount_lakh,
        'customer-collection-reversal:'||p_id||'; '||trim(p_reason),
        p_actor_user_id,
        p_actor_role
      ) c;
    update vyndi_collections
       set cash_reversal_revision=v_cash_revision,reversed_closing_cash_lakh=v_cash
     where id=p_id;
  end if;

  insert into vyndi_audit_events(id,entity_type,entity_id,entity_revision,action,actor_user_id,actor_role,source_reference,payload_json)
  values(
    'AUD-COL-'||p_id||'-R'||v_revision,'collection',p_id,v_revision,'reversed',p_actor_user_id,p_actor_role,
    trim(p_reason),jsonb_build_object('reason',p_reason,'cashPlanMonth',v_row.plan_month,
      'cashReversed',v_row.cash_actual_revision is not null,'newClosingCashLakh',v_cash,
      'actualRevision',v_cash_revision));
  return v_revision;
end;
$$;

create or replace view vyndi_report_receivables_aging as
select
  i.id as invoice_id,
  i.sales_order_id,
  i.plan_month,
  (case when i.gross_amount_inr>0 then i.gross_amount_inr/100000.0 else i.amount_lakh end)::numeric(18,4) as invoiced_lakh,
  coalesce(col.collected_lakh, 0)::numeric(18,4) as collected_lakh,
  greatest((case when i.gross_amount_inr>0 then i.gross_amount_inr/100000.0 else i.amount_lakh end)-coalesce(col.collected_lakh,0),0)::numeric(18,4) as open_lakh,
  i.issued_at::date as issued_on,
  (current_date - i.issued_at::date) as age_days,
  case
    when i.credit_profile_status<>'controlled' or i.due_on is null then 'LEGACY_NO_TERMS'
    when i.due_on >= current_date then 'CURRENT'
    when (current_date-i.due_on) > 90 then 'OVER_90'
    when (current_date-i.due_on) > 60 then 'OVER_60'
    when (current_date-i.due_on) > 30 then 'OVER_30'
    else 'OVERDUE'
  end as aging_bucket,
  i.credit_terms_days,
  i.due_on,
  case when i.due_on is null then null else greatest(current_date-i.due_on,0) end as days_overdue,
  i.credit_profile_status,
  i.credit_terms_reference
from vyndi_invoices i
left join (
  select invoice_id, sum(amount_lakh) as collected_lakh
    from vyndi_collections where status='posted'
   group by invoice_id
) col on col.invoice_id=i.id
where i.status='issued'
  and greatest((case when i.gross_amount_inr>0 then i.gross_amount_inr/100000.0 else i.amount_lakh end)-coalesce(col.collected_lakh,0),0)>0;

comment on view vyndi_report_receivables_aging is
  'Open gross customer receivables aged from controlled due date. Legacy invoices without evidenced credit terms are explicitly identified rather than assigned invented terms.';
