-- VYNDI input-GST / ITC hardening.
-- Source-reference presence alone is not ITC eligibility. GST credit requires an explicit
-- governed decision and evidence; otherwise the tax remains part of inventory/cost.

alter table vyndi_supplier_invoices add column if not exists supplier_gstin text;
alter table vyndi_supplier_invoices add column if not exists hsn_sac text;
alter table vyndi_supplier_invoices add column if not exists tax_rate_pct numeric(8,4) not null default 0;
alter table vyndi_supplier_invoices add column if not exists cgst_inr numeric(18,2) not null default 0;
alter table vyndi_supplier_invoices add column if not exists sgst_inr numeric(18,2) not null default 0;
alter table vyndi_supplier_invoices add column if not exists igst_inr numeric(18,2) not null default 0;
alter table vyndi_supplier_invoices add column if not exists cess_inr numeric(18,2) not null default 0;
alter table vyndi_supplier_invoices add column if not exists itc_eligible boolean;
alter table vyndi_supplier_invoices add column if not exists itc_control_status text not null default 'pending';
alter table vyndi_supplier_invoices add column if not exists itc_evidence_reference text;
alter table vyndi_supplier_invoices add column if not exists gstr2b_reference text;
alter table vyndi_supplier_invoices drop constraint if exists vyndi_supplier_invoices_itc_status_check;
alter table vyndi_supplier_invoices add constraint vyndi_supplier_invoices_itc_status_check
  check (itc_control_status in ('pending','verified','ineligible'));
alter table vyndi_supplier_invoices drop constraint if exists vyndi_supplier_invoices_itc_amount_check;
alter table vyndi_supplier_invoices add constraint vyndi_supplier_invoices_itc_amount_check
  check (tax_rate_pct>=0 and cgst_inr>=0 and sgst_inr>=0 and igst_inr>=0 and cess_inr>=0);
create index if not exists vyndi_supplier_invoices_itc_idx
  on vyndi_supplier_invoices(status,itc_control_status,invoice_on);

-- Historical records produced before this control cannot be assumed eligible merely because
-- they had a document reference. Mark the GST ledger eligibility unknown until reconciled.
update epr_finance_gst_ledger g
   set eligible_itc=null
 where g.direction='input' and g.source_type='supplier_invoice'
   and exists(select 1 from vyndi_supplier_invoices i where i.id=g.source_id and i.itc_control_status='pending');

create or replace function set_vyndi_supplier_invoice_itc_profile(
  p_id text,
  p_supplier_gstin text,
  p_hsn_sac text,
  p_tax_rate_pct numeric,
  p_cgst_inr numeric,
  p_sgst_inr numeric,
  p_igst_inr numeric,
  p_cess_inr numeric,
  p_itc_eligible boolean,
  p_itc_evidence_reference text,
  p_gstr2b_reference text,
  p_actor_user_id text,
  p_actor_role text
) returns text
language plpgsql
as $$
declare v_status text; v_control text; v_snapshot jsonb;
begin
  perform pg_advisory_xact_lock(hashtext('supplier-itc|'||p_id)::bigint);
  select status into v_status from vyndi_supplier_invoices where id=p_id;
  if not found then raise exception 'Supplier invoice not found.'; end if;
  if v_status not in ('matched','blocked') then
    raise exception 'ITC profile must be governed before supplier invoice approval.';
  end if;
  if p_tax_rate_pct<0 or p_cgst_inr<0 or p_sgst_inr<0 or p_igst_inr<0 or p_cess_inr<0 then
    raise exception 'Supplier tax values cannot be negative.';
  end if;
  if p_itc_eligible and trim(coalesce(p_itc_evidence_reference,''))='' then
    raise exception 'Eligible ITC requires explicit evidence reference.';
  end if;
  v_control:=case when p_itc_eligible then 'verified' else 'ineligible' end;
  update vyndi_supplier_invoices
     set supplier_gstin=nullif(trim(coalesce(p_supplier_gstin,'')),''),
         hsn_sac=nullif(trim(coalesce(p_hsn_sac,'')),''),
         tax_rate_pct=p_tax_rate_pct,
         cgst_inr=p_cgst_inr,
         sgst_inr=p_sgst_inr,
         igst_inr=p_igst_inr,
         cess_inr=p_cess_inr,
         itc_eligible=p_itc_eligible,
         itc_control_status=v_control,
         itc_evidence_reference=nullif(trim(coalesce(p_itc_evidence_reference,'')),''),
         gstr2b_reference=nullif(trim(coalesce(p_gstr2b_reference,'')),''),
         updated_at=now()
   where id=p_id;
  v_snapshot:=jsonb_build_object('supplierInvoiceId',p_id,'itcEligible',p_itc_eligible,
    'itcControlStatus',v_control,'supplierGstin',p_supplier_gstin,'hsnSac',p_hsn_sac,
    'taxRatePct',p_tax_rate_pct,'cgstInr',p_cgst_inr,'sgstInr',p_sgst_inr,
    'igstInr',p_igst_inr,'cessInr',p_cess_inr,'gstr2bReference',p_gstr2b_reference);
  insert into vyndi_audit_events(id,entity_type,entity_id,entity_revision,action,actor_user_id,actor_role,source_reference,payload_json)
  values('AUD-ITC-'||p_id||'-'||extract(epoch from clock_timestamp())::bigint,
    'supplier_invoice_itc',p_id,1,'classified',p_actor_user_id,p_actor_role,
    nullif(trim(coalesce(p_itc_evidence_reference,'')),''),v_snapshot);
  return p_id;
end;
$$;

create or replace function enforce_vyndi_supplier_itc_before_approval() returns trigger
language plpgsql as $$
begin
  if new.status in ('approved','part_paid','paid') and (tg_op='INSERT' or old.status not in ('approved','part_paid','paid'))
     and new.gst_inr>0 and new.itc_control_status='pending' then
    raise exception 'Supplier invoice GST requires explicit ITC classification before approval.';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_vyndi_supplier_itc_before_approval on vyndi_supplier_invoices;
create trigger trg_vyndi_supplier_itc_before_approval
before insert or update of status on vyndi_supplier_invoices
for each row execute function enforce_vyndi_supplier_itc_before_approval();

create or replace function vyndi_finance_supplier_invoice_trigger() returns trigger
language plpgsql as $$
declare v_total numeric; v_inventory_debit numeric; v_lines jsonb; v_eligible boolean;
begin
  if new.status in ('approved','part_paid','paid') and
     (tg_op='INSERT' or old.status not in ('approved','part_paid','paid')) then
    v_total:=round(new.amount_ex_gst_inr+new.gst_inr,2);
    v_eligible:=new.gst_inr>0 and new.itc_control_status='verified' and new.itc_eligible is true
      and trim(coalesce(new.itc_evidence_reference,''))<>'';
    if v_eligible then
      v_inventory_debit:=new.amount_ex_gst_inr;
      v_lines:=jsonb_build_array(
        jsonb_build_object('accountCode','1200','debitInr',v_inventory_debit,'memo','Supplier invoice inventory value'),
        jsonb_build_object('accountCode','1300','debitInr',new.gst_inr,'memo','Verified eligible input GST / ITC'),
        jsonb_build_object('accountCode','2000','creditInr',v_total,'memo','Trade payable'));
    else
      v_inventory_debit:=v_total;
      v_lines:=jsonb_build_array(
        jsonb_build_object('accountCode','1200','debitInr',v_inventory_debit,'memo','Inventory value including ineligible/non-creditable GST'),
        jsonb_build_object('accountCode','2000','creditInr',v_total,'memo','Trade payable'));
    end if;
    perform post_vyndi_finance_journal('FIN-AP-'||new.id,new.invoice_on,'supplier_invoice',new.id,
      'Supplier invoice '||new.invoice_number,v_lines);
    if new.gst_inr>0 then
      insert into epr_finance_gst_ledger(
        id,period,direction,source_type,source_id,taxable_value_inr,gst_inr,eligible_itc,evidence_reference,
        document_date,document_number,counterparty_gstin,hsn_sac,tax_rate_pct,cgst_inr,sgst_inr,igst_inr,cess_inr,status)
      values(
        'GST-IN-'||new.id,to_char(new.invoice_on,'YYYY-MM'),'input','supplier_invoice',new.id,
        new.amount_ex_gst_inr,new.gst_inr,case when new.itc_control_status='verified' then true when new.itc_control_status='ineligible' then false else null end,
        coalesce(new.itc_evidence_reference,new.source_reference),new.invoice_on,new.invoice_number,new.supplier_gstin,new.hsn_sac,
        new.tax_rate_pct,new.cgst_inr,new.sgst_inr,new.igst_inr,new.cess_inr,'active')
      on conflict (source_type,source_id,direction) do update set
        eligible_itc=excluded.eligible_itc,evidence_reference=excluded.evidence_reference,
        counterparty_gstin=excluded.counterparty_gstin,hsn_sac=excluded.hsn_sac,tax_rate_pct=excluded.tax_rate_pct,
        cgst_inr=excluded.cgst_inr,sgst_inr=excluded.sgst_inr,igst_inr=excluded.igst_inr,cess_inr=excluded.cess_inr,status='active';
    end if;
  elsif tg_op='UPDATE' and new.status='void' and old.status<>'void' then
    perform reverse_vyndi_finance_journal('supplier_invoice',new.id,'FIN-AP-REV-'||new.id,
      'supplier_invoice_reversal',coalesce(new.updated_at::date,current_date),'Supplier invoice reversal '||new.invoice_number);
    update epr_finance_gst_ledger set status='reversed',reversal_reference=coalesce(new.match_message,'Supplier invoice void')
      where source_type='supplier_invoice' and source_id=new.id and direction='input' and status='active';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_vyndi_finance_supplier_invoice on vyndi_supplier_invoices;
create trigger trg_vyndi_finance_supplier_invoice
after insert or update of status on vyndi_supplier_invoices
for each row execute function vyndi_finance_supplier_invoice_trigger();

create or replace view epr_finance_gst_period_summary as
select period,
  round(coalesce(sum(taxable_value_inr) filter(where direction='output' and status='active'),0),2) as output_taxable_inr,
  round(coalesce(sum(gst_inr) filter(where direction='output' and status='active'),0),2) as output_gst_inr,
  round(coalesce(sum(taxable_value_inr) filter(where direction='input' and status='active'),0),2) as input_taxable_inr,
  round(coalesce(sum(gst_inr) filter(where direction='input' and status='active' and eligible_itc=true),0),2) as eligible_input_gst_inr,
  round(coalesce(sum(gst_inr) filter(where direction='input' and status='active' and eligible_itc=false),0),2) as ineligible_input_gst_inr,
  round(coalesce(sum(gst_inr) filter(where direction='output' and status='active'),0)-
        coalesce(sum(gst_inr) filter(where direction='input' and status='active' and eligible_itc=true),0),2) as net_gst_payable_inr,
  count(*) filter(where direction='input' and status='active' and gst_inr>0 and eligible_itc is null)::int as unverified_input_itc_count,
  count(*) filter(where status='active' and gst_inr>0 and trim(coalesce(evidence_reference,''))='')::int as missing_evidence_count
from epr_finance_gst_ledger
group by period order by period desc;

create or replace view epr_finance_ca_readiness as
select
  (select count(*) from epr_finance_posting_exceptions where resolved=false)::int as open_posting_exceptions,
  (select count(*) from epr_finance_bank_statement_lines where matched_journal_id is null)::int as unmatched_bank_lines,
  (select count(*) from epr_finance_gst_ledger where status='active' and gst_inr>0 and trim(coalesce(evidence_reference,''))='')::int as gst_evidence_exceptions,
  (select count(*) from epr_finance_gst_ledger where status='active' and direction='input' and gst_inr>0 and eligible_itc is null)::int as unverified_input_itc,
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
  (select count(*) from epr_finance_gst_ledger where status='active' and direction='input' and gst_inr>0 and eligible_itc is null)::int as unverified_input_itc,
  (select count(*) from vyndi_invoices where status='issued' and tax_profile_status<>'complete')::int as pending_invoice_tax_profiles,
  (select count(*) from vyndi_invoices where status='issued' and e_invoice_required=true and trim(coalesce(irn,''))='')::int as missing_irn_count,
  (select count(*) from epr_finance_fixed_assets where status<>'disposed' and trim(coalesce(source_reference,''))='')::int as asset_evidence_exceptions,
  (select count(*) from epr_finance_payroll_controls where trim(coalesce(payment_reference,''))='' or (statutory_payable_inr>0 and trim(coalesce(return_evidence_reference,''))=''))::int as payroll_evidence_exceptions,
  (select count(*) from epr_finance_period_closures where status='hard_closed')::int as hard_closed_periods,
  (select count(*) from epr_finance_ca_evidence_packs where status in ('review_ready','approved'))::int as ca_review_ready_packs;
