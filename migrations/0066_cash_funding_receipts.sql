-- Governed append-only cash funding receipts.
-- Each receipt remains individually traceable while the verified amount is rolled
-- into canonical monthly closing cash through the existing monthly-actual authority.

create table if not exists vyndi_cash_funding_receipts (
  id text primary key,
  plan_month integer not null check (plan_month between 1 and 36),
  received_on date not null,
  amount_lakh numeric(18,4) not null check (amount_lakh > 0),
  funding_source text not null check (funding_source in (
    'founder_funding','bridge_funding','grant','share_subscription','loan','other_funding'
  )),
  accounting_classification text not null default 'pending' check (accounting_classification in (
    'pending','share_capital','founder_loan','grant_income','debt','other'
  )),
  evidence_reference text not null check (length(trim(evidence_reference)) > 0),
  notes text not null default '',
  verified boolean not null default true,
  created_by text not null,
  created_at timestamptz not null default now(),
  unique (evidence_reference)
);

create index if not exists vyndi_cash_funding_receipts_month_idx
  on vyndi_cash_funding_receipts(plan_month,received_on,id);

comment on table vyndi_cash_funding_receipts is
  'Append-only verified non-operating funding receipts. Individual receipts remain distinct from the canonical monthly closing-cash balance.';
comment on column vyndi_cash_funding_receipts.accounting_classification is
  'Legal/accounting classification may remain pending until authoritative corporate/accounting evidence is available.';

create or replace function post_vyndi_cash_funding_receipt(
  p_id text,
  p_plan_month integer,
  p_received_on date,
  p_amount_lakh numeric,
  p_funding_source text,
  p_accounting_classification text,
  p_evidence_reference text,
  p_notes text,
  p_actor_user_id text,
  p_actor_role text
) returns table (receipt_id text, new_closing_cash_lakh numeric, actual_revision integer)
language plpgsql
as $$
declare
  v_actual vyndi_monthly_actuals%rowtype;
  v_new_cash numeric;
  v_revision integer;
  v_source text;
begin
  if p_amount_lakh is null or p_amount_lakh <= 0 then
    raise exception 'Cash funding receipt amount must be greater than zero.';
  end if;
  if trim(coalesce(p_evidence_reference,'')) = '' then
    raise exception 'Cash funding receipt requires bank/ledger/evidence reference.';
  end if;

  perform pg_advisory_xact_lock(hashtext('cash-funding|M' || p_plan_month)::bigint);

  if exists(select 1 from vyndi_cash_funding_receipts where id=p_id) then
    raise exception 'Cash funding receipt ID % already exists.', p_id;
  end if;
  if exists(select 1 from vyndi_cash_funding_receipts where evidence_reference=p_evidence_reference) then
    raise exception 'This cash funding evidence reference has already been posted.';
  end if;

  select * into v_actual
    from vyndi_monthly_actuals
   where plan_month=p_plan_month and verified=true and closing_cash is not null
   for update;
  if not found then
    raise exception 'Verified canonical closing cash for M% must exist before adding a funding receipt.', p_plan_month;
  end if;

  insert into vyndi_cash_funding_receipts (
    id,plan_month,received_on,amount_lakh,funding_source,accounting_classification,
    evidence_reference,notes,verified,created_by
  ) values (
    p_id,p_plan_month,p_received_on,p_amount_lakh,p_funding_source,
    coalesce(nullif(trim(p_accounting_classification),''),'pending'),
    trim(p_evidence_reference),coalesce(p_notes,''),true,p_actor_user_id
  );

  v_new_cash := v_actual.closing_cash + p_amount_lakh;
  v_source := left(
    concat_ws('; ',nullif(trim(v_actual.source_reference),''),
      'cash-receipt:' || p_id,
      left(trim(p_evidence_reference),140)),
    480
  );

  v_revision := save_vyndi_monthly_actual(
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

  insert into vyndi_audit_events (
    id,entity_type,entity_id,entity_revision,action,actor_user_id,actor_role,
    source_reference,payload_json,correlation_id,gate_id,gate_result
  ) values (
    'AUD-CASH-RECEIPT-' || p_id,
    'cash_funding_receipt',p_id,1,'CASH_FUNDING_RECEIPT_POSTED',
    p_actor_user_id,p_actor_role,trim(p_evidence_reference),
    jsonb_build_object(
      'planMonth',p_plan_month,
      'receivedOn',p_received_on,
      'amountLakh',p_amount_lakh,
      'fundingSource',p_funding_source,
      'accountingClassification',coalesce(nullif(trim(p_accounting_classification),''),'pending'),
      'priorClosingCashLakh',v_actual.closing_cash,
      'newClosingCashLakh',v_new_cash,
      'monthlyActualRevision',v_revision
    ),
    'CASH|' || p_id,'G13-FINANCE','pass'
  );

  return query select p_id,v_new_cash,v_revision;
end;
$$;

comment on function post_vyndi_cash_funding_receipt(text,integer,date,numeric,text,text,text,text,text,text) is
  'Posts one verified append-only funding receipt, preserves its own evidence identity, and increments the existing verified monthly closing cash without rewriting prior receipt history.';
