-- Enterprise authority closure
-- 1) Canonical Quality release gate across native Quality + EPR evidence.
-- 2) Atomic Maintenance completion with canonical FIFO inventory consumption.

create or replace view vyndi_quality_canonical_inspection_evidence as
select
  i.id as evidence_id,
  'quality'::text as source_system,
  i.traveller_id,
  i.inspection_type as evidence_kind,
  i.result,
  i.evidence_ref as evidence_reference,
  i.recorded_at,
  (i.inspection_stage='final') as is_release_final
from vyndi_quality_inspections i
where i.traveller_id is not null
union all
select
  e.id as evidence_id,
  'epr'::text as source_system,
  e.traveller_id,
  e.inspection_type as evidence_kind,
  e.result,
  e.evidence_reference,
  e.inspected_at as recorded_at,
  false as is_release_final
from epr_inspections e;

comment on view vyndi_quality_canonical_inspection_evidence is
  'Canonical read model across native Quality and EPR inspection writers. Final release remains owned only by vyndi_quality_releases.';

create or replace function vyndi_quality_release_gate(p_traveller_id text)
returns table (
  can_release boolean,
  blocking_reason text,
  final_inspection_id text,
  final_result text,
  final_recorded_at timestamptz
)
language plpgsql
as $$
declare
  v_final_id text;
  v_final_result text;
  v_final_recorded_at timestamptz;
begin
  select id,result,recorded_at
    into v_final_id,v_final_result,v_final_recorded_at
    from vyndi_quality_inspections
   where traveller_id=p_traveller_id
     and inspection_stage='final'
   order by recorded_at desc,id desc
   limit 1;

  if v_final_id is null then
    return query
      select false,
             'Quality release requires a latest effective final inspection.'::text,
             null::text,null::text,null::timestamptz;
    return;
  end if;

  if v_final_result<>'pass' then
    return query
      select false,
             ('Latest effective final inspection is ' || v_final_result || '; a newer passing final inspection is required.')::text,
             v_final_id,v_final_result,v_final_recorded_at;
    return;
  end if;

  if exists (
    select 1
      from epr_inspections
     where traveller_id=p_traveller_id
       and inspected_at > v_final_recorded_at
       and result in ('fail','conditional','pending')
  ) then
    return query
      select false,
             'Adverse EPR inspection evidence exists after the latest passing final inspection.'::text,
             v_final_id,v_final_result,v_final_recorded_at;
    return;
  end if;

  if exists (
    select 1 from epr_ncr_capa
     where traveller_id=p_traveller_id
       and status not in ('closed','rejected')
  ) then
    return query
      select false,
             'Quality release is blocked by an unresolved EPR NCR/CAPA record.'::text,
             v_final_id,v_final_result,v_final_recorded_at;
    return;
  end if;

  if exists (
    select 1 from vyndi_quality_ncrs
     where traveller_id=p_traveller_id
       and status not in ('closed','rejected')
  ) or exists (
    select 1
      from vyndi_quality_capas c
      join vyndi_quality_ncrs n on n.id=c.ncr_id
     where n.traveller_id=p_traveller_id
       and c.status not in ('closed','rejected')
  ) then
    return query
      select false,
             'Quality release is blocked by an open native Quality NCR/CAPA chain.'::text,
             v_final_id,v_final_result,v_final_recorded_at;
    return;
  end if;

  return query
    select true,null::text,v_final_id,v_final_result,v_final_recorded_at;
end;
$$;

comment on function vyndi_quality_release_gate(text) is
  'Single canonical release eligibility gate. The latest native final inspection must pass, and no later adverse EPR evidence or open NCR/CAPA may remain.';

alter table vyndi_maintenance_parts
  add column if not exists unit text,
  add column if not exists inventory_movement_id text references epr_inventory_movements(id) on delete restrict,
  add column if not exists inventory_ledger_id text references epr_inventory_ledger(id) on delete restrict,
  add column if not exists fifo_cost_inr numeric(14,2) check (fifo_cost_inr is null or fifo_cost_inr >= 0);

create index if not exists vyndi_maintenance_parts_inventory_movement_idx
  on vyndi_maintenance_parts(inventory_movement_id)
  where inventory_movement_id is not null;

create or replace function complete_vyndi_maintenance_work_order(
  p_work_order_id text,
  p_root_cause text,
  p_action_taken text,
  p_labour_hours numeric,
  p_external_cost_inr numeric,
  p_evidence_reference text,
  p_return_to_service_reference text,
  p_parts jsonb,
  p_source_reference text,
  p_actor_user_id text,
  p_actor_role text
)
returns table (
  status text,
  release_status text,
  returned_to_service boolean,
  parts_cost_inr numeric
)
language plpgsql
as $$
declare
  v_work record;
  v_plan record;
  v_part jsonb;
  v_issue record;
  v_part_sku text;
  v_part_source text;
  v_item_id text;
  v_unit text;
  v_qty numeric;
  v_part_no integer:=0;
  v_movement_id text;
  v_ledger_id text;
  v_parts_cost numeric:=0;
  v_maintenance_due timestamptz;
  v_calibration_due timestamptz;
  v_equipment record;
  v_active_count integer:=0;
  v_corrective_pending_count integer:=0;
  v_release_status text;
begin
  select equipment_id,plan_id,work_order_type,status
    into v_work
    from vyndi_maintenance_work_orders
   where id=p_work_order_id
   for update;

  if not found then raise exception 'Maintenance work order not found.'; end if;
  if v_work.status<>'in_progress' then
    raise exception 'Only in-progress maintenance work may be completed.';
  end if;
  if v_work.work_order_type='corrective' and nullif(btrim(coalesce(p_root_cause,'')),'') is null then
    raise exception 'Corrective maintenance completion requires root-cause evidence.';
  end if;
  if nullif(btrim(coalesce(p_action_taken,'')),'') is null then
    raise exception 'Maintenance completion requires action-taken evidence.';
  end if;
  if nullif(btrim(coalesce(p_evidence_reference,'')),'') is null then
    raise exception 'Maintenance completion requires an evidence reference.';
  end if;
  if nullif(btrim(coalesce(p_return_to_service_reference,'')),'') is null then
    raise exception 'Maintenance completion requires a return-to-service reference.';
  end if;
  if coalesce(p_external_cost_inr,0)<0 or (p_labour_hours is not null and p_labour_hours<0) then
    raise exception 'Maintenance labour hours and external cost cannot be negative.';
  end if;

  for v_part in
    select value from jsonb_array_elements(coalesce(p_parts,'[]'::jsonb))
  loop
    v_part_no:=v_part_no+1;
    v_part_sku:=upper(btrim(coalesce(v_part->>'sku','')));
    v_part_source:=btrim(coalesce(v_part->>'sourceReference',''));
    begin
      v_qty:=(v_part->>'quantity')::numeric;
    exception when others then
      raise exception 'Maintenance part quantity must be numeric.';
    end;

    if v_part_sku='' or v_qty is null or v_qty<=0 then
      raise exception 'Maintenance part requires a controlled SKU and positive quantity.';
    end if;
    if v_part_source='' then
      raise exception 'Maintenance part source reference is required.';
    end if;

    select id,vyndi_canonical_unit(unit)
      into v_item_id,v_unit
      from master_inventory_items
     where sku=v_part_sku and active=true
     limit 1;
    if not found then
      raise exception 'Maintenance part SKU % is not present in active Master Inventory.',v_part_sku;
    end if;

    v_movement_id:='MAINT-MOV-' || md5(p_work_order_id || '|' || v_part_sku || '|' || v_part_no::text);
    v_ledger_id:='MAINT-LED-' || md5(p_work_order_id || '|' || v_part_sku || '|' || v_part_no::text);

    select *
      into v_issue
      from post_vyndi_inventory_issue(
        v_movement_id,
        v_ledger_id,
        v_part_sku,
        v_qty,
        v_unit,
        current_date,
        'Maintenance work order ' || p_work_order_id,
        v_part_source,
        p_actor_user_id,
        p_actor_role
      );

    v_parts_cost:=v_parts_cost+coalesce(v_issue.fifo_value_inr,0);

    insert into vyndi_maintenance_parts(
      id,work_order_id,sku,quantity,unit,unit_cost_inr,source_reference,recorded_by,
      inventory_movement_id,inventory_ledger_id,fifo_cost_inr
    ) values (
      'MP-' || md5(p_work_order_id || '|' || v_part_sku || '|' || v_part_no::text),
      p_work_order_id,v_part_sku,v_qty,v_unit,
      case when v_qty>0 then round(coalesce(v_issue.fifo_value_inr,0)/v_qty,2) else 0 end,
      v_part_source,p_actor_user_id,v_issue.movement_id,v_issue.ledger_id,coalesce(v_issue.fifo_value_inr,0)
    );
  end loop;

  update vyndi_maintenance_work_orders
     set status='completed',
         root_cause=p_root_cause,
         action_taken=p_action_taken,
         completed_at=now(),
         downtime_ended_at=coalesce(downtime_ended_at,now()),
         labour_hours=p_labour_hours,
         parts_cost_inr=round(v_parts_cost,2),
         external_cost_inr=coalesce(p_external_cost_inr,0),
         evidence_reference=p_evidence_reference,
         return_to_service_reference=p_return_to_service_reference,
         completed_by=p_actor_user_id,
         record_revision=record_revision+1,
         updated_at=now()
   where id=p_work_order_id;

  if v_work.plan_id is not null then
    select strategy,interval_days
      into v_plan
      from vyndi_maintenance_plans
     where id=v_work.plan_id
       and equipment_id=v_work.equipment_id
       and active=true
     limit 1;

    if found and v_plan.interval_days is not null then
      update vyndi_maintenance_plans
         set next_due_at=now()+(v_plan.interval_days::text || ' days')::interval,
             record_revision=record_revision+1,
             updated_by=p_actor_user_id,
             updated_at=now()
       where id=v_work.plan_id;
    end if;

    if found and v_plan.strategy='calibration' then
      update epr_equipment set last_calibrated_at=now() where id=v_work.equipment_id;
    else
      update epr_equipment set last_maintained_at=now() where id=v_work.equipment_id;
    end if;
  elsif v_work.work_order_type='calibration' then
    update epr_equipment set last_calibrated_at=now() where id=v_work.equipment_id;
  else
    update epr_equipment set last_maintained_at=now() where id=v_work.equipment_id;
  end if;

  select
    min(next_due_at) filter (where strategy<>'calibration' and next_due_at is not null),
    min(next_due_at) filter (where strategy='calibration' and next_due_at is not null)
    into v_maintenance_due,v_calibration_due
    from vyndi_maintenance_plans
   where equipment_id=v_work.equipment_id and active=true;

  update epr_equipment
     set maintenance_due_at=v_maintenance_due,
         calibration_due_at=case when v_calibration_due is not null then v_calibration_due else calibration_due_at end,
         calibration_required=case when v_calibration_due is not null then true else calibration_required end
   where id=v_work.equipment_id;

  select status,calibration_required,calibration_due_at,maintenance_due_at
    into v_equipment
    from epr_equipment
   where id=v_work.equipment_id
   for update;

  if not found then
    raise exception 'Maintenance equipment identity was not found.';
  elsif v_equipment.status='retired' then
    v_release_status:='retired';
  else
    select
      count(*) filter (where status='in_progress')::int,
      count(*) filter (where work_order_type='corrective' and status in ('draft','scheduled'))::int
      into v_active_count,v_corrective_pending_count
      from vyndi_maintenance_work_orders
     where equipment_id=v_work.equipment_id;

    if v_active_count>0 then
      v_release_status:='maintenance';
    elsif v_corrective_pending_count>0 then
      v_release_status:='quarantined';
    elsif (v_equipment.calibration_required and (v_equipment.calibration_due_at is null or v_equipment.calibration_due_at<=now()))
       or (v_equipment.maintenance_due_at is not null and v_equipment.maintenance_due_at<=now()) then
      v_release_status:='quarantined';
    else
      v_release_status:='available';
    end if;

    update epr_equipment set status=v_release_status
     where id=v_work.equipment_id and status<>'retired';
  end if;

  update vyndi_maintenance_work_orders
     set returned_to_service_by=case when v_release_status='available' then p_actor_user_id else null end
   where id=p_work_order_id;

  insert into vyndi_audit_events(
    id,entity_type,entity_id,action,actor_user_id,actor_role,source_reference,payload_json
  ) values (
    'AUD-MAINT-' || md5(p_work_order_id || clock_timestamp()::text),
    'maintenance_work_order',p_work_order_id,'MAINTENANCE_WORK_ORDER_COMPLETED',
    p_actor_user_id,p_actor_role,p_source_reference,
    jsonb_build_object(
      'equipmentId',v_work.equipment_id,
      'rootCause',p_root_cause,
      'partsCostInr',round(v_parts_cost,2),
      'releaseStatus',v_release_status,
      'inventoryAuthority','post_vyndi_inventory_issue'
    )
  );

  if v_release_status='available' then
    insert into vyndi_audit_events(
      id,entity_type,entity_id,action,actor_user_id,actor_role,source_reference,payload_json
    ) values (
      'AUD-RTS-' || md5(p_work_order_id || clock_timestamp()::text),
      'asset',v_work.equipment_id,'RETURN_TO_SERVICE',
      p_actor_user_id,p_actor_role,p_return_to_service_reference,
      jsonb_build_object('workOrderId',p_work_order_id,'evidenceReference',p_evidence_reference)
    );
  end if;

  return query
    select 'completed'::text,v_release_status,(v_release_status='available'),round(v_parts_cost,2);
end;
$$;

comment on function complete_vyndi_maintenance_work_order(text,text,text,numeric,numeric,text,text,jsonb,text,text,text) is
  'Atomic maintenance closeout. Canonical FIFO issue, part evidence, work-order completion, due-state refresh, return-to-service and audit commit or roll back together.';

comment on table vyndi_maintenance_parts is
  'Maintenance parts-consumption evidence linked to canonical inventory movement/ledger rows. FIFO valuation, not operator-entered cost, is authoritative.';
