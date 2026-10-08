-- VAOS operational write authority closure.
-- Closes the three canonical VYNDI command gaps identified by the VAOS write-bridge preparation:
-- 1) controlled PO amendment with optimistic revision control and reapproval,
-- 2) controlled traveller stage progression with release/quality gates,
-- 3) supplier-payment preparation separated from payment posting.

alter table vyndi_purchase_orders
  add column if not exists record_revision integer not null default 1;

alter table epr_travellers
  add column if not exists record_revision integer not null default 1;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid='vyndi_purchase_orders'::regclass
       and conname='vyndi_purchase_orders_record_revision_check'
  ) then
    alter table vyndi_purchase_orders
      add constraint vyndi_purchase_orders_record_revision_check check (record_revision > 0);
  end if;
  if not exists (
    select 1 from pg_constraint
     where conrelid='epr_travellers'::regclass
       and conname='epr_travellers_record_revision_check'
  ) then
    alter table epr_travellers
      add constraint epr_travellers_record_revision_check check (record_revision > 0);
  end if;
end;
$$;

create table if not exists vyndi_supplier_payment_preparations (
  id text primary key,
  idempotency_key text not null unique,
  supplier_invoice_id text not null references vyndi_supplier_invoices(id) on delete restrict,
  plan_month integer not null check (plan_month between 1 and 36),
  proposed_paid_on date not null,
  amount_inr numeric(14,2) not null check (amount_inr > 0),
  status text not null default 'pending_approval'
    check (status in ('pending_approval','approved','cancelled','executed')),
  record_revision integer not null default 1 check (record_revision > 0),
  source_reference text not null,
  notes text not null default '',
  created_by text not null,
  created_role text not null,
  created_at timestamptz not null default now(),
  approved_by text,
  approved_role text,
  approved_at timestamptz,
  executed_payment_id text references vyndi_supplier_payments(id) on delete restrict,
  executed_by text,
  executed_at timestamptz,
  updated_at timestamptz not null default now()
);

create index if not exists vyndi_supplier_payment_preparations_invoice_idx
  on vyndi_supplier_payment_preparations(supplier_invoice_id,status,proposed_paid_on,id);

comment on table vyndi_supplier_payment_preparations is
  'Maker/checker supplier-payment preparation. Preparation reserves open payable but does not post cash, journal or supplier payment.';

create or replace function amend_vyndi_purchase_order(
  p_id text,
  p_expected_revision integer,
  p_supplier_id text,
  p_quantity numeric,
  p_unit_price_inr numeric,
  p_expected_receipt_on date,
  p_payment_terms_days integer,
  p_source_reference text,
  p_notes text,
  p_actor_user_id text,
  p_actor_role text
) returns table (
  purchase_order_id text,
  record_revision integer,
  status text
)
language plpgsql
as $$
declare
  v_po vyndi_purchase_orders%rowtype;
  v_next_revision integer;
  v_next_status text;
begin
  if trim(coalesce(p_source_reference,''))='' then
    raise exception 'Purchase-order amendment evidence reference is required.';
  end if;
  if p_expected_revision is null or p_expected_revision<=0 then
    raise exception 'Purchase-order amendment requires a positive expected revision.';
  end if;
  if coalesce(p_quantity,0)<=0 then
    raise exception 'Purchase-order amendment quantity must be positive.';
  end if;
  if coalesce(p_unit_price_inr,0)<=0 then
    raise exception 'Purchase-order amendment price must be positive.';
  end if;
  if p_payment_terms_days<0 or p_payment_terms_days>365 then
    raise exception 'Payment terms must be between 0 and 365 days.';
  end if;

  select * into v_po
    from vyndi_purchase_orders
   where id=p_id
   for update;
  if not found then raise exception 'Purchase order not found.'; end if;

  if v_po.record_revision<>p_expected_revision then
    raise exception 'Stale purchase-order revision: expected %, current %.',p_expected_revision,v_po.record_revision;
  end if;
  if v_po.status not in ('draft','pending_approval','approved') then
    raise exception 'Purchase order cannot be amended after issue/receipt or cancellation; current status is %.',v_po.status;
  end if;
  if exists(select 1 from vyndi_goods_receipts gr where gr.purchase_order_id=p_id) then
    raise exception 'Purchase order with receipt history cannot be commercially amended.';
  end if;
  if p_expected_receipt_on<v_po.order_date then
    raise exception 'Expected receipt cannot precede the purchase-order date.';
  end if;
  if not exists(
    select 1 from vyndi_suppliers
     where id=upper(trim(p_supplier_id))
       and active=true
       and approval_status='approved'
  ) then
    raise exception 'Purchase-order amendment requires an active approved supplier.';
  end if;

  v_next_revision:=v_po.record_revision+1;
  v_next_status:=case when v_po.status='draft' then 'draft' else 'pending_approval' end;

  update vyndi_purchase_orders
     set supplier_id=upper(trim(p_supplier_id)),
         quantity=p_quantity,
         unit_price_inr=p_unit_price_inr,
         expected_receipt_on=p_expected_receipt_on,
         payment_terms_days=p_payment_terms_days,
         source_reference=trim(p_source_reference),
         notes=coalesce(p_notes,''),
         status=v_next_status,
         record_revision=v_next_revision,
         approved_by=case when v_next_status='pending_approval' then null else approved_by end,
         approved_at=case when v_next_status='pending_approval' then null else approved_at end,
         updated_by=p_actor_user_id,
         updated_at=now()
   where id=p_id;

  insert into vyndi_audit_events(
    id,entity_type,entity_id,entity_revision,action,actor_user_id,actor_role,
    source_reference,payload_json,correlation_id,previous_state,new_state,reason
  ) values (
    'AUD-PO-AMEND-'||substr(md5(p_id||'|'||v_next_revision::text||'|'||clock_timestamp()::text),1,24),
    'purchase_order',p_id,v_next_revision,'PURCHASE_ORDER_AMENDED',
    p_actor_user_id,p_actor_role,trim(p_source_reference),
    jsonb_build_object(
      'fromRevision',v_po.record_revision,
      'toRevision',v_next_revision,
      'supplierId',upper(trim(p_supplier_id)),
      'quantity',p_quantity,
      'unitPriceInr',p_unit_price_inr,
      'expectedReceiptOn',p_expected_receipt_on,
      'paymentTermsDays',p_payment_terms_days,
      'reapprovalRequired',v_po.status in ('pending_approval','approved')
    ),
    'PO|'||p_id,v_po.status,v_next_status,'Controlled commercial amendment'
  );

  return query select p_id,v_next_revision,v_next_status;
end;
$$;

create or replace function submit_vyndi_draft_purchase_order(
  p_id text,
  p_supplier_id text,
  p_unit_price_inr numeric,
  p_expected_receipt_on date,
  p_payment_terms_days integer,
  p_source_reference text,
  p_notes text,
  p_actor_user_id text,
  p_actor_role text
) returns text
language plpgsql
as $$
declare
  p record;
  v_revision integer;
begin
  select * into p from vyndi_purchase_orders where id=p_id for update;
  if p.id is null then raise exception 'Purchase order not found.'; end if;
  if p.status<>'draft' then raise exception 'Only a draft purchase order can be submitted; current status is %.',p.status; end if;
  if trim(coalesce(p_source_reference,''))='' then raise exception 'Supplier quotation / evidence reference is required.'; end if;
  if p_unit_price_inr<=0 then raise exception 'A positive controlled supplier price is required before PO submission.'; end if;
  if p_expected_receipt_on<p.order_date then raise exception 'Expected receipt cannot precede the order date.'; end if;
  if p_payment_terms_days<0 or p_payment_terms_days>365 then raise exception 'Payment terms must be between 0 and 365 days.'; end if;
  if not exists(select 1 from vyndi_suppliers where id=upper(trim(p_supplier_id)) and active=true and approval_status='approved') then
    raise exception 'PO submission requires an active approved supplier.';
  end if;

  v_revision:=p.record_revision+1;
  update vyndi_purchase_orders
     set supplier_id=upper(trim(p_supplier_id)),
         unit_price_inr=p_unit_price_inr,
         expected_receipt_on=p_expected_receipt_on,
         payment_terms_days=p_payment_terms_days,
         source_reference=p_source_reference,
         notes=coalesce(p_notes,''),
         status='pending_approval',
         record_revision=v_revision,
         updated_by=p_actor_user_id,
         updated_at=now()
   where id=p_id;

  insert into vyndi_audit_events
    (id,entity_type,entity_id,entity_revision,action,actor_user_id,actor_role,source_reference,payload_json)
  values
    ('AUD-'||p_id||'-SUBMIT-'||substr(md5(clock_timestamp()::text),1,8),'purchase_order',p_id,v_revision,
     'submitted_for_approval',p_actor_user_id,p_actor_role,p_source_reference,
     jsonb_build_object('supplierId',upper(trim(p_supplier_id)),'unitPriceInr',p_unit_price_inr,
       'autoGenerated',p.auto_generated,'jobCardId',p.job_card_id,'recordRevision',v_revision));
  return p_id;
end;
$$;

create or replace function transition_vyndi_purchase_order(
  p_id text,p_next_status text,p_source_reference text,p_actor_user_id text,p_actor_role text
) returns text language plpgsql as $$
declare
  v_po vyndi_purchase_orders%rowtype;
  v_revision integer;
begin
  select * into v_po from vyndi_purchase_orders where id=p_id for update;
  if not found then raise exception 'Purchase order not found.'; end if;
  if not ((v_po.status='draft' and p_next_status='cancelled') or
          (v_po.status='pending_approval' and p_next_status in ('approved','cancelled')) or
          (v_po.status='approved' and p_next_status in ('issued','cancelled')) or
          (v_po.status in ('issued','part_received') and p_next_status='cancelled')) then
    raise exception 'Purchase order transition % -> % is not allowed.',v_po.status,p_next_status;
  end if;
  if p_next_status='approved' and v_po.created_by=p_actor_user_id then
    raise exception 'Purchase-order approval requires a different authorised user.';
  end if;
  if p_next_status in ('approved','issued') and v_po.supplier_id is null then
    raise exception 'Supplier must be assigned before purchase-order approval or issue.';
  end if;
  v_revision:=v_po.record_revision+1;
  update vyndi_purchase_orders set status=p_next_status,record_revision=v_revision,
    approved_by=case when p_next_status='approved' then p_actor_user_id else approved_by end,
    approved_at=case when p_next_status='approved' then now() else approved_at end,
    issued_by=case when p_next_status='issued' then p_actor_user_id else issued_by end,
    issued_at=case when p_next_status='issued' then now() else issued_at end,
    updated_by=p_actor_user_id,updated_at=now() where id=p_id;
  insert into vyndi_audit_events
    (id,entity_type,entity_id,entity_revision,action,actor_user_id,actor_role,source_reference,payload_json)
  values
    ('AUD-'||p_id||'-'||p_next_status||'-'||substr(md5(clock_timestamp()::text),1,8),'purchase_order',p_id,v_revision,
     p_next_status,p_actor_user_id,p_actor_role,p_source_reference,
     jsonb_build_object('from',v_po.status,'to',p_next_status,'recordRevision',v_revision));
  return p_id;
end;
$$;

create or replace function transition_vyndi_traveller_stage(
  p_traveller_id text,
  p_expected_status text,
  p_expected_revision integer,
  p_next_status text,
  p_source_reference text,
  p_reason text,
  p_actor_user_id text,
  p_actor_role text
) returns table (
  traveller_id text,
  status text,
  record_revision integer
)
language plpgsql
as $$
declare
  v_traveller epr_travellers%rowtype;
  v_can_release boolean;
  v_blocking_reason text;
  v_revision integer;
begin
  if trim(coalesce(p_source_reference,''))='' then
    raise exception 'Traveller stage transition evidence reference is required.';
  end if;
  if trim(coalesce(p_reason,''))='' then
    raise exception 'Traveller stage transition reason is required.';
  end if;
  if p_expected_revision is null or p_expected_revision<=0 then
    raise exception 'Traveller stage transition requires a positive expected revision.';
  end if;

  select * into v_traveller
    from epr_travellers
   where id=p_traveller_id
   for update;
  if not found then raise exception 'Production traveller not found.'; end if;

  if v_traveller.status<>p_expected_status then
    raise exception 'Stale traveller status: expected %, current %.',p_expected_status,v_traveller.status;
  end if;
  if v_traveller.record_revision<>p_expected_revision then
    raise exception 'Stale traveller revision: expected %, current %.',p_expected_revision,v_traveller.record_revision;
  end if;

  if not (
    (v_traveller.status='released' and p_next_status='in_build') or
    (v_traveller.status='hold' and p_next_status='in_build') or
    (v_traveller.status='in_build' and p_next_status='completed')
  ) then
    raise exception 'Traveller forward transition % -> % is not allowed by the governed stage authority.',
      v_traveller.status,p_next_status;
  end if;

  if p_next_status='in_build' and v_traveller.status='released' and not exists (
    select 1 from epr_gate_events ge
     where ge.traveller_id=p_traveller_id and ge.gate_id='EPR-04' and ge.status='passed'
  ) then
    raise exception 'Traveller cannot enter build without passed EPR-04 production-release evidence.';
  end if;

  if p_next_status in ('in_build','completed') and epr_traveller_release_blocked(p_traveller_id) then
    raise exception 'Traveller stage transition is blocked by an active release block.';
  end if;

  if p_next_status='completed' then
    select can_release,blocking_reason
      into v_can_release,v_blocking_reason
      from vyndi_quality_release_gate(p_traveller_id);
    if coalesce(v_can_release,false)=false then
      raise exception 'Traveller completion blocked by Quality: %',coalesce(v_blocking_reason,'release gate not satisfied');
    end if;
  end if;

  v_revision:=v_traveller.record_revision+1;
  update epr_travellers as tr
     set status=p_next_status,
         record_revision=v_revision,
         updated_at=now()
   where tr.id=p_traveller_id
     and tr.status=p_expected_status
     and tr.record_revision=p_expected_revision;
  if not found then raise exception 'Traveller changed concurrently; reload before advancing stage.'; end if;

  insert into epr_audit_events(id,venture,entity_type,entity_id,action,actor,payload_json)
  values(
    'AUD-TRV-STAGE-'||substr(md5(p_traveller_id||'|'||v_revision::text||'|'||clock_timestamp()::text),1,24),
    v_traveller.venture,'traveller',p_traveller_id,'stage_transition',p_actor_user_id,
    json_build_object(
      'fromStatus',v_traveller.status,'toStatus',p_next_status,'recordRevision',v_revision,
      'sourceReference',trim(p_source_reference),'reason',trim(p_reason)
    )::text
  );

  insert into vyndi_audit_events(
    id,entity_type,entity_id,entity_revision,action,actor_user_id,actor_role,
    source_reference,payload_json,correlation_id,previous_state,new_state,reason
  ) values (
    'AUD-VYNDI-TRV-STAGE-'||substr(md5(p_traveller_id||'|'||v_revision::text||'|'||clock_timestamp()::text),1,24),
    'traveller',p_traveller_id,v_revision,'TRAVELLER_STAGE_ADVANCED',
    p_actor_user_id,p_actor_role,trim(p_source_reference),
    jsonb_build_object('fromStatus',v_traveller.status,'toStatus',p_next_status,'recordRevision',v_revision),
    'TRAVELLER_STAGE|'||p_traveller_id,v_traveller.status,p_next_status,trim(p_reason)
  );

  return query select p_traveller_id,p_next_status,v_revision;
end;
$$;

create or replace function prepare_vyndi_supplier_payment(
  p_id text,
  p_idempotency_key text,
  p_supplier_invoice_id text,
  p_payment_plan_month integer,
  p_proposed_paid_on date,
  p_amount_inr numeric,
  p_source_reference text,
  p_notes text,
  p_actor_user_id text,
  p_actor_role text
) returns table (
  payment_preparation_id text,
  record_revision integer,
  status text,
  open_payable_inr numeric
)
language plpgsql
as $$
declare
  v_invoice vyndi_supplier_invoices%rowtype;
  v_existing vyndi_supplier_payment_preparations%rowtype;
  v_paid numeric:=0;
  v_notes numeric:=0;
  v_reserved numeric:=0;
  v_net numeric:=0;
  v_open numeric:=0;
begin
  if trim(coalesce(p_id,''))='' then raise exception 'Payment-preparation id is required.'; end if;
  if trim(coalesce(p_idempotency_key,''))='' then raise exception 'Payment-preparation idempotency key is required.'; end if;
  if p_payment_plan_month not between 1 and 36 then raise exception 'Payment cash plan month must be between 1 and 36.'; end if;
  if coalesce(p_amount_inr,0)<=0 then raise exception 'Prepared payment amount must be positive.'; end if;
  if trim(coalesce(p_source_reference,''))='' then raise exception 'Payment-preparation source reference is required.'; end if;

  perform pg_advisory_xact_lock(hashtext('payment-preparation|'||p_supplier_invoice_id)::bigint);

  select * into v_existing
    from vyndi_supplier_payment_preparations
   where id=p_id or idempotency_key=trim(p_idempotency_key)
   order by case when id=p_id then 0 else 1 end
   limit 1;
  if found then
    if v_existing.supplier_invoice_id=p_supplier_invoice_id
       and v_existing.plan_month=p_payment_plan_month
       and v_existing.proposed_paid_on=p_proposed_paid_on
       and v_existing.amount_inr=round(p_amount_inr,2)
       and v_existing.source_reference=trim(p_source_reference) then
      select greatest(
        round(i.amount_ex_gst_inr+i.gst_inr
          -coalesce((select sum(amount_inr) from vyndi_supplier_payments sp where sp.supplier_invoice_id=i.id and sp.status='posted'),0)
          -coalesce((select sum(gross_amount_inr) from vyndi_supplier_returns sr where sr.supplier_invoice_id=i.id and sr.status='posted'),0),2),0
      ) into v_open
      from vyndi_supplier_invoices i where i.id=p_supplier_invoice_id;
      return query select v_existing.id,v_existing.record_revision,v_existing.status,v_open;
      return;
    end if;
    raise exception 'Payment-preparation id or idempotency key already exists with different state.';
  end if;

  select * into v_invoice
    from vyndi_supplier_invoices
   where id=p_supplier_invoice_id
   for update;
  if not found then raise exception 'Supplier invoice not found.'; end if;
  if v_invoice.status not in ('approved','part_paid') then
    raise exception 'Payment preparation requires an approved open supplier invoice.';
  end if;

  select coalesce(sum(amount_inr),0) into v_paid
    from vyndi_supplier_payments sp where sp.supplier_invoice_id=v_invoice.id and sp.status='posted';
  select coalesce(sum(gross_amount_inr),0) into v_notes
    from vyndi_supplier_returns sr where sr.supplier_invoice_id=v_invoice.id and sr.status='posted';
  select coalesce(sum(amount_inr),0) into v_reserved
    from vyndi_supplier_payment_preparations pp
   where pp.supplier_invoice_id=v_invoice.id and pp.status in ('pending_approval','approved');

  v_net:=greatest(round(v_invoice.amount_ex_gst_inr+v_invoice.gst_inr-v_notes,2),0);
  v_open:=greatest(round(v_net-v_paid-v_reserved,2),0);
  if v_open<=0.01 then raise exception 'Supplier invoice has no unreserved open payable.'; end if;
  if round(p_amount_inr,2)>v_open+0.01 then
    raise exception 'Prepared payment % exceeds unreserved open payable %.',round(p_amount_inr,2),v_open;
  end if;

  insert into vyndi_supplier_payment_preparations(
    id,idempotency_key,supplier_invoice_id,plan_month,proposed_paid_on,amount_inr,status,
    source_reference,notes,created_by,created_role
  ) values (
    p_id,trim(p_idempotency_key),p_supplier_invoice_id,p_payment_plan_month,p_proposed_paid_on,
    round(p_amount_inr,2),'pending_approval',trim(p_source_reference),coalesce(p_notes,''),
    p_actor_user_id,p_actor_role
  );

  insert into vyndi_audit_events(
    id,entity_type,entity_id,entity_revision,action,actor_user_id,actor_role,
    source_reference,payload_json,correlation_id,new_state,reason
  ) values (
    'AUD-PAY-PREP-'||substr(md5(p_id||'|'||clock_timestamp()::text),1,24),
    'supplier_payment_preparation',p_id,1,'SUPPLIER_PAYMENT_PREPARED',
    p_actor_user_id,p_actor_role,trim(p_source_reference),
    jsonb_build_object(
      'supplierInvoiceId',p_supplier_invoice_id,'planMonth',p_payment_plan_month,
      'proposedPaidOn',p_proposed_paid_on,'amountInr',round(p_amount_inr,2),
      'unreservedOpenPayableBeforeInr',v_open,'idempotencyKey',trim(p_idempotency_key)
    ),
    'PAYMENT_PREPARATION|'||p_id,'pending_approval','Payment preparation only; no cash or journal posted'
  );

  return query select p_id,1,'pending_approval'::text,v_open;
end;
$$;

create or replace function approve_vyndi_supplier_payment_preparation(
  p_id text,
  p_expected_revision integer,
  p_source_reference text,
  p_actor_user_id text,
  p_actor_role text
) returns table (
  payment_preparation_id text,
  record_revision integer,
  status text
)
language plpgsql
as $$
declare
  v_prep vyndi_supplier_payment_preparations%rowtype;
  v_revision integer;
begin
  if trim(coalesce(p_source_reference,''))='' then raise exception 'Payment approval evidence reference is required.'; end if;
  select * into v_prep from vyndi_supplier_payment_preparations where id=p_id for update;
  if not found then raise exception 'Supplier-payment preparation not found.'; end if;
  if v_prep.record_revision<>p_expected_revision then
    raise exception 'Stale payment-preparation revision: expected %, current %.',p_expected_revision,v_prep.record_revision;
  end if;
  if v_prep.status<>'pending_approval' then
    raise exception 'Only pending payment preparation may be approved; current status is %.',v_prep.status;
  end if;
  if v_prep.created_by=p_actor_user_id then
    raise exception 'Supplier-payment preparation approval requires a different authorised user.';
  end if;
  if not exists(
    select 1 from vyndi_supplier_invoices si
     where si.id=v_prep.supplier_invoice_id and si.status in ('approved','part_paid')
  ) then
    raise exception 'Supplier invoice is no longer payable.';
  end if;

  v_revision:=v_prep.record_revision+1;
  update vyndi_supplier_payment_preparations
     set status='approved',record_revision=v_revision,
         approved_by=p_actor_user_id,approved_role=p_actor_role,approved_at=now(),updated_at=now()
   where id=p_id;

  insert into vyndi_audit_events(
    id,entity_type,entity_id,entity_revision,action,actor_user_id,actor_role,
    source_reference,payload_json,correlation_id,previous_state,new_state
  ) values (
    'AUD-PAY-PREP-APPROVE-'||substr(md5(p_id||'|'||v_revision::text||'|'||clock_timestamp()::text),1,24),
    'supplier_payment_preparation',p_id,v_revision,'SUPPLIER_PAYMENT_PREPARATION_APPROVED',
    p_actor_user_id,p_actor_role,trim(p_source_reference),
    jsonb_build_object('supplierInvoiceId',v_prep.supplier_invoice_id,'amountInr',v_prep.amount_inr),
    'PAYMENT_PREPARATION|'||p_id,v_prep.status,'approved'
  );

  return query select p_id,v_revision,'approved'::text;
end;
$$;

create or replace function execute_vyndi_supplier_payment_preparation(
  p_id text,
  p_expected_revision integer,
  p_bank_evidence_reference text,
  p_actor_user_id text,
  p_actor_role text
) returns table (
  payment_preparation_id text,
  payment_id text,
  record_revision integer,
  invoice_status text
)
language plpgsql
as $$
declare
  v_prep vyndi_supplier_payment_preparations%rowtype;
  v_payment_id text;
  v_payment record;
  v_revision integer;
begin
  if trim(coalesce(p_bank_evidence_reference,''))='' then
    raise exception 'Supplier payment execution requires bank evidence/reference.';
  end if;

  select * into v_prep from vyndi_supplier_payment_preparations where id=p_id for update;
  if not found then raise exception 'Supplier-payment preparation not found.'; end if;
  if v_prep.record_revision<>p_expected_revision then
    raise exception 'Stale payment-preparation revision: expected %, current %.',p_expected_revision,v_prep.record_revision;
  end if;
  if v_prep.status='executed' and v_prep.executed_payment_id is not null then
    select si.status into v_payment from vyndi_supplier_invoices si where si.id=v_prep.supplier_invoice_id;
    return query select p_id,v_prep.executed_payment_id,v_prep.record_revision,(v_payment.status)::text;
    return;
  end if;
  if v_prep.status<>'approved' then
    raise exception 'Only approved payment preparation may be executed; current status is %.',v_prep.status;
  end if;

  v_payment_id:='PAY-'||upper(substr(md5(v_prep.idempotency_key),1,24));
  select * into v_payment
    from post_vyndi_supplier_payment(
      v_payment_id,
      v_prep.supplier_invoice_id,
      v_prep.plan_month,
      v_prep.proposed_paid_on,
      v_prep.amount_inr,
      trim(p_bank_evidence_reference),
      p_actor_user_id,
      p_actor_role
    );

  if v_payment.payment_id is null then
    raise exception 'Supplier payment execution did not return a controlled payment receipt.';
  end if;

  v_revision:=v_prep.record_revision+1;
  update vyndi_supplier_payment_preparations
     set status='executed',record_revision=v_revision,executed_payment_id=v_payment.payment_id,
         executed_by=p_actor_user_id,executed_at=now(),updated_at=now()
   where id=p_id;

  insert into vyndi_audit_events(
    id,entity_type,entity_id,entity_revision,action,actor_user_id,actor_role,
    source_reference,payload_json,correlation_id,previous_state,new_state
  ) values (
    'AUD-PAY-PREP-EXEC-'||substr(md5(p_id||'|'||v_revision::text||'|'||clock_timestamp()::text),1,24),
    'supplier_payment_preparation',p_id,v_revision,'SUPPLIER_PAYMENT_PREPARATION_EXECUTED',
    p_actor_user_id,p_actor_role,trim(p_bank_evidence_reference),
    jsonb_build_object(
      'supplierInvoiceId',v_prep.supplier_invoice_id,'paymentId',v_payment.payment_id,
      'journalId',v_payment.journal_id,'amountInr',v_prep.amount_inr
    ),
    'PAYMENT_PREPARATION|'||p_id,'approved','executed'
  );

  return query select p_id,v_payment.payment_id,v_revision,v_payment.invoice_status;
end;
$$;

comment on function amend_vyndi_purchase_order(text,integer,text,numeric,numeric,date,integer,text,text,text,text) is
  'Optimistic, auditable PO amendment. Issued/received POs cannot be changed; approved amendments are forced back through approval.';
comment on function transition_vyndi_traveller_stage(text,text,integer,text,text,text,text,text) is
  'Forward-only traveller stage authority. Build entry requires EPR-04; completion requires canonical Quality release and no active release block.';
comment on function prepare_vyndi_supplier_payment(text,text,text,integer,date,numeric,text,text,text,text) is
  'Reserves an approved supplier payable for maker/checker approval without posting cash, journal or payment.';
comment on function execute_vyndi_supplier_payment_preparation(text,integer,text,text,text) is
  'Executes only an approved preparation through the pre-existing governed supplier-payment posting authority.';
