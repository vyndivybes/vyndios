-- Governed actual Sales Ledger + first-class spare/component sale authority.
-- Reuses Master Inventory, FIFO, controlled identities, tax/AR, collections and canonical cash.
-- It deliberately does not create a parallel inventory, identity or accounting truth.

create table if not exists vyndi_spare_sales (
  id text primary key,
  plan_month integer not null check (plan_month between 1 and 36),
  inventory_item_id text not null references master_inventory_items(id) on delete restrict,
  sku text not null,
  item_name text not null,
  unit text not null,
  quantity numeric(14,4) not null check (quantity > 0),
  unit_price_inr numeric(18,2) not null check (unit_price_inr > 0),
  channel text not null check (channel in ('direct','dealer','online')),
  traceability_class text not null check (traceability_class in ('A','B','C')),
  selected_identity_uid uuid references vyndi_identity_registry(identity_uid) on delete restrict,
  allocated_identity_refs jsonb not null default '[]'::jsonb,
  inventory_movement_id text not null unique references epr_inventory_movements(id) on delete restrict,
  inventory_ledger_id text not null unique references epr_inventory_ledger(id) on delete restrict,
  fifo_cost_inr numeric(18,2) not null check (fifo_cost_inr >= 0),
  status text not null default 'dispatched' check (status in ('dispatched','reversed')),
  source_reference text not null,
  revision integer not null default 1 check (revision > 0),
  posted_by text not null,
  posted_at timestamptz not null default now(),
  dispatch_on date not null,
  reversed_by text,
  reversed_at timestamptz,
  reversal_reason text
);
create index if not exists vyndi_spare_sales_month_idx on vyndi_spare_sales(plan_month,status,dispatch_on);
create index if not exists vyndi_spare_sales_sku_idx on vyndi_spare_sales(sku,status,dispatch_on);

-- Existing invoice rows remain bicycle transactions. New spare/component invoices use an
-- alternate governed source rather than fabricating a bicycle sales order or production job.
alter table vyndi_invoices add column if not exists sale_type text not null default 'bicycle';
alter table vyndi_invoices add column if not exists spare_sale_id text references vyndi_spare_sales(id) on delete restrict;
alter table vyndi_invoices alter column shipment_id drop not null;
alter table vyndi_invoices alter column sales_order_id drop not null;
alter table vyndi_invoices drop constraint if exists vyndi_invoices_sale_type_check;
alter table vyndi_invoices add constraint vyndi_invoices_sale_type_check
  check (sale_type in ('bicycle','spare_component'));
alter table vyndi_invoices drop constraint if exists vyndi_invoices_source_path_check;
alter table vyndi_invoices add constraint vyndi_invoices_source_path_check check (
  (sale_type='bicycle' and shipment_id is not null and sales_order_id is not null and spare_sale_id is null)
  or
  (sale_type='spare_component' and shipment_id is null and sales_order_id is null and spare_sale_id is not null)
);
create unique index if not exists vyndi_invoices_spare_sale_unique_idx
  on vyndi_invoices(spare_sale_id) where spare_sale_id is not null;

create or replace function post_vyndi_spare_sale_dispatch(
  p_id text,
  p_plan_month integer,
  p_inventory_item_id text,
  p_quantity numeric,
  p_unit_price_inr numeric,
  p_channel text,
  p_dispatch_on date,
  p_source_reference text,
  p_selected_identity_uid uuid,
  p_actor_user_id text,
  p_actor_role text
) returns table(spare_sale_id text,resulting_balance numeric,fifo_cost_inr numeric)
language plpgsql
as $$
declare
  i record;
  v_movement_id text:='SPARE-ISS-'||p_id;
  v_ledger_id text:='SPARE-LED-'||p_id;
  v_balance numeric;
  v_fifo numeric;
  v_allocations jsonb:='[]'::jsonb;
  v_allocated_identity_count integer:=0;
  v_inferred_identity uuid;
  v_selected uuid:=p_selected_identity_uid;
begin
  if p_plan_month not between 1 and 36 then raise exception 'Spare sale plan month must be between 1 and 36.'; end if;
  if p_quantity<=0 then raise exception 'Spare sale quantity must be greater than zero.'; end if;
  if p_unit_price_inr<=0 then raise exception 'Spare sale unit price must be greater than zero.'; end if;
  if p_channel not in ('direct','dealer','online') then raise exception 'Controlled spare sale channel is required.'; end if;
  if trim(coalesce(p_source_reference,''))='' then raise exception 'Spare sale evidence/reference is required.'; end if;
  if p_dispatch_on is null then raise exception 'Spare dispatch date is required.'; end if;

  perform pg_advisory_xact_lock(hashtext('spare-sale|'||p_id)::bigint);
  if exists(select 1 from vyndi_spare_sales where id=p_id) then
    return query select s.id,a.available_to_promise,s.fifo_cost_inr
      from vyndi_spare_sales s
      left join vyndi_inventory_available_to_promise a on a.sku=s.sku and a.unit=vyndi_canonical_unit(s.unit)
     where s.id=p_id and s.status='dispatched';
    if found then return; end if;
    raise exception 'Spare sale id already exists with different state.';
  end if;

  select id,sku,name,unit,traceability_class into i
    from master_inventory_items
   where id=p_inventory_item_id and active=true and ledger_id='components';
  if not found then raise exception 'Active component inventory item not found.'; end if;

  if v_selected is not null and not exists(
    select 1 from vyndi_identity_registry r
     where r.identity_uid=v_selected and r.status='active'
       and upper(trim(r.part_sku))=upper(trim(i.sku))
  ) then
    raise exception 'Selected controlled identity does not belong to active SKU %.',i.sku;
  end if;
  if i.traceability_class='A' and p_quantity<>1 then
    raise exception 'Class A serialized spare sales must be dispatched one identity at a time.';
  end if;

  select x.resulting_balance,x.fifo_value_inr into v_balance,v_fifo
    from post_vyndi_inventory_issue(
      v_movement_id,v_ledger_id,i.sku,p_quantity,i.unit,p_dispatch_on,
      trim(p_source_reference),'Spare/component customer dispatch '||p_id,p_actor_user_id,p_actor_role
    ) x;

  select coalesce(jsonb_agg(
           jsonb_build_object(
             'identityUid',q.identity_uid,
             'visibleId',q.visible_id,
             'oemPartNumber',q.oem_part_number,
             'oemSerialNumber',q.oem_serial_number,
             'supplierLot',q.supplier_lot,
             'quantity',q.quantity
           ) order by q.visible_id nulls last,q.supplier_lot nulls last
         ),'[]'::jsonb),
         count(q.identity_uid),
         min(q.identity_uid)
    into v_allocations,v_allocated_identity_count,v_inferred_identity
    from (
      select rm.identity_uid,ir.visible_id,
             nullif(rm.oem_part_number,'') as oem_part_number,
             nullif(rm.oem_serial_number,'') as oem_serial_number,
             nullif(rm.supplier_lot,'') as supplier_lot,
             sum(a.quantity) as quantity
        from epr_inventory_fifo_allocations a
        join epr_inventory_fifo_layers fl on fl.id=a.layer_id
        join epr_inventory_ledger receipt_ledger on receipt_ledger.id=fl.source_ledger_id
        left join vyndi_inventory_receipt_metadata rm on rm.movement_id=receipt_ledger.movement_id
        left join vyndi_identity_registry ir on ir.identity_uid=rm.identity_uid
       where a.issue_ledger_id=v_ledger_id
       group by rm.identity_uid,ir.visible_id,rm.oem_part_number,rm.oem_serial_number,rm.supplier_lot
    ) q;

  if v_selected is not null and not exists(
    select 1
      from epr_inventory_fifo_allocations a
      join epr_inventory_fifo_layers fl on fl.id=a.layer_id
      join epr_inventory_ledger receipt_ledger on receipt_ledger.id=fl.source_ledger_id
      join vyndi_inventory_receipt_metadata rm on rm.movement_id=receipt_ledger.movement_id
     where a.issue_ledger_id=v_ledger_id and rm.identity_uid=v_selected
  ) then
    raise exception 'Selected identity is not in the governed FIFO allocation for this sale. FIFO authority was not bypassed.';
  end if;

  if i.traceability_class='A' then
    if v_selected is null then
      if v_allocated_identity_count<>1 or v_inferred_identity is null then
        raise exception 'Class A spare requires exactly one controlled identity in the FIFO allocation.';
      end if;
      v_selected:=v_inferred_identity;
    end if;
  end if;

  insert into vyndi_spare_sales(
    id,plan_month,inventory_item_id,sku,item_name,unit,quantity,unit_price_inr,channel,
    traceability_class,selected_identity_uid,allocated_identity_refs,
    inventory_movement_id,inventory_ledger_id,fifo_cost_inr,status,source_reference,posted_by,dispatch_on)
  values(
    p_id,p_plan_month,i.id,upper(trim(i.sku)),i.name,vyndi_canonical_unit(i.unit),p_quantity,p_unit_price_inr,p_channel,
    i.traceability_class,v_selected,v_allocations,
    v_movement_id,v_ledger_id,v_fifo,'dispatched',trim(p_source_reference),p_actor_user_id,p_dispatch_on);

  if v_fifo>0 then
    perform post_vyndi_finance_journal(
      'FIN-SPARE-COGS-'||p_id,p_dispatch_on,'spare_dispatch_cogs',p_id,
      'FIFO COGS for spare/component dispatch '||p_id,
      jsonb_build_array(
        jsonb_build_object('accountCode','5000','debitInr',v_fifo,'memo','Spare/component FIFO cost of goods sold'),
        jsonb_build_object('accountCode','1200','creditInr',v_fifo,'memo','Component inventory released')
      )
    );
  end if;

  insert into vyndi_audit_events(
    id,entity_type,entity_id,entity_revision,action,actor_user_id,actor_role,source_reference,payload_json)
  values(
    'AUD-SPARE-'||p_id||'-R1','spare_sale',p_id,1,'dispatched',p_actor_user_id,p_actor_role,trim(p_source_reference),
    jsonb_build_object('sku',i.sku,'quantity',p_quantity,'unitPriceInr',p_unit_price_inr,'fifoCostInr',v_fifo,
      'resultingBalance',v_balance,'traceabilityClass',i.traceability_class,'selectedIdentityUid',v_selected,
      'allocatedIdentityRefs',v_allocations)
  );

  return query select p_id,v_balance,v_fifo;
end;
$$;

create or replace function reverse_vyndi_spare_sale_dispatch(
  p_id text,p_reason text,p_actor_user_id text,p_actor_role text
) returns integer
language plpgsql
as $$
declare
  s vyndi_spare_sales%rowtype;
  v_revision integer;
  v_return_movement text:='SPARE-RET-'||p_id;
  v_return_ledger text:='SPARE-RETLED-'||p_id;
  v_unit_cost numeric;
begin
  if trim(coalesce(p_reason,''))='' then raise exception 'Spare dispatch reversal reason is required.'; end if;
  perform pg_advisory_xact_lock(hashtext('spare-sale|'||p_id)::bigint);
  select * into s from vyndi_spare_sales where id=p_id for update;
  if not found then raise exception 'Spare sale not found.'; end if;
  if s.status='reversed' then return s.revision; end if;
  if exists(select 1 from vyndi_invoices where spare_sale_id=p_id and status='issued') then
    raise exception 'Void the issued spare/component invoice before reversing its inventory dispatch.';
  end if;

  v_unit_cost:=case when s.quantity>0 then round(s.fifo_cost_inr/s.quantity,2) else 0 end;
  perform pg_advisory_xact_lock(hashtext(upper(trim(s.sku))||'|'||vyndi_canonical_unit(s.unit))::bigint);

  insert into epr_inventory_movements
    (id,traveller_id,venture,sku,movement_type,quantity,unit,reference,notes,recorded_by,effective_on)
  values
    (v_return_movement,null,'shared',s.sku,'return',s.quantity,s.unit,
     'Spare sale reversal '||p_id,trim(p_reason),p_actor_user_id,current_date);
  insert into epr_inventory_ledger
    (id,venture,sku,unit,quantity_delta,movement_id,traveller_id,serial_number,reference,notes,recorded_by,unit_cost_inr,effective_on)
  values
    (v_return_ledger,'shared',s.sku,s.unit,s.quantity,v_return_movement,null,null,
     'Spare sale reversal '||p_id,trim(p_reason),p_actor_user_id,v_unit_cost,current_date);
  insert into epr_inventory_cost_ledger
    (id,venture,sku,unit,quantity_delta,value_delta_inr,movement_id,traveller_id,unit_cost_inr,reference,recorded_by)
  values
    (v_return_ledger||'-COST','shared',s.sku,s.unit,s.quantity,s.fifo_cost_inr,v_return_movement,null,v_unit_cost,
     'Spare sale reversal '||p_id,p_actor_user_id);

  perform reverse_vyndi_finance_journal(
    'spare_dispatch_cogs',p_id,'FIN-SPARE-COGS-REV-'||p_id,'spare_dispatch_cogs_reversal',current_date,
    'COGS reversal for spare/component dispatch '||p_id
  );

  update vyndi_spare_sales set
    status='reversed',revision=revision+1,reversed_by=p_actor_user_id,reversed_at=now(),reversal_reason=trim(p_reason)
  where id=p_id and status='dispatched' returning revision into v_revision;

  insert into vyndi_audit_events(
    id,entity_type,entity_id,entity_revision,action,actor_user_id,actor_role,source_reference,payload_json)
  values(
    'AUD-SPARE-'||p_id||'-R'||v_revision,'spare_sale',p_id,v_revision,'reversed',p_actor_user_id,p_actor_role,trim(p_reason),
    jsonb_build_object('quantityReturned',s.quantity,'inventoryReturnLedgerId',v_return_ledger,'fifoCostReversedInr',s.fifo_cost_inr)
  );
  return v_revision;
end;
$$;

create or replace function issue_vyndi_spare_credit_tax_invoice(
  p_id text,p_spare_sale_id text,p_source_reference text,
  p_recipient_name text,p_recipient_gstin text,p_recipient_address text,p_delivery_address text,
  p_place_of_supply_code text,p_hsn_sac text,p_item_description text,p_unit_code text,
  p_tax_rate_pct numeric,p_tax_mode text,p_reverse_charge boolean,p_e_invoice_required boolean,
  p_irn text,p_irn_ack_number text,p_irn_ack_at timestamptz,p_tax_evidence_reference text,
  p_credit_terms_days integer,p_credit_terms_reference text,
  p_actor_user_id text,p_actor_role text
) returns table(invoice_id text,amount_lakh numeric,gross_amount_inr numeric,due_on date)
language plpgsql
as $$
declare
  s vyndi_spare_sales%rowtype;
  v_taxable numeric; v_cgst numeric:=0; v_sgst numeric:=0; v_igst numeric:=0; v_gst numeric:=0; v_gross numeric;
  v_amount_lakh numeric; v_due date;
begin
  if trim(coalesce(p_source_reference,''))='' then raise exception 'Invoice source reference is required.'; end if;
  if trim(coalesce(p_recipient_name,''))='' then raise exception 'Invoice recipient name is required.'; end if;
  if trim(coalesce(p_recipient_address,''))='' or trim(coalesce(p_delivery_address,''))='' then raise exception 'Invoice and delivery addresses are required.'; end if;
  if trim(coalesce(p_place_of_supply_code,'')) !~ '^[0-9]{2}$' then raise exception 'Place of supply must be a two-digit State code.'; end if;
  if trim(coalesce(p_hsn_sac,''))='' then raise exception 'HSN/SAC is required.'; end if;
  if trim(coalesce(p_item_description,''))='' then raise exception 'Invoice item description is required.'; end if;
  if p_tax_mode not in ('cgst_sgst','igst','zero_rated','exempt') then raise exception 'Controlled GST tax mode is required.'; end if;
  if p_tax_rate_pct<0 then raise exception 'GST rate cannot be negative.'; end if;
  if p_tax_mode in ('zero_rated','exempt') and p_tax_rate_pct<>0 then raise exception 'Zero-rated/exempt invoice must use zero tax rate.'; end if;
  if p_e_invoice_required and (trim(coalesce(p_irn,''))='' or trim(coalesce(p_irn_ack_number,''))='' or p_irn_ack_at is null) then
    raise exception 'IRN, acknowledgement number and acknowledgement timestamp are required when e-invoice is applicable.';
  end if;
  if trim(coalesce(p_tax_evidence_reference,''))='' then raise exception 'Tax evidence reference is required.'; end if;
  if p_credit_terms_days not between 0 and 365 then raise exception 'Credit terms must be between 0 and 365 days.'; end if;
  if trim(coalesce(p_credit_terms_reference,''))='' then raise exception 'Credit terms evidence/reference is required.'; end if;
  if not exists(select 1 from epr_finance_tax_registration where id='PRIMARY') then
    raise exception 'Primary GST registration/tax profile must be configured before issuing a controlled tax invoice.';
  end if;

  perform pg_advisory_xact_lock(hashtext('invoice|'||p_id)::bigint);
  if exists(select 1 from vyndi_invoices where id=p_id) then
    return query select i.id,i.amount_lakh,i.gross_amount_inr,i.due_on
      from vyndi_invoices i
     where i.id=p_id and i.spare_sale_id=p_spare_sale_id and i.status='issued' and i.sale_type='spare_component';
    if found then return; end if;
    raise exception 'Invoice id already exists with different state.';
  end if;

  select * into s from vyndi_spare_sales where id=p_spare_sale_id and status='dispatched';
  if not found then raise exception 'Posted spare/component dispatch not found.'; end if;
  if exists(select 1 from vyndi_invoices where spare_sale_id=p_spare_sale_id) then
    raise exception 'Spare/component dispatch already has an invoice record.';
  end if;

  v_taxable:=round(s.quantity*s.unit_price_inr,2);
  if p_tax_mode='cgst_sgst' then
    v_cgst:=round(v_taxable*p_tax_rate_pct/200,2);
    v_sgst:=round(v_taxable*p_tax_rate_pct/200,2);
  elsif p_tax_mode='igst' then
    v_igst:=round(v_taxable*p_tax_rate_pct/100,2);
  end if;
  v_gst:=v_cgst+v_sgst+v_igst;
  v_gross:=round(v_taxable+v_gst,2);
  v_amount_lakh:=round(v_taxable/100000.0,4);
  v_due:=current_date+p_credit_terms_days;

  insert into vyndi_invoices(
    id,shipment_id,sales_order_id,plan_month,units,asp_lakh,amount_lakh,status,source_reference,issued_by,
    recipient_name,recipient_gstin,recipient_address,delivery_address,place_of_supply_code,hsn_sac,item_description,unit_code,
    taxable_value_inr,tax_rate_pct,tax_mode,cgst_inr,sgst_inr,igst_inr,gst_inr,gross_amount_inr,reverse_charge,
    e_invoice_required,irn,irn_ack_number,irn_ack_at,tax_evidence_reference,tax_profile_status,
    credit_terms_days,due_on,credit_terms_reference,credit_profile_status,sale_type,spare_sale_id)
  values(
    p_id,null,null,s.plan_month,s.quantity,round(s.unit_price_inr/100000.0,4),v_amount_lakh,'issued',trim(p_source_reference),p_actor_user_id,
    trim(p_recipient_name),nullif(trim(coalesce(p_recipient_gstin,'')),''),trim(p_recipient_address),trim(p_delivery_address),
    trim(p_place_of_supply_code),trim(p_hsn_sac),trim(p_item_description),coalesce(nullif(trim(p_unit_code),''),'NOS'),
    v_taxable,p_tax_rate_pct,p_tax_mode,v_cgst,v_sgst,v_igst,v_gst,v_gross,p_reverse_charge,
    p_e_invoice_required,nullif(trim(coalesce(p_irn,'')),''),nullif(trim(coalesce(p_irn_ack_number,'')),''),p_irn_ack_at,
    trim(p_tax_evidence_reference),'complete',p_credit_terms_days,v_due,trim(p_credit_terms_reference),'controlled','spare_component',s.id);

  insert into vyndi_audit_events(
    id,entity_type,entity_id,entity_revision,action,actor_user_id,actor_role,source_reference,payload_json)
  values(
    'AUD-INV-'||p_id||'-R1','invoice',p_id,1,'issued_spare_component',p_actor_user_id,p_actor_role,trim(p_source_reference),
    jsonb_build_object('invoiceId',p_id,'spareSaleId',s.id,'sku',s.sku,'quantity',s.quantity,
      'taxableValueInr',v_taxable,'gstInr',v_gst,'grossAmountInr',v_gross,'dueOn',v_due,'creditTermsDays',p_credit_terms_days)
  );

  return query select p_id,v_amount_lakh,v_gross,v_due;
end;
$$;

-- Actual Sales Ledger: invoices are the sale-recognition event. It intentionally excludes
-- leads, forecasts and un-invoiced orders. Collections remain separate settlement events.
create or replace view vyndi_report_sales_ledger as
with collected as (
  select invoice_id,round(coalesce(sum(amount_lakh) filter(where status='posted'),0)*100000,2) as collected_inr
    from vyndi_collections group by invoice_id
)
select
  i.id as invoice_id,
  i.issued_at::date as issued_on,
  i.plan_month,
  i.sale_type,
  coalesce(o.channel,s.channel) as channel,
  i.recipient_name as customer_name,
  i.recipient_gstin as customer_gstin,
  i.sales_order_id,
  i.shipment_id,
  i.spare_sale_id,
  case when i.sale_type='spare_component' then s.sku else coalesce(o.variant_name,o.variant_id,o.product_id) end as item_reference,
  i.item_description,
  i.units as quantity,
  i.unit_code,
  ident.visible_id as vyndi_identity,
  ident.oem_part_number,
  ident.oem_serial_number,
  ident.supplier_lot,
  case when i.sale_type='spare_component' then s.allocated_identity_refs else '[]'::jsonb end as allocation_identity_refs,
  round(coalesce(i.taxable_value_inr,i.amount_lakh*100000),2) as taxable_value_inr,
  round(coalesce(i.gst_inr,0),2) as gst_inr,
  round(case when coalesce(i.gross_amount_inr,0)>0 then i.gross_amount_inr else i.amount_lakh*100000 end,2) as gross_amount_inr,
  coalesce(c.collected_inr,0)::numeric(18,2) as collected_inr,
  greatest(round(case when coalesce(i.gross_amount_inr,0)>0 then i.gross_amount_inr else i.amount_lakh*100000 end,2)-coalesce(c.collected_inr,0),0)::numeric(18,2) as balance_inr,
  case
    when i.status='void' then 'void'
    when coalesce(c.collected_inr,0)<=0 then 'unpaid'
    when coalesce(c.collected_inr,0)+0.01 >= round(case when coalesce(i.gross_amount_inr,0)>0 then i.gross_amount_inr else i.amount_lakh*100000 end,2) then 'paid'
    else 'part_paid'
  end as payment_status,
  i.credit_terms_days,
  i.due_on,
  case
    when i.status='void' then 'VOID'
    when i.credit_profile_status<>'controlled' or i.due_on is null then 'LEGACY_NO_TERMS'
    when i.due_on>=current_date then 'CURRENT'
    when current_date-i.due_on>90 then 'OVER_90'
    when current_date-i.due_on>60 then 'OVER_60'
    when current_date-i.due_on>30 then 'OVER_30'
    else 'OVERDUE'
  end as aging_bucket,
  case when i.sale_type='spare_component' then s.fifo_cost_inr else null end as fifo_cogs_inr,
  case when i.sale_type='spare_component' then round(coalesce(i.taxable_value_inr,i.amount_lakh*100000)-s.fifo_cost_inr,2) else null end as gross_margin_inr,
  i.status as invoice_status,
  i.source_reference
from vyndi_invoices i
left join vyndi_sales_orders o on o.id=i.sales_order_id
left join vyndi_spare_sales s on s.id=i.spare_sale_id
left join vyndi_identity_registry ident on ident.identity_uid=s.selected_identity_uid
left join collected c on c.invoice_id=i.id;

create or replace view vyndi_report_sales_summary as
select
  plan_month,
  sale_type,
  count(*) filter(where invoice_status='issued')::integer as invoice_count,
  round(coalesce(sum(taxable_value_inr) filter(where invoice_status='issued'),0),2) as taxable_sales_inr,
  round(coalesce(sum(gst_inr) filter(where invoice_status='issued'),0),2) as output_gst_inr,
  round(coalesce(sum(gross_amount_inr) filter(where invoice_status='issued'),0),2) as gross_sales_inr,
  round(coalesce(sum(collected_inr) filter(where invoice_status='issued'),0),2) as collected_inr,
  round(coalesce(sum(balance_inr) filter(where invoice_status='issued'),0),2) as open_receivable_inr
from vyndi_report_sales_ledger
group by plan_month,sale_type
order by plan_month,sale_type;

-- Revenue includes every issued sale. Operational "units" remain bicycle units only so
-- aftermarket quantities cannot corrupt bicycle demand, capacity or production analytics.
create or replace view vyndi_monthly_transaction_actuals as
with months as (select generate_series(1,36)::integer as plan_month),
invoice_month as (
  select plan_month,
         sum(amount_lakh)::numeric(18,4) revenue,
         coalesce(sum(units) filter(where sale_type='bicycle'),0)::numeric(14,4) units
    from vyndi_invoices where status='issued' group by plan_month
),
invoice_cume as (
  select m.plan_month,
         coalesce((select sum(case when i.gross_amount_inr>0 then i.gross_amount_inr/100000.0 else i.amount_lakh end)
                     from vyndi_invoices i where i.status='issued' and i.plan_month<=m.plan_month),0)::numeric(18,4) invoiced
    from months m
),
collection_cume as (
  select m.plan_month,
         coalesce((select sum(c.amount_lakh) from vyndi_collections c where c.status='posted' and c.plan_month<=m.plan_month),0)::numeric(18,4) collected
    from months m
)
select m.plan_month,
       coalesce(im.revenue,0)::numeric(18,4) revenue,
       coalesce(im.units,0)::numeric(14,4) units,
       greatest(ic.invoiced-cc.collected,0)::numeric(18,4) receivables
  from months m
  left join invoice_month im using(plan_month)
  join invoice_cume ic using(plan_month)
  join collection_cume cc using(plan_month);

comment on view vyndi_report_sales_ledger is
  'Actual invoiced Sales Ledger across bicycles and spare/components. Forecasts, leads and un-invoiced orders are excluded.';
comment on view vyndi_monthly_transaction_actuals is
  'Canonical transaction-derived financial actuals. Revenue/AR include all issued sale types; units count bicycles only.';
