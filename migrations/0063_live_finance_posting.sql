-- VYNDI live finance posting integration.
-- Operational authorities remain the source of truth; this layer derives accounting actuals.

create table if not exists epr_finance_posting_exceptions (
  id text primary key,
  source_type text not null,
  source_id text not null,
  severity text not null default 'high' check (severity in ('critical','high','medium','low')),
  message text not null,
  resolved boolean not null default false,
  resolved_reference text,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  unique (source_type, source_id, message)
);
create index if not exists epr_finance_posting_exceptions_open_idx
  on epr_finance_posting_exceptions (resolved, severity, created_at desc);

create or replace function post_vyndi_finance_journal(
  p_id text,
  p_entry_date date,
  p_source_type text,
  p_source_id text,
  p_description text,
  p_lines jsonb
) returns text
language plpgsql
as $$
declare
  v_debit numeric:=0;
  v_credit numeric:=0;
  v_line jsonb;
  v_no integer:=0;
  v_d numeric;
  v_c numeric;
  v_existing text;
begin
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) < 2 then
    raise exception 'Finance journal requires at least two lines.';
  end if;

  select id into v_existing
    from epr_finance_journals
   where source_type=p_source_type and source_id=p_source_id and status='posted'
   limit 1;
  if found then return v_existing; end if;

  for v_line in select value from jsonb_array_elements(p_lines)
  loop
    v_d:=greatest(coalesce((v_line->>'debitInr')::numeric,0),0);
    v_c:=greatest(coalesce((v_line->>'creditInr')::numeric,0),0);
    if (v_d>0 and v_c>0) or (v_d=0 and v_c=0) then
      raise exception 'Finance journal line must contain exactly one debit or credit amount.';
    end if;
    v_debit:=v_debit+v_d;
    v_credit:=v_credit+v_c;
  end loop;

  if abs(v_debit-v_credit)>0.01 then
    raise exception 'Finance journal is not balanced: debit %, credit %.',v_debit,v_credit;
  end if;

  insert into epr_finance_journals
    (id,entry_date,source_type,source_id,description,status,posted_at)
  values
    (p_id,p_entry_date,p_source_type,p_source_id,coalesce(p_description,''),'posted',now());

  for v_line in select value from jsonb_array_elements(p_lines)
  loop
    v_no:=v_no+1;
    insert into epr_finance_journal_lines
      (journal_id,line_no,account_code,debit_inr,credit_inr,memo)
    values
      (p_id,v_no,v_line->>'accountCode',
       greatest(coalesce((v_line->>'debitInr')::numeric,0),0),
       greatest(coalesce((v_line->>'creditInr')::numeric,0),0),
       coalesce(v_line->>'memo',''));
  end loop;

  return p_id;
end;
$$;

create or replace function reverse_vyndi_finance_journal(
  p_original_source_type text,
  p_original_source_id text,
  p_reversal_id text,
  p_reversal_source_type text,
  p_entry_date date,
  p_description text
) returns text
language plpgsql
as $$
declare v_original text; v_existing text;
begin
  select id into v_existing from epr_finance_journals
   where source_type=p_reversal_source_type and source_id=p_original_source_id and status='posted' limit 1;
  if found then return v_existing; end if;

  select id into v_original from epr_finance_journals
   where source_type=p_original_source_type and source_id=p_original_source_id and status='posted'
   order by posted_at desc limit 1;
  if not found then return null; end if;

  insert into epr_finance_journals
    (id,entry_date,source_type,source_id,description,status,posted_at,reversed_entry_id)
  values
    (p_reversal_id,p_entry_date,p_reversal_source_type,p_original_source_id,p_description,'posted',now(),v_original);

  insert into epr_finance_journal_lines(journal_id,line_no,account_code,debit_inr,credit_inr,memo)
  select p_reversal_id,line_no,account_code,credit_inr,debit_inr,'Reversal · '||memo
    from epr_finance_journal_lines where journal_id=v_original order by line_no;
  return p_reversal_id;
end;
$$;

create or replace function vyndi_finance_supplier_invoice_trigger() returns trigger
language plpgsql as $$
declare v_total numeric; v_lines jsonb;
begin
  if new.status in ('approved','part_paid','paid') and
     (tg_op='INSERT' or old.status not in ('approved','part_paid','paid')) then
    v_total:=round(new.amount_ex_gst_inr+new.gst_inr,2);
    v_lines:=jsonb_build_array(
      jsonb_build_object('accountCode','1200','debitInr',new.amount_ex_gst_inr,'memo','Supplier invoice inventory value'),
      case when new.gst_inr>0 then jsonb_build_object('accountCode','1300','debitInr',new.gst_inr,'memo','Input GST / ITC') else null end,
      jsonb_build_object('accountCode','2000','creditInr',v_total,'memo','Trade payable')
    ) - 1;
    -- jsonb array subtraction above removes null only when GST is zero by rebuilding explicitly below.
    if new.gst_inr>0 then
      v_lines:=jsonb_build_array(
        jsonb_build_object('accountCode','1200','debitInr',new.amount_ex_gst_inr,'memo','Supplier invoice inventory value'),
        jsonb_build_object('accountCode','1300','debitInr',new.gst_inr,'memo','Input GST / ITC'),
        jsonb_build_object('accountCode','2000','creditInr',v_total,'memo','Trade payable'));
    else
      v_lines:=jsonb_build_array(
        jsonb_build_object('accountCode','1200','debitInr',new.amount_ex_gst_inr,'memo','Supplier invoice inventory value'),
        jsonb_build_object('accountCode','2000','creditInr',v_total,'memo','Trade payable'));
    end if;
    perform post_vyndi_finance_journal('FIN-AP-'||new.id,new.invoice_on,'supplier_invoice',new.id,
      'Supplier invoice '||new.invoice_number,v_lines);
    if new.gst_inr>0 then
      insert into epr_finance_gst_ledger
        (id,period,direction,source_type,source_id,taxable_value_inr,gst_inr,eligible_itc,evidence_reference)
      values
        ('GST-IN-'||new.id,to_char(new.invoice_on,'YYYY-MM'),'input','supplier_invoice',new.id,
         new.amount_ex_gst_inr,new.gst_inr,trim(coalesce(new.source_reference,''))<>'',new.source_reference)
      on conflict (source_type,source_id,direction) do nothing;
    end if;
  elsif tg_op='UPDATE' and new.status='void' and old.status<>'void' then
    perform reverse_vyndi_finance_journal('supplier_invoice',new.id,'FIN-AP-REV-'||new.id,
      'supplier_invoice_reversal',coalesce(new.updated_at::date,current_date),'Supplier invoice reversal '||new.invoice_number);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_vyndi_finance_supplier_invoice on vyndi_supplier_invoices;
create trigger trg_vyndi_finance_supplier_invoice
after insert or update of status on vyndi_supplier_invoices
for each row execute function vyndi_finance_supplier_invoice_trigger();

create or replace function vyndi_finance_supplier_payment_trigger() returns trigger
language plpgsql as $$
begin
  perform post_vyndi_finance_journal('FIN-APPAY-'||new.id,new.paid_on,'supplier_payment',new.id,
    'Supplier payment '||new.id,
    jsonb_build_array(
      jsonb_build_object('accountCode','2000','debitInr',new.amount_inr,'memo','Settle supplier payable'),
      jsonb_build_object('accountCode','1000','creditInr',new.amount_inr,'memo','Bank payment')));
  return new;
end;
$$;

drop trigger if exists trg_vyndi_finance_supplier_payment on vyndi_supplier_payments;
create trigger trg_vyndi_finance_supplier_payment
after insert on vyndi_supplier_payments
for each row execute function vyndi_finance_supplier_payment_trigger();

create or replace function vyndi_finance_material_issue_trigger() returns trigger
language plpgsql as $$
begin
  if new.cogs_inr<=0 then return new; end if;
  perform post_vyndi_finance_journal('FIN-MAT-'||new.id,new.created_at::date,'material_issue',new.id,
    'FIFO material issue '||new.sku||' · traveller '||new.traveller_id,
    jsonb_build_array(
      jsonb_build_object('accountCode','1210','debitInr',new.cogs_inr,'memo','Material issued to WIP'),
      jsonb_build_object('accountCode','1200','creditInr',new.cogs_inr,'memo','Raw material inventory')));
  return new;
end;
$$;

drop trigger if exists trg_vyndi_finance_material_issue on epr_cogs_entries;
create trigger trg_vyndi_finance_material_issue
after insert on epr_cogs_entries
for each row execute function vyndi_finance_material_issue_trigger();

create or replace function vyndi_finance_job_complete_trigger() returns trigger
language plpgsql as $$
declare v_material numeric:=0; v_units numeric:=0; v_model text; v_snapshot_id text;
begin
  if new.status<>'complete' or (tg_op='UPDATE' and old.status='complete') then return new; end if;
  select coalesce(sum(c.cogs_inr),0) into v_material
    from epr_cogs_entries c
    join epr_travellers t on t.id=c.traveller_id
   where t.job_card_id=new.id;
  v_units:=greatest(coalesce(new.units,0),0);
  v_model:=coalesce(nullif(new.variant_id,''),nullif(new.product_label,''),new.product_id,'unknown');
  v_snapshot_id:='COST-'||new.id||'-COMPLETE';

  insert into epr_job_cost_snapshots
    (id,job_card_id,model,planned_quantity,completed_quantity,material_actual_inr,material_standard_inr,
     material_variance_inr,total_actual_cost_inr,unit_actual_cost_inr,finished_goods_value_inr,wip_value_inr,source_action_id)
  values
    (v_snapshot_id,new.id,v_model,v_units,v_units,v_material,v_material,0,v_material,
     case when v_units>0 then round(v_material/v_units,2) else 0 end,v_material,0,new.sales_order_id)
  on conflict (id) do nothing;

  if v_material>0 then
    perform post_vyndi_finance_journal('FIN-FG-'||new.id,current_date,'production_completion',new.id,
      'Production completion '||new.id,
      jsonb_build_array(
        jsonb_build_object('accountCode','1220','debitInr',v_material,'memo','Finished goods capitalization'),
        jsonb_build_object('accountCode','1210','creditInr',v_material,'memo','Clear WIP material cost')));
  else
    insert into epr_finance_posting_exceptions(id,source_type,source_id,severity,message)
    values('FIN-EX-JOB-'||new.id,'production_completion',new.id,'high',
      'Job completed with no governed FIFO material cost. Finished-goods valuation was not posted.')
    on conflict do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_vyndi_finance_job_complete on epr_production_job_cards;
create trigger trg_vyndi_finance_job_complete
after insert or update of status on epr_production_job_cards
for each row execute function vyndi_finance_job_complete_trigger();

create or replace function vyndi_finance_dispatch_trigger() returns trigger
language plpgsql as $$
declare v_unit_cost numeric:=0; v_cost numeric:=0;
begin
  if new.status='posted' and (tg_op='INSERT' or old.status<>'posted') then
    select coalesce(unit_actual_cost_inr,0) into v_unit_cost
      from epr_job_cost_snapshots
     where job_card_id=new.job_card_id order by captured_at desc limit 1;
    v_cost:=round(v_unit_cost*new.units,2);
    if v_cost>0 then
      perform post_vyndi_finance_journal('FIN-COGS-'||new.id,new.posted_at::date,'dispatch_cogs',new.id,
        'COGS recognition for dispatch '||new.id,
        jsonb_build_array(
          jsonb_build_object('accountCode','5000','debitInr',v_cost,'memo','Recognize dispatched product cost'),
          jsonb_build_object('accountCode','1220','creditInr',v_cost,'memo','Finished goods released')));
    else
      insert into epr_finance_posting_exceptions(id,source_type,source_id,severity,message)
      values('FIN-EX-DISPATCH-'||new.id,'dispatch_cogs',new.id,'high',
        'Dispatch posted without a governed finished-goods unit cost. COGS was not recognized.')
      on conflict do nothing;
    end if;
  elsif tg_op='UPDATE' and new.status='reversed' and old.status='posted' then
    perform reverse_vyndi_finance_journal('dispatch_cogs',new.id,'FIN-COGS-REV-'||new.id,
      'dispatch_cogs_reversal',coalesce(new.reversed_at::date,current_date),'COGS reversal for dispatch '||new.id);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_vyndi_finance_dispatch on vyndi_shipments;
create trigger trg_vyndi_finance_dispatch
after insert or update of status on vyndi_shipments
for each row execute function vyndi_finance_dispatch_trigger();

create or replace function vyndi_finance_customer_invoice_trigger() returns trigger
language plpgsql as $$
declare v_amount numeric;
begin
  if new.status='issued' and (tg_op='INSERT' or old.status<>'issued') then
    v_amount:=round(new.amount_lakh*100000,2);
    perform post_vyndi_finance_journal('FIN-AR-'||new.id,new.issued_at::date,'sales_invoice',new.id,
      'Customer invoice '||new.id,
      jsonb_build_array(
        jsonb_build_object('accountCode','1100','debitInr',v_amount,'memo','Trade receivable'),
        jsonb_build_object('accountCode','4000','creditInr',v_amount,'memo','Product revenue')));
  elsif tg_op='UPDATE' and new.status='void' and old.status='issued' then
    perform reverse_vyndi_finance_journal('sales_invoice',new.id,'FIN-AR-REV-'||new.id,
      'sales_invoice_reversal',coalesce(new.voided_at::date,current_date),'Customer invoice reversal '||new.id);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_vyndi_finance_customer_invoice on vyndi_invoices;
create trigger trg_vyndi_finance_customer_invoice
after insert or update of status on vyndi_invoices
for each row execute function vyndi_finance_customer_invoice_trigger();

create or replace function vyndi_finance_collection_trigger() returns trigger
language plpgsql as $$
declare v_amount numeric;
begin
  v_amount:=round(new.amount_lakh*100000,2);
  if new.status='posted' and (tg_op='INSERT' or old.status<>'posted') then
    perform post_vyndi_finance_journal('FIN-COL-'||new.id,new.posted_at::date,'customer_receipt',new.id,
      'Customer receipt '||new.id,
      jsonb_build_array(
        jsonb_build_object('accountCode','1000','debitInr',v_amount,'memo','Bank receipt'),
        jsonb_build_object('accountCode','1100','creditInr',v_amount,'memo','Settle trade receivable')));
  elsif tg_op='UPDATE' and new.status='reversed' and old.status='posted' then
    perform reverse_vyndi_finance_journal('customer_receipt',new.id,'FIN-COL-REV-'||new.id,
      'customer_receipt_reversal',coalesce(new.reversed_at::date,current_date),'Customer receipt reversal '||new.id);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_vyndi_finance_collection on vyndi_collections;
create trigger trg_vyndi_finance_collection
after insert or update of status on vyndi_collections
for each row execute function vyndi_finance_collection_trigger();

create or replace view epr_finance_general_ledger as
select j.id as journal_id,j.entry_date,j.source_type,j.source_id,j.description,j.posted_at,
       l.line_no,l.account_code,l.debit_inr,l.credit_inr,l.memo
  from epr_finance_journals j
  join epr_finance_journal_lines l on l.journal_id=j.id
 where j.status='posted'
 order by j.entry_date desc,j.posted_at desc,j.id,l.line_no;

create or replace view epr_finance_trial_balance as
select l.account_code,
       round(coalesce(sum(l.debit_inr),0),2) as debit_inr,
       round(coalesce(sum(l.credit_inr),0),2) as credit_inr,
       round(coalesce(sum(l.debit_inr-l.credit_inr),0),2) as balance_inr
  from epr_finance_journals j
  join epr_finance_journal_lines l on l.journal_id=j.id
 where j.status='posted'
 group by l.account_code
 order by l.account_code;

create or replace view epr_finance_control_summary as
select
  (select count(*) from epr_finance_journals where status='posted')::int as posted_journals,
  (select count(*) from epr_finance_posting_exceptions where resolved=false)::int as open_posting_exceptions,
  (select count(*) from epr_finance_bank_statement_lines where matched_journal_id is null)::int as unmatched_bank_lines,
  (select count(*) from epr_finance_gst_ledger where gst_inr>0 and trim(coalesce(evidence_reference,''))='')::int as gst_evidence_exceptions,
  (select count(*) from epr_finance_fixed_assets where status<>'disposed' and trim(coalesce(source_reference,''))='')::int as asset_evidence_exceptions,
  (select count(*) from epr_finance_payroll_controls where trim(coalesce(payment_reference,''))='' or (statutory_payable_inr>0 and trim(coalesce(return_evidence_reference,''))=''))::int as payroll_evidence_exceptions;

comment on view epr_finance_general_ledger is 'Transaction-derived posted accounting lines. Operational source records remain canonical.';
comment on view epr_finance_trial_balance is 'Trial balance derived only from posted journals, including linked reversal journals.';
