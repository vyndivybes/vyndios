-- Replace the spare-dispatch function from 0081 without relying on MIN(uuid).
-- PostgreSQL supports UUID ordering but does not provide built-in MIN/MAX(uuid)
-- on the supported runtime versions. Identity inference therefore uses array_agg.

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
         (array_agg(q.identity_uid order by q.identity_uid::text) filter(where q.identity_uid is not null))[1]
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
