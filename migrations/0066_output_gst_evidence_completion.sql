-- Preserve all controlled output-tax documents in the GST evidence ledger, including
-- zero-rated and exempt supplies whose tax amount is zero.

alter table epr_finance_gst_ledger add column if not exists tax_treatment text;

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

    insert into epr_finance_gst_ledger(
      id,period,direction,source_type,source_id,taxable_value_inr,gst_inr,eligible_itc,evidence_reference,
      document_date,document_number,counterparty_gstin,place_of_supply_code,hsn_sac,tax_rate_pct,
      cgst_inr,sgst_inr,igst_inr,cess_inr,irn,status,tax_treatment)
    values(
      'GST-OUT-'||new.id,to_char(new.issued_at,'YYYY-MM'),'output','sales_invoice',new.id,v_taxable,v_gst,null,new.tax_evidence_reference,
      new.issued_at::date,new.id,new.recipient_gstin,new.place_of_supply_code,new.hsn_sac,new.tax_rate_pct,
      new.cgst_inr,new.sgst_inr,new.igst_inr,new.cess_inr,new.irn,'active',new.tax_mode)
    on conflict (source_type,source_id,direction) do update set
      taxable_value_inr=excluded.taxable_value_inr,gst_inr=excluded.gst_inr,evidence_reference=excluded.evidence_reference,
      counterparty_gstin=excluded.counterparty_gstin,place_of_supply_code=excluded.place_of_supply_code,
      hsn_sac=excluded.hsn_sac,tax_rate_pct=excluded.tax_rate_pct,cgst_inr=excluded.cgst_inr,
      sgst_inr=excluded.sgst_inr,igst_inr=excluded.igst_inr,cess_inr=excluded.cess_inr,
      irn=excluded.irn,status='active',tax_treatment=excluded.tax_treatment;
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
  count(*) filter(where status='active' and
    ((direction='output' and taxable_value_inr>0) or (direction='input' and gst_inr>0)) and
    trim(coalesce(evidence_reference,''))='')::int as missing_evidence_count
from epr_finance_gst_ledger
group by period order by period desc;

comment on column epr_finance_gst_ledger.tax_treatment is
  'Controlled tax treatment such as cgst_sgst, igst, zero_rated or exempt for output documents.';
