-- Governed supplier payment -> Bank 1000 -> canonical cash / VIBPE bridge.
-- Also hardens accounting-period cash reconciliation so a hard close requires one
-- approved bank reconciliation with an explicit VIBPE plan-month mapping and exact
-- agreement between statement closing balance, Bank GL closing balance and verified
-- canonical closing cash. Calendar dates are never inferred into M1..M36.

alter table vyndi_supplier_payments add column if not exists plan_month integer;
alter table vyndi_supplier_payments add column if not exists cash_evidence_reference text;
alter table vyndi_supplier_payments add column if not exists journal_id text;
alter table vyndi_supplier_payments add column if not exists cash_actual_revision integer;
alter table vyndi_supplier_payments add column if not exists new_closing_cash_lakh numeric(18,4);
alter table vyndi_supplier_payments add column if not exists status text not null default 'posted';
alter table vyndi_supplier_payments add column if not exists revision integer not null default 1;
alter table vyndi_supplier_payments add column if not exists reversed_by text;
alter table vyndi_supplier_payments add column if not exists reversed_at timestamptz;
alter table vyndi_supplier_payments add column if not exists reversal_reason text;
alter table vyndi_supplier_payments add column if not exists cash_reversal_revision integer;
alter table vyndi_supplier_payments add column if not exists reversed_closing_cash_lakh numeric(18,4);

alter table vyndi_supplier_payments drop constraint if exists vyndi_supplier_payments_plan_month_check;
alter table vyndi_supplier_payments add constraint vyndi_supplier_payments_plan_month_check
  check (plan_month is null or plan_month between 1 and 36);
alter table vyndi_supplier_payments drop constraint if exists vyndi_supplier_payments_status_check;
alter table vyndi_supplier_payments add constraint vyndi_supplier_payments_status_check
  check (status in ('posted','reversed'));

create unique index if not exists vyndi_supplier_payments_cash_evidence_uidx
  on vyndi_supplier_payments(cash_evidence_reference)
  where cash_evidence_reference is not null;
create unique index if not exists vyndi_supplier_payments_journal_uidx
  on vyndi_supplier_payments(journal_id)
  where journal_id is not null;
create index if not exists vyndi_supplier_payments_plan_month_idx
  on vyndi_supplier_payments(plan_month,status,paid_on);

-- Link legacy payments to the posted Bank journal where it already exists. Legacy rows
-- intentionally keep plan_month/cash revisions null; no historical M-number is invented.
update vyndi_supplier_payments p
   set journal_id=j.id
  from epr_finance_journals j
 where p.journal_id is null
   and j.source_type='supplier_payment'
   and j.source_id=p.id
   and j.status='posted';

-- The historical seven-argument function is deliberately retained only as a fail-closed
-- compatibility boundary. Callers must supply an explicit payment cash plan month.
drop function if exists post_vyndi_supplier_payment(text,text,date,numeric,text,text,text);
create function post_vyndi_supplier_payment(
  p_id text,p_supplier_invoice_id text,p_paid_on date,p_amount_inr numeric,p_source_reference text,
  p_actor_user_id text,p_actor_role text
) returns text language plpgsql as $$
begin
  raise exception 'Explicit supplier-payment cash plan month is required; use the governed payment authority.';
end;
$$;

create or replace function post_vyndi_supplier_payment(
  p_id text,
  p_supplier_invoice_id text,
  p_payment_plan_month integer,
  p_paid_on date,
  p_amount_inr numeric,
  p_source_reference text,
  p_actor_user_id text,
  p_actor_role text
) returns table(
  payment_id text,
  journal_id text,
  new_closing_cash_lakh numeric,
  actual_revision integer,
  invoice_status text
)
language plpgsql
as $$
declare
  i vyndi_supplier_invoices%rowtype;
  p vyndi_supplier_payments%rowtype;
  v_paid numeric;
  v_open numeric;
  v_status text;
  v_journal text;
  v_cash numeric;
  v_revision integer;
begin
  if p_payment_plan_month not between 1 and 36 then
    raise exception 'Supplier payment cash plan month must be between 1 and 36.';
  end if;
  if coalesce(p_amount_inr,0)<=0 then raise exception 'Supplier payment amount must be positive.'; end if;
  if trim(coalesce(p_source_reference,''))='' then raise exception 'Supplier payment bank evidence/reference is required.'; end if;

  perform pg_advisory_xact_lock(hashtext('supplier-payment|'||p_supplier_invoice_id)::bigint);
  select * into p from vyndi_supplier_payments where id=upper(trim(p_id));
  if found then
    if p.status='posted'
       and p.supplier_invoice_id=p_supplier_invoice_id
       and p.plan_month=p_payment_plan_month
       and p.paid_on=p_paid_on
       and p.amount_inr=round(p_amount_inr,2)
       and p.cash_evidence_reference=trim(p_source_reference) then
      select status into v_status from vyndi_supplier_invoices where id=p_supplier_invoice_id;
      return query select p.id,p.journal_id,p.new_closing_cash_lakh,p.cash_actual_revision,v_status;
      return;
    end if;
    raise exception 'Supplier payment id already exists with different state.';
  end if;

  if exists(
    select 1 from vyndi_supplier_payments
     where cash_evidence_reference=trim(p_source_reference)
  ) then
    raise exception 'Supplier payment bank evidence/reference has already been used.';
  end if;

  select * into i from vyndi_supplier_invoices where id=p_supplier_invoice_id for update;
  if not found then raise exception 'Supplier invoice not found.'; end if;
  if i.status not in ('approved','part_paid') then
    raise exception 'Payment requires an approved open supplier invoice.';
  end if;

  select coalesce(sum(amount_inr),0) into v_paid
    from vyndi_supplier_payments
   where supplier_invoice_id=i.id and status='posted';
  v_open:=round(i.amount_ex_gst_inr+i.gst_inr-v_paid,2);
  if round(p_amount_inr,2)>v_open then
    raise exception 'Payment % exceeds open supplier invoice amount %.',round(p_amount_inr,2),v_open;
  end if;

  insert into vyndi_supplier_payments(
    id,supplier_invoice_id,plan_month,paid_on,amount_inr,source_reference,cash_evidence_reference,
    status,created_by
  ) values(
    upper(trim(p_id)),i.id,p_payment_plan_month,p_paid_on,round(p_amount_inr,2),trim(p_source_reference),
    trim(p_source_reference),'posted',p_actor_user_id
  );

  -- The existing canonical supplier-payment trigger posts Dr 2000 Trade Payables /
  -- Cr 1000 Bank. Because that trigger is in the same transaction, failure of the
  -- cash bridge below rolls the payment and the journal back together.
  select j.id into v_journal
    from epr_finance_journals j
   where j.source_type='supplier_payment' and j.source_id=upper(trim(p_id)) and j.status='posted'
   order by j.posted_at desc limit 1;
  if not found then raise exception 'Supplier payment did not produce a posted Bank journal.'; end if;

  select c.new_closing_cash_lakh,c.actual_revision into v_cash,v_revision
    from apply_vyndi_verified_cash_movement(
      p_payment_plan_month,
      -round(p_amount_inr,2)/100000.0,
      'supplier-payment:'||upper(trim(p_id))||'; '||trim(p_source_reference),
      p_actor_user_id,
      p_actor_role
    ) c;

  v_status:=case when round(v_paid+p_amount_inr,2)>=round(i.amount_ex_gst_inr+i.gst_inr,2)
    then 'paid' else 'part_paid' end;

  update vyndi_supplier_payments
     set journal_id=v_journal,cash_actual_revision=v_revision,new_closing_cash_lakh=v_cash
   where id=upper(trim(p_id));
  update vyndi_supplier_invoices set status=v_status,updated_at=now() where id=i.id;

  insert into vyndi_audit_events(
    id,entity_type,entity_id,action,actor_user_id,actor_role,source_reference,payload_json
  ) values(
    'AUD-'||upper(trim(p_id)),'supplier_payment',upper(trim(p_id)),'posted',p_actor_user_id,p_actor_role,
    trim(p_source_reference),jsonb_build_object(
      'supplierInvoiceId',i.id,'paymentPlanMonth',p_payment_plan_month,'amountInr',round(p_amount_inr,2),
      'journalId',v_journal,'bankAccount','1000','newClosingCashLakh',v_cash,'actualRevision',v_revision,
      'invoiceStatus',v_status
    )
  );

  return query select upper(trim(p_id)),v_journal,v_cash,v_revision,v_status;
end;
$$;

create or replace function reverse_vyndi_supplier_payment(
  p_id text,
  p_reversed_on date,
  p_reason text,
  p_actor_user_id text,
  p_actor_role text
) returns integer
language plpgsql
as $$
declare
  p vyndi_supplier_payments%rowtype;
  i vyndi_supplier_invoices%rowtype;
  v_paid numeric;
  v_total numeric;
  v_status text;
  v_revision integer;
  v_reversal_journal text;
  v_cash numeric;
  v_cash_revision integer;
begin
  if trim(coalesce(p_reason,''))='' then raise exception 'Supplier payment reversal reason is required.'; end if;
  perform pg_advisory_xact_lock(hashtext('supplier-payment|'||upper(trim(p_id)))::bigint);
  select * into p from vyndi_supplier_payments where id=upper(trim(p_id)) for update;
  if not found then raise exception 'Supplier payment not found.'; end if;
  if p.status='reversed' then return p.revision; end if;
  if p.created_by=p_actor_user_id then
    raise exception 'Supplier-payment reversal requires a different authorised user.';
  end if;

  select * into i from vyndi_supplier_invoices where id=p.supplier_invoice_id for update;
  if not found then raise exception 'Supplier invoice not found for payment reversal.'; end if;

  v_reversal_journal:=reverse_vyndi_finance_journal(
    'supplier_payment',p.id,'FIN-APPAY-REV-'||p.id,'supplier_payment_reversal',p_reversed_on,
    'Supplier payment reversal '||p.id||' · '||trim(p_reason)
  );
  if p.journal_id is not null and v_reversal_journal is null then
    raise exception 'Controlled supplier payment could not produce a finance reversal journal.';
  end if;

  -- Legacy payments did not move canonical cash and are not retrospectively assigned a
  -- plan month. Controlled payments restore cash only when the original payment moved it.
  if p.cash_actual_revision is not null and p.plan_month is not null then
    select c.new_closing_cash_lakh,c.actual_revision into v_cash,v_cash_revision
      from apply_vyndi_verified_cash_movement(
        p.plan_month,
        p.amount_inr/100000.0,
        'supplier-payment-reversal:'||p.id||'; '||trim(p_reason),
        p_actor_user_id,
        p_actor_role
      ) c;
  end if;

  update vyndi_supplier_payments
     set status='reversed',revision=revision+1,reversed_by=p_actor_user_id,reversed_at=now(),
         reversal_reason=trim(p_reason),cash_reversal_revision=v_cash_revision,
         reversed_closing_cash_lakh=v_cash
   where id=p.id returning revision into v_revision;

  select coalesce(sum(amount_inr),0) into v_paid
    from vyndi_supplier_payments
   where supplier_invoice_id=i.id and status='posted';
  v_total:=round(i.amount_ex_gst_inr+i.gst_inr,2);
  v_status:=case when v_paid<=0.01 then 'approved'
                 when v_paid>=v_total-0.01 then 'paid'
                 else 'part_paid' end;
  update vyndi_supplier_invoices set status=v_status,updated_at=now() where id=i.id;

  insert into vyndi_audit_events(
    id,entity_type,entity_id,action,actor_user_id,actor_role,source_reference,payload_json
  ) values(
    'AUD-'||p.id||'-R'||v_revision,'supplier_payment',p.id,'reversed',p_actor_user_id,p_actor_role,
    trim(p_reason),jsonb_build_object(
      'supplierInvoiceId',i.id,'paymentPlanMonth',p.plan_month,'amountInr',p.amount_inr,
      'reversalJournalId',v_reversal_journal,'cashReversed',p.cash_actual_revision is not null,
      'newClosingCashLakh',v_cash,'actualRevision',v_cash_revision,'invoiceStatus',v_status
    )
  );
  return v_revision;
end;
$$;

-- Reversed supplier payments no longer settle AP.
create or replace view vyndi_accounts_payable as
select i.id,i.purchase_order_id,p.supplier_id,s.name as supplier_name,i.invoice_number,
       i.invoice_on,i.due_on,i.quantity_invoiced,i.amount_ex_gst_inr,i.gst_inr,
       (i.amount_ex_gst_inr+i.gst_inr) as invoice_total_inr,
       coalesce(pay.amount_paid_inr,0) as amount_paid_inr,
       greatest(i.amount_ex_gst_inr+i.gst_inr-coalesce(pay.amount_paid_inr,0),0) as amount_open_inr,
       i.status,i.match_message,i.source_reference
  from vyndi_supplier_invoices i
  join vyndi_purchase_orders p on p.id=i.purchase_order_id
  join vyndi_suppliers s on s.id=p.supplier_id
  left join (
    select supplier_invoice_id,sum(amount_inr) amount_paid_inr
      from vyndi_supplier_payments where status='posted' group by supplier_invoice_id
  ) pay on pay.supplier_invoice_id=i.id;

alter table epr_finance_bank_reconciliation_sessions add column if not exists plan_month integer;
alter table epr_finance_bank_reconciliation_sessions add column if not exists book_closing_balance_inr numeric(18,2);
alter table epr_finance_bank_reconciliation_sessions drop constraint if exists epr_finance_bank_reconciliation_plan_month_check;
alter table epr_finance_bank_reconciliation_sessions add constraint epr_finance_bank_reconciliation_plan_month_check
  check (plan_month is null or plan_month between 1 and 36);
create index if not exists epr_finance_bank_reconciliation_plan_month_idx
  on epr_finance_bank_reconciliation_sessions(period,plan_month,status,approved_at);

create or replace function enforce_vyndi_hard_close_cash_truth() returns trigger
language plpgsql as $$
declare
  v_count integer;
  v_plan_month integer;
  v_statement_closing numeric;
  v_book_closing numeric;
  v_canonical_cash numeric;
begin
  if new.status<>'hard_closed' then return new; end if;
  if tg_op='UPDATE' and old.status='hard_closed' and new.status='hard_closed' then return new; end if;

  select count(*),max(plan_month),max(closing_balance_inr),max(book_closing_balance_inr)
    into v_count,v_plan_month,v_statement_closing,v_book_closing
    from epr_finance_bank_reconciliation_sessions
   where period=new.period and status='reconciled' and approved_by is not null;

  if v_count<>1 then
    raise exception 'Hard close requires exactly one approved Bank reconciliation for %. Found %.',new.period,v_count;
  end if;
  if v_plan_month is null or v_book_closing is null then
    raise exception 'Hard close requires an explicit governed VIBPE plan-month mapping and Bank GL closing balance.';
  end if;
  if abs(v_statement_closing-v_book_closing)>0.01 then
    raise exception 'Hard close blocked: statement closing balance % does not equal Bank GL closing balance %.',v_statement_closing,v_book_closing;
  end if;

  select round(closing_cash*100000,2) into v_canonical_cash
    from vyndi_monthly_actuals
   where plan_month=v_plan_month and verified=true and closing_cash is not null;
  if not found then
    raise exception 'Hard close blocked: M% has no verified canonical closing-cash evidence.',v_plan_month;
  end if;
  if abs(v_statement_closing-v_canonical_cash)>0.01 then
    raise exception 'Hard close blocked: Bank statement/GL closing balance % does not equal M% canonical cash %.',v_statement_closing,v_plan_month,v_canonical_cash;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_vyndi_hard_close_cash_truth on epr_finance_period_closures;
create trigger trg_vyndi_hard_close_cash_truth
before insert or update of status on epr_finance_period_closures
for each row execute function enforce_vyndi_hard_close_cash_truth();

comment on function post_vyndi_supplier_payment(text,text,integer,date,numeric,text,text,text) is
  'Controlled supplier payment authority: explicit M1..M36 cash month, unique bank evidence, AP settlement, Bank 1000 posting and verified canonical cash/VIBPE update in one transaction.';
comment on function reverse_vyndi_supplier_payment(text,date,text,text,text) is
  'Reverses supplier-payment finance and AP state; canonical cash is restored only for payments that originally moved verified canonical cash.';
comment on column epr_finance_bank_reconciliation_sessions.plan_month is
  'Explicit governed mapping from a finance calendar period to the VIBPE M1..M36 cash period. It must never be inferred from the calendar date.';
