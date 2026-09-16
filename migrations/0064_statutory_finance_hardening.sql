-- VYNDI statutory-finance hardening.
-- This migration strengthens transaction evidence, bank reconciliation, period close
-- and CA review readiness. It does not represent statutory certification or filing.

create table if not exists epr_finance_tax_registration (
  id text primary key default 'PRIMARY',
  legal_name text not null,
  trade_name text,
  gstin text not null,
  registered_address text not null,
  state_code text not null,
  pan text,
  aato_inr numeric(18,2),
  e_invoice_applicable boolean not null default false,
  effective_from date not null,
  source_reference text not null,
  updated_by text not null,
  updated_at timestamptz not null default now(),
  check (char_length(trim(gstin))=15),
  check (state_code ~ '^[0-9]{2}$')
);

alter table vyndi_invoices add column if not exists recipient_name text;
alter table vyndi_invoices add column if not exists recipient_gstin text;
alter table vyndi_invoices add column if not exists recipient_address text;
alter table vyndi_invoices add column if not exists delivery_address text;
alter table vyndi_invoices add column if not exists place_of_supply_code text;
alter table vyndi_invoices add column if not exists hsn_sac text;
alter table vyndi_invoices add column if not exists item_description text;
alter table vyndi_invoices add column if not exists unit_code text default 'NOS';
alter table vyndi_invoices add column if not exists taxable_value_inr numeric(18,2) not null default 0;
alter table vyndi_invoices add column if not exists tax_rate_pct numeric(8,4) not null default 0;
alter table vyndi_invoices add column if not exists tax_mode text not null default 'pending';
alter table vyndi_invoices add column if not exists cgst_inr numeric(18,2) not null default 0;
alter table vyndi_invoices add column if not exists sgst_inr numeric(18,2) not null default 0;
alter table vyndi_invoices add column if not exists igst_inr numeric(18,2) not null default 0;
alter table vyndi_invoices add column if not exists cess_inr numeric(18,2) not null default 0;
alter table vyndi_invoices add column if not exists gst_inr numeric(18,2) not null default 0;
alter table vyndi_invoices add column if not exists gross_amount_inr numeric(18,2) not null default 0;
alter table vyndi_invoices add column if not exists reverse_charge boolean not null default false;
alter table vyndi_invoices add column if not exists e_invoice_required boolean not null default false;
alter table vyndi_invoices add column if not exists irn text;
alter table vyndi_invoices add column if not exists irn_ack_number text;
alter table vyndi_invoices add column if not exists irn_ack_at timestamptz;
alter table vyndi_invoices add column if not exists tax_evidence_reference text;
alter table vyndi_invoices add column if not exists tax_profile_status text not null default 'pending';

update vyndi_invoices
   set taxable_value_inr=round(amount_lakh*100000,2),
       gross_amount_inr=round(amount_lakh*100000,2)
 where taxable_value_inr=0 and amount_lakh>0;

alter table vyndi_invoices drop constraint if exists vyndi_invoices_tax_mode_check;
alter table vyndi_invoices add constraint vyndi_invoices_tax_mode_check
  check (tax_mode in ('pending','cgst_sgst','igst','zero_rated','exempt'));
alter table vyndi_invoices drop constraint if exists vyndi_invoices_tax_profile_status_check;
alter table vyndi_invoices add constraint vyndi_invoices_tax_profile_status_check
  check (tax_profile_status in ('pending','complete'));
alter table vyndi_invoices drop constraint if exists vyndi_invoices_tax_amount_check;
alter table vyndi_invoices add constraint vyndi_invoices_tax_amount_check
  check (taxable_value_inr>=0 and tax_rate_pct>=0 and cgst_inr>=0 and sgst_inr>=0 and igst_inr>=0 and cess_inr>=0 and gst_inr>=0 and gross_amount_inr>=0);
create index if not exists vyndi_invoices_tax_readiness_idx
  on vyndi_invoices(status,tax_profile_status,issued_at);

alter table epr_finance_gst_ledger add column if not exists document_date date;
alter table epr_finance_gst_ledger add column if not exists document_number text;
alter table epr_finance_gst_ledger add column if not exists counterparty_gstin text;
alter table epr_finance_gst_ledger add column if not exists place_of_supply_code text;
alter table epr_finance_gst_ledger add column if not exists hsn_sac text;
alter table epr_finance_gst_ledger add column if not exists tax_rate_pct numeric(8,4) not null default 0;
alter table epr_finance_gst_ledger add column if not exists cgst_inr numeric(18,2) not null default 0;
alter table epr_finance_gst_ledger add column if not exists sgst_inr numeric(18,2) not null default 0;
alter table epr_finance_gst_ledger add column if not exists igst_inr numeric(18,2) not null default 0;
alter table epr_finance_gst_ledger add column if not exists cess_inr numeric(18,2) not null default 0;
alter table epr_finance_gst_ledger add column if not exists irn text;
alter table epr_finance_gst_ledger add column if not exists status text not null default 'active';
alter table epr_finance_gst_ledger add column if not exists reversal_reference text;
alter table epr_finance_gst_ledger drop constraint if exists epr_finance_gst_ledger_status_check;
alter table epr_finance_gst_ledger add constraint epr_finance_gst_ledger_status_check check (status in ('active','reversed'));

alter table epr_finance_bank_statement_lines add column if not exists matched_by text;
alter table epr_finance_bank_statement_lines add column if not exists match_reference text;
alter table epr_finance_bank_statement_lines add column if not exists unmatched_by text;
alter table epr_finance_bank_statement_lines add column if not exists unmatched_at timestamptz;
alter table epr_finance_bank_statement_lines add column if not exists unmatch_reason text;

create table if not exists epr_finance_bank_match_audit (
  id bigserial primary key,
  statement_line_id text not null references epr_finance_bank_statement_lines(id) on delete restrict,
  journal_id text not null references epr_finance_journals(id) on delete restrict,
  action text not null check (action in ('matched','unmatched')),
  reason text,
  actor_user_id text not null,
  occurred_at timestamptz not null default now()
);
create index if not exists epr_finance_bank_match_audit_line_idx on epr_finance_bank_match_audit(statement_line_id,occurred_at desc);

create table if not exists epr_finance_bank_reconciliation_sessions (
  id text primary key,
  bank_account_ref text not null,
  period text not null,
  opening_balance_inr numeric(18,2) not null,
  closing_balance_inr numeric(18,2) not null,
  statement_movement_inr numeric(18,2) not null,
  book_movement_inr numeric(18,2) not null,
  difference_inr numeric(18,2) not null,
  status text not null default 'reconciled' check (status in ('draft','reconciled','void')),
  evidence_reference text not null,
  prepared_by text not null,
  prepared_at timestamptz not null default now(),
  approved_by text,
  approved_at timestamptz,
  unique(bank_account_ref,period,status)
);

create table if not exists epr_finance_period_closures (
  period text primary key,
  status text not null default 'open' check (status in ('open','soft_closed','hard_closed')),
  evidence_reference text not null,
  updated_by text not null,
  updated_at timestamptz not null default now()
);

create table if not exists epr_finance_period_close_events (
  id bigserial primary key,
  period text not null,
  from_status text,
  to_status text not null,
  evidence_reference text not null,
  actor_user_id text not null,
  occurred_at timestamptz not null default now()
);
create index if not exists epr_finance_period_close_events_period_idx on epr_finance_period_close_events(period,occurred_at desc);

create table if not exists epr_finance_ca_evidence_packs (
  id text primary key,
  period text not null,
  status text not null check (status in ('draft','review_ready','approved')),
  blocker_count integer not null default 0,
  summary_json jsonb not null default '{}'::jsonb,
  evidence_reference text not null,
  generated_by text not null,
  generated_at timestamptz not null default now(),
  approved_by text,
  approved_at timestamptz
);
create index if not exists epr_finance_ca_evidence_packs_period_idx on epr_finance_ca_evidence_packs(period,generated_at desc);

create or replace function enforce_vyndi_finance_period_lock() returns trigger
language plpgsql as $$
declare v_period text;
begin
  v_period:=to_char(new.entry_date,'YYYY-MM');
  if exists(select 1 from epr_finance_period_closures where period=v_period and status='hard_closed') then
    raise exception 'Finance period % is hard closed. Post corrections in an open period with explicit reversal evidence.',v_period;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_vyndi_finance_period_lock on epr_finance_journals;
create trigger trg_vyndi_finance_period_lock
before insert or update of entry_date,status on epr_finance_journals
for each row execute function enforce_vyndi_finance_period_lock();

create or replace function protect_vyndi_posted_journal() returns trigger
language plpgsql as $$
begin
  if old.status='posted' then
    raise exception 'Posted finance journals are immutable. Use a linked reversal journal.';
  end if;
  return case when tg_op='DELETE' then old else new end;
end;
$$;
drop trigger if exists trg_vyndi_protect_posted_journal on epr_finance_journals;
create trigger trg_vyndi_protect_posted_journal
before update or delete on epr_finance_journals
for each row execute function protect_vyndi_posted_journal();

create or replace function protect_vyndi_posted_journal_line() returns trigger
language plpgsql as $$
begin
  if exists(select 1 from epr_finance_journals where id=old.journal_id and status='posted') then
    raise exception 'Lines of a posted finance journal are immutable. Use a linked reversal journal.';
  end if;
  return case when tg_op='DELETE' then old else new end;
end;
$$;
drop trigger if exists trg_vyndi_protect_posted_journal_line on epr_finance_journal_lines;
create trigger trg_vyndi_protect_posted_journal_line
before update or delete on epr_finance_journal_lines
for each row execute function protect_vyndi_posted_journal_line();

create or replace function issue_vyndi_tax_invoice(
  p_id text,p_shipment_id text,p_source_reference text,
  p_recipient_name text,p_recipient_gstin text,p_recipient_address text,p_delivery_address text,
  p_place_of_supply_code text,p_hsn_sac text,p_item_description text,p_unit_code text,
  p_tax_rate_pct numeric,p_tax_mode text,p_reverse_charge boolean,p_e_invoice_required boolean,
  p_irn text,p_irn_ack_number text,p_irn_ack_at timestamptz,p_tax_evidence_reference text,
  p_actor_user_id text,p_actor_role text
) returns table(invoice_id text, amount_lakh numeric, gross_amount_inr numeric)
language plpgsql
as $$
declare
  v_order text; v_month integer; v_units numeric; v_asp numeric; v_amount numeric;
  v_taxable numeric; v_cgst numeric:=0; v_sgst numeric:=0; v_igst numeric:=0; v_gst numeric:=0; v_gross numeric;
  v_snapshot jsonb; v_supplier record;
begin
  if trim(coalesce(p_source_reference,''))='' then raise exception 'Invoice source reference is required.'; end if;
  if trim(coalesce(p_recipient_name,''))='' then raise exception 'Invoice recipient name is required.'; end if;
  if trim(coalesce(p_recipient_address,''))='' then raise exception 'Invoice recipient address is required.'; end if;
  if trim(coalesce(p_delivery_address,''))='' then raise exception 'Invoice delivery address is required.'; end if;
  if trim(coalesce(p_place_of_supply_code,'')) !~ '^[0-9]{2}$' then raise exception 'Place of supply must be a two-digit State code.'; end if;
  if trim(coalesce(p_hsn_sac,''))='' then raise exception 'HSN/SAC is required.'; end if;
  if trim(coalesce(p_item_description,''))='' then raise exception 'Invoice item description is required.'; end if;
  if p_tax_mode not in ('cgst_sgst','igst','zero_rated','exempt') then raise exception 'Controlled GST tax mode is required.'; end if;
  if p_tax_rate_pct<0 then raise exception 'GST rate cannot be negative.'; end if;
  if p_tax_mode in ('zero_rated','exempt') and p_tax_rate_pct<>0 then raise exception 'Zero-rated/exempt invoice must use zero tax rate.'; end if;
  if p_e_invoice_required and (trim(coalesce(p_irn,''))='' or trim(coalesce(p_irn_ack_number,''))='' or p_irn_ack_at is null) then
    raise exception 'IRN, acknowledgement number and acknowledgement timestamp are required when e-invoice is marked applicable.';
  end if;
  if trim(coalesce(p_tax_evidence_reference,''))='' then raise exception 'Tax evidence reference is required.'; end if;

  select * into v_supplier from epr_finance_tax_registration where id='PRIMARY';
  if not found then raise exception 'Primary GST registration/tax profile must be configured before issuing a controlled tax invoice.'; end if;

  perform pg_advisory_xact_lock(hashtext('invoice|' || p_id)::bigint);
  if exists(select 1 from vyndi_invoices where id=p_id) then
    return query select i.id,i.amount_lakh,i.gross_amount_inr from vyndi_invoices i
      where i.id=p_id and i.shipment_id=p_shipment_id and i.status='issued' and i.tax_profile_status='complete';
    if found then return; end if;
    raise exception 'Invoice id already exists with different state.';
  end if;

  select s.sales_order_id,s.plan_month,s.units,o.asp_lakh into v_order,v_month,v_units,v_asp
    from vyndi_shipments s join vyndi_sales_orders o on o.id=s.sales_order_id
   where s.id=p_shipment_id and s.status='posted';
  if not found then raise exception 'Posted shipment not found.'; end if;
  if exists(select 1 from vyndi_invoices where shipment_id=p_shipment_id) then raise exception 'Shipment already has an invoice record.'; end if;

  v_amount:=round(v_units*v_asp,4);
  v_taxable:=round(v_amount*100000,2);
  if p_tax_mode='cgst_sgst' then
    v_cgst:=round(v_taxable*p_tax_rate_pct/200,2);
    v_sgst:=round(v_taxable*p_tax_rate_pct/200,2);
  elsif p_tax_mode='igst' then
    v_igst:=round(v_taxable*p_tax_rate_pct/100,2);
  end if;
  v_gst:=v_cgst+v_sgst+v_igst;
  v_gross:=round(v_taxable+v_gst,2);

  insert into vyndi_invoices(
    id,shipment_id,sales_order_id,plan_month,units,asp_lakh,amount_lakh,status,source_reference,issued_by,
    recipient_name,recipient_gstin,recipient_address,delivery_address,place_of_supply_code,hsn_sac,item_description,unit_code,
    taxable_value_inr,tax_rate_pct,tax_mode,cgst_inr,sgst_inr,igst_inr,gst_inr,gross_amount_inr,reverse_charge,
    e_invoice_required,irn,irn_ack_number,irn_ack_at,tax_evidence_reference,tax_profile_status)
  values(
    p_id,p_shipment_id,v_order,v_month,v_units,v_asp,v_amount,'issued',p_source_reference,p_actor_user_id,
    p_recipient_name,nullif(trim(coalesce(p_recipient_gstin,'')),''),p_recipient_address,p_delivery_address,p_place_of_supply_code,p_hsn_sac,p_item_description,coalesce(nullif(trim(p_unit_code),''),'NOS'),
    v_taxable,p_tax_rate_pct,p_tax_mode,v_cgst,v_sgst,v_igst,v_gst,v_gross,p_reverse_charge,
    p_e_invoice_required,nullif(trim(coalesce(p_irn,'')),''),nullif(trim(coalesce(p_irn_ack_number,'')),''),p_irn_ack_at,p_tax_evidence_reference,'complete');

  v_snapshot:=jsonb_build_object(
    'invoiceId',p_id,'shipmentId',p_shipment_id,'salesOrderId',v_order,'planMonth',v_month,'units',v_units,
    'amountLakh',v_amount,'taxableValueInr',v_taxable,'gstInr',v_gst,'grossAmountInr',v_gross,
    'taxMode',p_tax_mode,'taxRatePct',p_tax_rate_pct,'recipientGstin',p_recipient_gstin,'placeOfSupplyCode',p_place_of_supply_code,
    'hsnSac',p_hsn_sac,'eInvoiceRequired',p_e_invoice_required,'irn',p_irn);
  insert into vyndi_audit_events(id,entity_type,entity_id,entity_revision,action,actor_user_id,actor_role,source_reference,payload_json)
  values('AUD-INV-'||p_id||'-R1','invoice',p_id,1,'issued',p_actor_user_id,p_actor_role,p_source_reference,v_snapshot);
  return query select p_id,v_amount,v_gross;
end;
$$;

create or replace function post_vyndi_collection(
  p_id text,p_invoice_id text,p_plan_month integer,p_amount_lakh numeric,p_source_reference text,
  p_actor_user_id text,p_actor_role text
) returns text
language plpgsql
as $$
declare v_invoice_amount numeric; v_collected numeric; v_snapshot jsonb;
begin
  if trim(coalesce(p_source_reference,''))='' then raise exception 'Collection source reference is required.'; end if;
  perform pg_advisory_xact_lock(hashtext('collection|' || p_id)::bigint);
  if exists(select 1 from vyndi_collections where id=p_id) then
    if exists(select 1 from vyndi_collections where id=p_id and invoice_id=p_invoice_id and plan_month=p_plan_month and amount_lakh=p_amount_lakh and status='posted') then return p_id; end if;
    raise exception 'Collection id already exists with different state.';
  end if;
  select case when gross_amount_inr>0 then gross_amount_inr/100000 else amount_lakh end into v_invoice_amount
    from vyndi_invoices where id=p_invoice_id and status='issued';
  if not found then raise exception 'Issued invoice not found.'; end if;
  select coalesce(sum(amount_lakh),0) into v_collected from vyndi_collections where invoice_id=p_invoice_id and status='posted';
  if p_amount_lakh<=0 or v_collected+p_amount_lakh>v_invoice_amount+0.000001 then raise exception 'Collection exceeds open gross invoice receivable.'; end if;
  insert into vyndi_collections(id,invoice_id,plan_month,amount_lakh,source_reference,posted_by)
  values(p_id,p_invoice_id,p_plan_month,p_amount_lakh,p_source_reference,p_actor_user_id);
  v_snapshot:=jsonb_build_object('collectionId',p_id,'invoiceId',p_invoice_id,'planMonth',p_plan_month,'amountLakh',p_amount_lakh);
  insert into vyndi_audit_events(id,entity_type,entity_id,entity_revision,action,actor_user_id,actor_role,source_reference,payload_json)
  values('AUD-COL-'||p_id||'-R1','collection',p_id,1,'posted',p_actor_user_id,p_actor_role,p_source_reference,v_snapshot);
  return p_id;
end;
$$;

create or replace function vyndi_finance_customer_invoice_trigger() returns trigger
language plpgsql as $$
declare v_taxable numeric; v_gst numeric; v_gross numeric; v_lines jsonb;
begin
  if new.status='issued' and new.tax_profile_status='complete' and
     (tg_op='INSERT' or old.status is distinct from 'issued' or old.tax_profile_status is distinct from 'complete') then
    v_taxable:=round(coalesce(new.taxable_value_inr,new.amount_lakh*100000),2);
    v_gst:=round(coalesce(new.gst_inr,0),2);
    v_gross:=round(case when coalesce(new.gross_amount_inr,0)>0 then new.gross_amount_inr else v_taxable+v_gst end,2);
    if v_gst>0 then
      v_lines:=jsonb_build_array(
        jsonb_build_object('accountCode','1100','debitInr',v_gross,'memo','Gross trade receivable'),
        jsonb_build_object('accountCode','4000','creditInr',v_taxable,'memo','Taxable product revenue'),
        jsonb_build_object('accountCode','2100','creditInr',v_gst,'memo','Output GST payable'));
    else
      v_lines:=jsonb_build_array(
        jsonb_build_object('accountCode','1100','debitInr',v_gross,'memo','Trade receivable'),
        jsonb_build_object('accountCode','4000','creditInr',v_taxable,'memo','Product revenue'));
    end if;
    perform post_vyndi_finance_journal('FIN-AR-'||new.id,new.issued_at::date,'sales_invoice',new.id,
      'Customer tax invoice '||new.id,v_lines);
    if v_gst>0 then
      insert into epr_finance_gst_ledger(
        id,period,direction,source_type,source_id,taxable_value_inr,gst_inr,eligible_itc,evidence_reference,
        document_date,document_number,counterparty_gstin,place_of_supply_code,hsn_sac,tax_rate_pct,
        cgst_inr,sgst_inr,igst_inr,cess_inr,irn,status)
      values(
        'GST-OUT-'||new.id,to_char(new.issued_at,'YYYY-MM'),'output','sales_invoice',new.id,v_taxable,v_gst,null,new.tax_evidence_reference,
        new.issued_at::date,new.id,new.recipient_gstin,new.place_of_supply_code,new.hsn_sac,new.tax_rate_pct,
        new.cgst_inr,new.sgst_inr,new.igst_inr,new.cess_inr,new.irn,'active')
      on conflict (source_type,source_id,direction) do nothing;
    end if;
  elsif new.status='issued' and new.tax_profile_status<>'complete' and
        (tg_op='INSERT' or old.status is distinct from 'issued') then
    insert into epr_finance_posting_exceptions(id,source_type,source_id,severity,message)
    values('FIN-EX-TAX-'||new.id,'sales_invoice',new.id,'critical',
      'Issued customer invoice is missing a controlled GST/tax profile. AR/revenue posting is blocked until reconciled.')
    on conflict do nothing;
  elsif tg_op='UPDATE' and new.status='void' and old.status='issued' then
    perform reverse_vyndi_finance_journal('sales_invoice',new.id,'FIN-AR-REV-'||new.id,
      'sales_invoice_reversal',coalesce(new.voided_at::date,current_date),'Customer invoice reversal '||new.id);
    update epr_finance_gst_ledger set status='reversed',reversal_reference=coalesce(new.void_reason,'Invoice void')
      where source_type='sales_invoice' and source_id=new.id and direction='output' and status='active';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_vyndi_finance_customer_invoice on vyndi_invoices;
create trigger trg_vyndi_finance_customer_invoice
after insert or update of status,tax_profile_status on vyndi_invoices
for each row execute function vyndi_finance_customer_invoice_trigger();

create or replace view vyndi_monthly_transaction_actuals as
with months as (select generate_series(1,36)::integer as plan_month),
invoice_month as (
  select plan_month,sum(amount_lakh)::numeric(18,4) revenue,sum(units)::numeric(14,4) units
    from vyndi_invoices where status='issued' group by plan_month
),
invoice_cume as (
  select m.plan_month,coalesce((select sum(case when i.gross_amount_inr>0 then i.gross_amount_inr/100000 else i.amount_lakh end)
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

create or replace view epr_finance_gst_period_summary as
select period,
  round(coalesce(sum(taxable_value_inr) filter(where direction='output' and status='active'),0),2) as output_taxable_inr,
  round(coalesce(sum(gst_inr) filter(where direction='output' and status='active'),0),2) as output_gst_inr,
  round(coalesce(sum(taxable_value_inr) filter(where direction='input' and status='active'),0),2) as input_taxable_inr,
  round(coalesce(sum(gst_inr) filter(where direction='input' and status='active' and eligible_itc=true),0),2) as eligible_input_gst_inr,
  round(coalesce(sum(gst_inr) filter(where direction='input' and status='active' and eligible_itc=false),0),2) as ineligible_input_gst_inr,
  round(coalesce(sum(gst_inr) filter(where direction='output' and status='active'),0)-
        coalesce(sum(gst_inr) filter(where direction='input' and status='active' and eligible_itc=true),0),2) as net_gst_payable_inr,
  count(*) filter(where status='active' and gst_inr>0 and trim(coalesce(evidence_reference,''))='')::int as missing_evidence_count
from epr_finance_gst_ledger
group by period order by period desc;

create or replace view epr_finance_ca_readiness as
select
  (select count(*) from epr_finance_posting_exceptions where resolved=false)::int as open_posting_exceptions,
  (select count(*) from epr_finance_bank_statement_lines where matched_journal_id is null)::int as unmatched_bank_lines,
  (select count(*) from epr_finance_gst_ledger where status='active' and gst_inr>0 and trim(coalesce(evidence_reference,''))='')::int as gst_evidence_exceptions,
  (select count(*) from vyndi_invoices where status='issued' and tax_profile_status<>'complete')::int as pending_invoice_tax_profiles,
  (select count(*) from vyndi_invoices where status='issued' and e_invoice_required=true and trim(coalesce(irn,''))='')::int as missing_irn_count,
  (select count(*) from epr_finance_fixed_assets where status<>'disposed' and trim(coalesce(source_reference,''))='')::int as asset_evidence_exceptions,
  (select count(*) from epr_finance_payroll_controls where trim(coalesce(payment_reference,''))='' or (statutory_payable_inr>0 and trim(coalesce(return_evidence_reference,''))=''))::int as payroll_evidence_exceptions,
  abs(coalesce((select sum(debit_inr-credit_inr) from epr_finance_journal_lines l join epr_finance_journals j on j.id=l.journal_id where j.status='posted'),0))::numeric(18,2) as trial_balance_difference_inr;

create or replace view epr_finance_control_summary as
select
  (select count(*) from epr_finance_journals where status='posted')::int as posted_journals,
  (select count(*) from epr_finance_posting_exceptions where resolved=false)::int as open_posting_exceptions,
  (select count(*) from epr_finance_bank_statement_lines where matched_journal_id is null)::int as unmatched_bank_lines,
  (select count(*) from epr_finance_gst_ledger where status='active' and gst_inr>0 and trim(coalesce(evidence_reference,''))='')::int as gst_evidence_exceptions,
  (select count(*) from vyndi_invoices where status='issued' and tax_profile_status<>'complete')::int as pending_invoice_tax_profiles,
  (select count(*) from vyndi_invoices where status='issued' and e_invoice_required=true and trim(coalesce(irn,''))='')::int as missing_irn_count,
  (select count(*) from epr_finance_fixed_assets where status<>'disposed' and trim(coalesce(source_reference,''))='')::int as asset_evidence_exceptions,
  (select count(*) from epr_finance_payroll_controls where trim(coalesce(payment_reference,''))='' or (statutory_payable_inr>0 and trim(coalesce(return_evidence_reference,''))=''))::int as payroll_evidence_exceptions,
  (select count(*) from epr_finance_period_closures where status='hard_closed')::int as hard_closed_periods,
  (select count(*) from epr_finance_ca_evidence_packs where status in ('review_ready','approved'))::int as ca_review_ready_packs;

comment on table epr_finance_tax_registration is 'Controlled supplier GST/tax identity used by VYNDI tax-invoice issuance. Regulatory applicability remains configuration plus CA review.';
comment on table epr_finance_period_closures is 'Current finance period status. Every status transition is separately appended to epr_finance_period_close_events.';
comment on table epr_finance_ca_evidence_packs is 'Point-in-time accounting/control evidence summary for CA review; not a filing or certification.';
