-- Forward-only, table-level books edit log. Does not rewrite historical books.
-- This provides transaction/edition capture; full CA reliance additionally requires
-- proven identity attribution, externally preserved log copies and India-located backup.
/*
-- AUDIT_SCOPE_BEGIN
epr_finance_journals
epr_finance_journal_lines
epr_finance_gst_ledger
epr_finance_bank_statement_lines
epr_finance_bank_reconciliation_sessions
epr_finance_bank_match_audit
epr_finance_ca_evidence_packs
epr_finance_period_closures
epr_finance_period_close_events
epr_finance_posting_exceptions
epr_finance_fixed_assets
epr_finance_payroll_controls
epr_finance_tax_registration
vyndi_purchase_orders
vyndi_goods_receipts
vyndi_supplier_invoices
vyndi_supplier_payments
vyndi_supplier_payment_preparations
vyndi_invoices
vyndi_sales_orders
epr_job_cost_snapshots
epr_job_conversion_cost_allocations
epr_inventory_stocktakes
epr_inventory_stocktake_lines
epr_inventory_stocktake_events
epr_inventory_ledger
epr_inventory_movements
epr_inventory_opening_balances
epr_inventory_fifo_layers
epr_inventory_fifo_allocations
epr_inventory_cost_ledger
epr_production_job_cards
vyndi_people_office_actual_expenditures
vyndi_people_office_actual_payments
vyndi_monthly_actuals
vyndi_cash_funding_receipts
vyndi_external_support_receipts
-- AUDIT_SCOPE_END
*/
create table if not exists vyndi_books_edit_audit (
  audit_id bigint generated always as identity primary key,
  source_schema text not null,
  source_table text not null,
  row_key text not null,
  event_type text not null check(event_type in ('INSERT','UPDATE','DELETE')),
  actor_user_id text not null,
  actor_source text not null check(actor_source in ('session','row','unattributed')),
  database_role text not null,
  transaction_id bigint not null,
  changed_at timestamptz not null default clock_timestamp(),
  old_record jsonb,
  new_record jsonb
);
create index if not exists vyndi_books_edit_audit_lookup_idx
  on vyndi_books_edit_audit(source_table,row_key,audit_id);
create index if not exists vyndi_books_edit_audit_time_idx
  on vyndi_books_edit_audit(changed_at,audit_id);

create or replace function prevent_vyndi_books_audit_mutation()
returns trigger language plpgsql as $$
begin
 raise exception 'Books edit audit is append-only: correction must create a new event.';
end;
$$;
create trigger trg_vyndi_books_audit_protect_rows
before update or delete on vyndi_books_edit_audit
for each row execute function prevent_vyndi_books_audit_mutation();
create trigger trg_vyndi_books_audit_protect_truncate
before truncate on vyndi_books_edit_audit
for each statement execute function prevent_vyndi_books_audit_mutation();
alter table vyndi_books_edit_audit enable always trigger trg_vyndi_books_audit_protect_rows;
alter table vyndi_books_edit_audit enable always trigger trg_vyndi_books_audit_protect_truncate;
revoke update,delete,truncate on vyndi_books_edit_audit from public;

create or replace function capture_vyndi_books_edit_audit()
returns trigger language plpgsql as $$
declare
 v_before jsonb;
 v_after jsonb;
 v_row jsonb;
 v_actor text;
 v_source text := 'unattributed';
 v_key text;
begin
 if tg_op <> 'INSERT' then v_before:=to_jsonb(old); end if;
 if tg_op <> 'DELETE' then v_after:=to_jsonb(new); end if;
 v_row:=coalesce(v_after,v_before);
 v_actor:=nullif(trim(coalesce(current_setting('vyndi.actor_user_id',true),'')),'');
 if v_actor is not null then
   v_source:='session';
 elsif tg_op='INSERT' then
   v_actor:=coalesce(
     nullif(v_after->>'created_by',''),nullif(v_after->>'prepared_by',''),
     nullif(v_after->>'generated_by',''),nullif(v_after->>'actor_user_id',''),
     nullif(v_after->>'posted_by',''));
   if v_actor is not null then v_source:='row'; end if;
 elsif tg_op='UPDATE' then
   if (v_after->>'updated_by') is distinct from (v_before->>'updated_by') then
     v_actor:=nullif(v_after->>'updated_by','');
   elsif (v_after->>'approved_by') is distinct from (v_before->>'approved_by') then
     v_actor:=nullif(v_after->>'approved_by','');
   elsif (v_after->>'posted_by') is distinct from (v_before->>'posted_by') then
     v_actor:=nullif(v_after->>'posted_by','');
   elsif (v_after->>'actor_user_id') is distinct from (v_before->>'actor_user_id') then
     v_actor:=nullif(v_after->>'actor_user_id','');
   end if;
   if v_actor is not null then v_source:='row'; end if;
 end if;
 if v_actor is null then v_actor:='UNATTRIBUTED'; end if;
 v_key:=coalesce(nullif(v_row->>'id',''),
    nullif(v_row->>'journal_id',''),nullif(v_row->>'invoice_id',''),
    nullif(v_row->>'period',''),nullif(v_row->>'sku',''),
    'UNKEYED');
 insert into vyndi_books_edit_audit(
   source_schema,source_table,row_key,event_type,actor_user_id,actor_source,
   database_role,transaction_id,old_record,new_record
 ) values (
   tg_table_schema,tg_table_name,v_key,tg_op,v_actor,v_source,
   current_user,txid_current(),v_before,v_after
 );
 if tg_op='DELETE' then return old; end if;
 return new;
end;
$$;

do $$
declare v_table text;
begin
 foreach v_table in array array[
   'epr_finance_journals',
   'epr_finance_journal_lines',
   'epr_finance_gst_ledger',
   'epr_finance_bank_statement_lines',
   'epr_finance_bank_reconciliation_sessions',
   'epr_finance_bank_match_audit',
   'epr_finance_ca_evidence_packs',
   'epr_finance_period_closures',
   'epr_finance_period_close_events',
   'epr_finance_posting_exceptions',
   'epr_finance_fixed_assets',
   'epr_finance_payroll_controls',
   'epr_finance_tax_registration',
   'vyndi_purchase_orders',
   'vyndi_goods_receipts',
   'vyndi_supplier_invoices',
   'vyndi_supplier_payments',
   'vyndi_supplier_payment_preparations',
   'vyndi_invoices',
   'vyndi_sales_orders',
   'epr_job_cost_snapshots',
   'epr_job_conversion_cost_allocations',
   'epr_inventory_stocktakes',
   'epr_inventory_stocktake_lines',
   'epr_inventory_stocktake_events',
   'epr_inventory_ledger',
   'epr_inventory_movements',
   'epr_inventory_opening_balances',
   'epr_inventory_fifo_layers',
   'epr_inventory_fifo_allocations',
   'epr_inventory_cost_ledger',
   'epr_production_job_cards',
   'vyndi_people_office_actual_expenditures',
   'vyndi_people_office_actual_payments',
   'vyndi_monthly_actuals',
   'vyndi_cash_funding_receipts',
   'vyndi_external_support_receipts'
 ] loop
   if to_regclass('public.'||v_table) is null then
     raise exception 'Required books source table missing for audit trail: %',v_table;
   end if;
   execute format(
     'create trigger trg_vyndi_books_row_audit after insert or update or delete on public.%I for each row execute function public.capture_vyndi_books_edit_audit()',
     v_table
   );
   execute format('alter table public.%I enable always trigger trg_vyndi_books_row_audit',v_table);
 end loop;
end;
$$;
