-- DOC 04 Rev 1.2 operationalisation at the GRN / incoming-inspection boundary.
-- Purchased identities are captured even while material is quarantined or rejected.
-- A VYNDI internal reference is materialised only when an accepted inventory movement exists.

alter table vyndi_goods_receipts add column if not exists traceability_class text not null default 'C';
alter table vyndi_goods_receipts add column if not exists internal_identity_prefix text not null default '';
alter table vyndi_goods_receipts add column if not exists identity_uid uuid references vyndi_identity_registry(identity_uid) on delete restrict;
alter table vyndi_goods_receipts add column if not exists vyndi_internal_reference text not null default '';
alter table vyndi_goods_receipts add column if not exists manufacturer text not null default '';
alter table vyndi_goods_receipts add column if not exists brand text not null default '';
alter table vyndi_goods_receipts add column if not exists oem_model_number text not null default '';
alter table vyndi_goods_receipts add column if not exists oem_part_number text not null default '';
alter table vyndi_goods_receipts add column if not exists oem_serial_number text not null default '';
alter table vyndi_goods_receipts add column if not exists supplier_sku text not null default '';
alter table vyndi_goods_receipts add column if not exists supplier_lot text not null default '';
alter table vyndi_goods_receipts add column if not exists invoice_reference text not null default '';
alter table vyndi_goods_receipts add column if not exists warranty_reference text not null default '';
alter table vyndi_goods_receipts add column if not exists calibration_reference text not null default '';

create index if not exists vyndi_goods_receipts_oem_serial_idx
  on vyndi_goods_receipts(oem_serial_number) where oem_serial_number<>'';
create index if not exists vyndi_goods_receipts_supplier_lot_idx
  on vyndi_goods_receipts(supplier_lot) where supplier_lot<>'';
create index if not exists vyndi_goods_receipts_identity_uid_idx
  on vyndi_goods_receipts(identity_uid) where identity_uid is not null;

create or replace function materialise_vyndi_goods_receipt_identity(
  p_grn_id text,
  p_actor text
) returns table (identity_uid uuid,internal_reference text)
language plpgsql
as $$
declare
  r record;
  bound record;
begin
  select * into r from vyndi_goods_receipts where id=upper(trim(p_grn_id)) for update;
  if not found then raise exception 'Goods receipt % does not exist.',p_grn_id; end if;

  -- Rejected/quarantined material retains its OEM identity on the GRN but does
  -- not receive an inventory identity until there is an accepted stock movement.
  if r.inventory_movement_id is null then
    return query select null::uuid,''::text;
    return;
  end if;

  if r.identity_uid is not null then
    return query select r.identity_uid,r.vyndi_internal_reference;
    return;
  end if;

  select * into bound
    from register_vyndi_inventory_receipt_identity(
      r.inventory_movement_id,
      r.traceability_class,
      r.internal_identity_prefix,
      r.manufacturer,
      r.brand,
      r.oem_model_number,
      r.oem_part_number,
      r.oem_serial_number,
      r.supplier_sku,
      r.supplier_lot,
      r.invoice_reference,
      r.id,
      r.warranty_reference,
      r.calibration_reference,
      p_actor
    );

  update vyndi_goods_receipts
     set identity_uid=bound.identity_uid,
         vyndi_internal_reference=bound.internal_reference
   where id=r.id;

  return query select bound.identity_uid,bound.internal_reference;
end;
$$;

create or replace function attach_vyndi_goods_receipt_identity(
  p_grn_id text,
  p_traceability_class text,
  p_internal_prefix text,
  p_manufacturer text,
  p_brand text,
  p_oem_model_number text,
  p_oem_part_number text,
  p_oem_serial_number text,
  p_supplier_sku text,
  p_supplier_lot text,
  p_invoice_reference text,
  p_warranty_reference text,
  p_calibration_reference text,
  p_actor_user_id text,
  p_actor_role text
) returns table (identity_uid uuid,internal_reference text)
language plpgsql
as $$
declare
  v_grn text:=upper(trim(coalesce(p_grn_id,'')));
  v_class text:=upper(trim(coalesce(p_traceability_class,'C')));
  v_prefix text:=upper(trim(coalesce(p_internal_prefix,'')));
  bound record;
begin
  if v_class not in ('A','B','C') then raise exception 'Traceability class must be A, B or C.'; end if;
  if v_prefix<>'' and v_prefix not in ('AST','EQP','TOL','SPR','CON','ITM') then
    raise exception 'Internal identity prefix must be AST, EQP, TOL, SPR, CON or ITM.';
  end if;
  if not exists(select 1 from vyndi_goods_receipts where id=v_grn) then
    raise exception 'Goods receipt % does not exist.',v_grn;
  end if;

  update vyndi_goods_receipts set
    traceability_class=v_class,
    internal_identity_prefix=v_prefix,
    manufacturer=trim(coalesce(p_manufacturer,'')),
    brand=trim(coalesce(p_brand,'')),
    oem_model_number=trim(coalesce(p_oem_model_number,'')),
    oem_part_number=trim(coalesce(p_oem_part_number,'')),
    oem_serial_number=trim(coalesce(p_oem_serial_number,'')),
    supplier_sku=trim(coalesce(p_supplier_sku,'')),
    supplier_lot=trim(coalesce(p_supplier_lot,'')),
    invoice_reference=trim(coalesce(p_invoice_reference,'')),
    warranty_reference=trim(coalesce(p_warranty_reference,'')),
    calibration_reference=trim(coalesce(p_calibration_reference,''))
  where id=v_grn;

  insert into vyndi_audit_events
    (id,entity_type,entity_id,action,actor_user_id,actor_role,source_reference,payload_json)
  values
    ('AUD-GRN-ID-'||substr(md5(v_grn||clock_timestamp()::text),1,16),
     'goods_receipt',v_grn,'purchased_identity_captured',p_actor_user_id,p_actor_role,'DOC04-REV1.2',
     jsonb_build_object(
       'traceabilityClass',v_class,
       'internalPrefix',v_prefix,
       'manufacturer',trim(coalesce(p_manufacturer,'')),
       'brand',trim(coalesce(p_brand,'')),
       'oemModelNumber',trim(coalesce(p_oem_model_number,'')),
       'oemPartNumber',trim(coalesce(p_oem_part_number,'')),
       'oemSerialNumber',trim(coalesce(p_oem_serial_number,'')),
       'supplierSku',trim(coalesce(p_supplier_sku,'')),
       'supplierLot',trim(coalesce(p_supplier_lot,'')),
       'invoiceReference',trim(coalesce(p_invoice_reference,'')),
       'warrantyReference',trim(coalesce(p_warranty_reference,'')),
       'calibrationReference',trim(coalesce(p_calibration_reference,''))
     ));

  select * into bound from materialise_vyndi_goods_receipt_identity(v_grn,p_actor_user_id);
  return query select bound.identity_uid,bound.internal_reference;
end;
$$;

-- One database statement owns GRN creation plus external-identity capture. If
-- either half fails, the whole operation rolls back; no orphan GRN is left for
-- an operator to repair manually.
create or replace function post_vyndi_goods_receipt_with_identity(
  p_id text,
  p_purchase_order_id text,
  p_received_on date,
  p_quantity_received numeric,
  p_quantity_accepted numeric,
  p_quantity_rejected numeric,
  p_inspection_status text,
  p_source_reference text,
  p_notes text,
  p_actor_user_id text,
  p_actor_role text,
  p_traceability_class text,
  p_internal_prefix text,
  p_manufacturer text,
  p_brand text,
  p_oem_model_number text,
  p_oem_part_number text,
  p_oem_serial_number text,
  p_supplier_sku text,
  p_supplier_lot text,
  p_invoice_reference text,
  p_warranty_reference text,
  p_calibration_reference text
) returns table (grn_id text,identity_uid uuid,internal_reference text)
language plpgsql
as $$
declare
  v_grn text;
  bound record;
begin
  v_grn:=post_vyndi_goods_receipt(
    p_id,p_purchase_order_id,p_received_on,p_quantity_received,p_quantity_accepted,p_quantity_rejected,
    p_inspection_status,p_source_reference,p_notes,p_actor_user_id,p_actor_role
  );

  select * into bound from attach_vyndi_goods_receipt_identity(
    v_grn,p_traceability_class,p_internal_prefix,p_manufacturer,p_brand,p_oem_model_number,
    p_oem_part_number,p_oem_serial_number,p_supplier_sku,p_supplier_lot,p_invoice_reference,
    p_warranty_reference,p_calibration_reference,p_actor_user_id,p_actor_role
  );

  return query select v_grn,bound.identity_uid,bound.internal_reference;
end;
$$;

create or replace function resolve_vyndi_goods_receipt_with_identity(
  p_id text,
  p_resolution text,
  p_resolved_on date,
  p_source_reference text,
  p_actor_user_id text,
  p_actor_role text
) returns table (grn_id text,identity_uid uuid,internal_reference text)
language plpgsql
as $$
declare
  bound record;
begin
  perform resolve_vyndi_goods_receipt(
    p_id,p_resolution,p_resolved_on,p_source_reference,p_actor_user_id,p_actor_role
  );

  if lower(trim(p_resolution))='accepted' then
    select * into bound from materialise_vyndi_goods_receipt_identity(p_id,p_actor_user_id);
  else
    bound:=null;
  end if;

  return query select upper(trim(p_id)),bound.identity_uid,bound.internal_reference;
end;
$$;

create or replace view vyndi_goods_receipt_identity_register as
select
  r.id as grn_id,
  r.purchase_order_id,
  r.received_on,
  p.supplier_id,
  p.sku,
  p.unit,
  r.inspection_status,
  r.traceability_class,
  r.vyndi_internal_reference,
  r.identity_uid,
  r.manufacturer,
  r.brand,
  r.oem_model_number,
  r.oem_part_number,
  r.oem_serial_number,
  r.supplier_sku,
  r.supplier_lot,
  r.invoice_reference,
  r.warranty_reference,
  r.calibration_reference,
  r.source_reference,
  r.inventory_movement_id
from vyndi_goods_receipts r
join vyndi_purchase_orders p on p.id=r.purchase_order_id;

comment on function attach_vyndi_goods_receipt_identity(text,text,text,text,text,text,text,text,text,text,text,text,text,text,text) is
  'Captures manufacturer/OEM/supplier identity verbatim on the GRN and materialises a separate VYNDI internal reference only when accepted stock exists.';
comment on function post_vyndi_goods_receipt_with_identity(text,text,date,numeric,numeric,numeric,text,text,text,text,text,text,text,text,text,text,text,text,text,text,text,text,text) is
  'Atomically posts a GRN and captures DOC 04 Rev 1.2 purchased-item identity. Accepted stock receives a separate VYNDI internal reference; quarantined/rejected stock retains external identity on the GRN.';
