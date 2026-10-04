-- VYNDI Enterprise Digital Thread — serialized dispatch closure
-- Future bicycle shipments require exact released-serial allocation before invoice.
-- Historical shipments remain readable and are not assigned invented serial identities.

alter table vyndi_shipments
  add column if not exists serial_allocation_required boolean not null default false;
-- Existing rows retain false (legacy identity unknown). All future rows default into the governed serialized policy.
alter table vyndi_shipments alter column serial_allocation_required set default true;

alter table vyndi_shipments drop constraint if exists vyndi_shipments_serial_units_check;
alter table vyndi_shipments add constraint vyndi_shipments_serial_units_check
  check (not serial_allocation_required or units=trunc(units));

create table if not exists vyndi_shipment_serial_allocations (
  id text primary key,
  shipment_id text not null references vyndi_shipments(id) on delete restrict,
  quality_release_id text not null references vyndi_quality_releases(id) on delete restrict,
  traveller_id text not null references epr_travellers(id) on delete restrict,
  job_card_id text not null references epr_production_job_cards(id) on delete restrict,
  sales_order_id text not null references vyndi_sales_orders(id) on delete restrict,
  serial_number text not null,
  status text not null default 'active' check (status in ('active','reversed')),
  source_reference text not null,
  revision integer not null default 1 check (revision>0),
  allocated_by text not null,
  allocated_at timestamptz not null default now(),
  reversed_by text,
  reversed_at timestamptz,
  reversal_reason text
);

create index if not exists vyndi_shipment_serial_shipment_idx
  on vyndi_shipment_serial_allocations(shipment_id,status,allocated_at);
create unique index if not exists vyndi_shipment_serial_quality_release_active_uq
  on vyndi_shipment_serial_allocations(quality_release_id) where status='active';
create unique index if not exists vyndi_shipment_serial_traveller_active_uq
  on vyndi_shipment_serial_allocations(traveller_id) where status='active';
create unique index if not exists vyndi_shipment_serial_number_active_uq
  on vyndi_shipment_serial_allocations(serial_number) where status='active';

comment on table vyndi_shipment_serial_allocations is
  'Exact serialized dispatch evidence. One active current Quality Release / Traveller / serial can belong to only one active shipment allocation. Legacy shipments are never assigned invented serials.';

create or replace function allocate_vyndi_shipment_serial(
  p_shipment_id text,
  p_quality_release_id text,
  p_source_reference text,
  p_actor_user_id text,
  p_actor_role text
) returns text
language plpgsql
as $$
declare
  s record;
  q record;
  v_count integer;
  v_existing text;
  v_id text;
begin
  if trim(coalesce(p_source_reference,''))='' then
    raise exception 'Serialized dispatch allocation evidence reference is required.';
  end if;
  perform pg_advisory_xact_lock(hashtext('shipment-serial|'||p_shipment_id)::bigint);

  select id,sales_order_id,job_card_id,units,status,serial_allocation_required
    into s
    from vyndi_shipments
   where id=p_shipment_id
   for update;
  if not found or s.status<>'posted' then
    raise exception 'Posted shipment not found.';
  end if;
  if s.job_card_id is null then
    raise exception 'Serialized dispatch requires a canonical Job Card.';
  end if;

  select id,traveller_id,job_card_id,sales_order_id,serial_number,decision,superseded_at
    into q
    from vyndi_quality_releases
   where id=p_quality_release_id
   for share;
  if not found or q.decision<>'released' or q.superseded_at is not null then
    raise exception 'Serialized dispatch requires a current released Quality Release.';
  end if;
  if q.job_card_id<>s.job_card_id or q.sales_order_id is distinct from s.sales_order_id then
    raise exception 'Quality Release does not belong to this shipment Job Card and Sales Order.';
  end if;

  select id into v_existing
    from vyndi_shipment_serial_allocations
   where quality_release_id=p_quality_release_id and status='active'
   limit 1;
  if found then
    if exists(select 1 from vyndi_shipment_serial_allocations where id=v_existing and shipment_id=p_shipment_id) then
      return v_existing;
    end if;
    raise exception 'Released serial is already allocated to another active shipment.';
  end if;

  select id into v_existing
    from vyndi_shipment_serial_allocations
   where traveller_id=q.traveller_id and status='active'
   limit 1;
  if found then
    raise exception 'Traveller serial already has an active shipment allocation. Reverse the stale/prior allocation before assigning the current Quality Release.';
  end if;

  select count(*)::int into v_count
    from vyndi_shipment_serial_allocations
   where shipment_id=p_shipment_id and status='active';
  if v_count>=s.units then
    raise exception 'Shipment serialized allocation capacity is already complete.';
  end if;

  v_id:='SHIP-SERIAL-'||substr(md5(p_shipment_id||'|'||q.id||'|'||clock_timestamp()::text),1,24);
  insert into vyndi_shipment_serial_allocations(
    id,shipment_id,quality_release_id,traveller_id,job_card_id,sales_order_id,serial_number,
    status,source_reference,allocated_by
  ) values(
    v_id,p_shipment_id,q.id,q.traveller_id,q.job_card_id,q.sales_order_id,q.serial_number,
    'active',trim(p_source_reference),p_actor_user_id
  );

  insert into vyndi_audit_events(
    id,entity_type,entity_id,entity_revision,action,actor_user_id,actor_role,source_reference,payload_json,
    correlation_id,gate_id,gate_result,new_state,reason
  ) values(
    'AUD-'||v_id||'-R1','shipment_serial_allocation',v_id,1,'SHIPMENT_SERIAL_ALLOCATED',
    p_actor_user_id,p_actor_role,trim(p_source_reference),
    jsonb_build_object('shipmentId',p_shipment_id,'qualityReleaseId',q.id,'travellerId',q.traveller_id,
      'serialNumber',q.serial_number,'jobCardId',q.job_card_id,'salesOrderId',q.sales_order_id),
    'SHIPMENT|'||p_shipment_id,'G12-DISPATCH','pass','active','Exact released serial allocated to posted shipment.'
  );
  return v_id;
end;
$$;

create or replace function deallocate_vyndi_shipment_serial(
  p_shipment_id text,
  p_quality_release_id text,
  p_reason text,
  p_actor_user_id text,
  p_actor_role text
) returns integer
language plpgsql
as $$
declare
  a record;
  v_revision integer;
begin
  if trim(coalesce(p_reason,''))='' then
    raise exception 'Serialized dispatch deallocation reason is required.';
  end if;
  perform pg_advisory_xact_lock(hashtext('shipment-serial|'||p_shipment_id)::bigint);
  if exists(select 1 from vyndi_invoices where shipment_id=p_shipment_id and status='issued') then
    raise exception 'Void the linked invoice before changing serialized shipment allocation.';
  end if;

  select * into a
    from vyndi_shipment_serial_allocations
   where shipment_id=p_shipment_id and quality_release_id=p_quality_release_id and status='active'
   for update;
  if not found then
    raise exception 'Active serialized shipment allocation not found.';
  end if;

  update vyndi_shipment_serial_allocations
     set status='reversed',revision=revision+1,reversed_by=p_actor_user_id,reversed_at=now(),
         reversal_reason=trim(p_reason)
   where id=a.id
   returning revision into v_revision;

  insert into vyndi_audit_events(
    id,entity_type,entity_id,entity_revision,action,actor_user_id,actor_role,source_reference,payload_json,
    correlation_id,gate_id,gate_result,previous_state,new_state,reason
  ) values(
    'AUD-'||a.id||'-R'||v_revision,'shipment_serial_allocation',a.id,v_revision,'SHIPMENT_SERIAL_DEALLOCATED',
    p_actor_user_id,p_actor_role,trim(p_reason),
    jsonb_build_object('shipmentId',p_shipment_id,'qualityReleaseId',p_quality_release_id,'serialNumber',a.serial_number),
    'SHIPMENT|'||p_shipment_id,'G12-DISPATCH','fail','active','reversed',trim(p_reason)
  );
  return v_revision;
end;
$$;

create or replace function vyndi_reverse_serial_allocations_with_shipment()
returns trigger
language plpgsql
as $$
declare
  v_count integer;
begin
  if new.status='reversed' and old.status is distinct from 'reversed' then
    update vyndi_shipment_serial_allocations
       set status='reversed',revision=revision+1,reversed_by=coalesce(new.reversed_by,'system'),
           reversed_at=coalesce(new.reversed_at,now()),
           reversal_reason=coalesce(nullif(new.reversal_reason,''),'Shipment reversed')
     where shipment_id=new.id and status='active';
    get diagnostics v_count = row_count;
    if v_count>0 then
      insert into vyndi_audit_events(
        id,entity_type,entity_id,entity_revision,action,actor_user_id,actor_role,source_reference,payload_json,
        correlation_id,gate_id,gate_result,previous_state,new_state,reason
      ) values(
        'AUD-SHIP-SERIAL-REV-'||new.id||'-R'||new.revision,'shipment',new.id,new.revision,
        'SHIPMENT_SERIAL_ALLOCATION_REVERSED',coalesce(new.reversed_by,'system'),'operations',
        coalesce(nullif(new.reversal_reason,''),'Shipment reversed'),
        jsonb_build_object('shipmentId',new.id,'releasedAllocationCount',v_count),
        'SHIPMENT|'||new.id,'G12-DISPATCH','fail','posted','reversed',
        coalesce(nullif(new.reversal_reason,''),'Shipment reversed')
      );
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_vyndi_reverse_serial_allocations_with_shipment on vyndi_shipments;
create trigger trg_vyndi_reverse_serial_allocations_with_shipment
after update of status on vyndi_shipments
for each row execute function vyndi_reverse_serial_allocations_with_shipment();

create or replace function vyndi_require_serialized_dispatch_before_invoice()
returns trigger
language plpgsql
as $$
declare
  s record;
  v_active_serials integer;
begin
  if new.shipment_id is null then return new; end if;

  select id,units,status,serial_allocation_required into s
    from vyndi_shipments
   where id=new.shipment_id;
  if not found then
    raise exception 'Shipment not found for invoice.';
  end if;
  if s.status<>'posted' then
    raise exception 'Invoice requires a posted shipment.';
  end if;
  if not s.serial_allocation_required then return new; end if;

  select count(*)::int into v_active_serials
    from vyndi_shipment_serial_allocations a
    join vyndi_quality_releases q on q.id=a.quality_release_id
   where a.shipment_id=new.shipment_id
     and a.status='active'
     and q.decision='released'
     and q.superseded_at is null;

  if v_active_serials<>s.units then
    raise exception 'Serialized dispatch allocation is incomplete: shipment % requires % current released serial(s), found %.',
      new.shipment_id,s.units,v_active_serials;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_vyndi_require_serialized_dispatch_before_invoice on vyndi_invoices;
create trigger trg_vyndi_require_serialized_dispatch_before_invoice
before insert on vyndi_invoices
for each row execute function vyndi_require_serialized_dispatch_before_invoice();

-- Preserve every current dispatch gate from 0086 and activate exact serialization only for future canonical shipments.
create or replace function post_vyndi_shipment(
  p_id text,p_sales_order_id text,p_plan_month integer,p_units numeric,p_source_reference text,
  p_actor_user_id text,p_actor_role text
) returns text
language plpgsql
as $$
declare
  v_order_status text;
  v_order_units numeric;
  v_order_revision integer;
  v_job_card_id text;
  v_job_status text;
  v_shipped numeric;
  v_quality_released numeric;
  v_unit_actual_cost numeric;
  v_snapshot jsonb;
begin
  if trim(coalesce(p_source_reference,''))='' then raise exception 'Shipment source reference is required.'; end if;
  perform pg_advisory_xact_lock(hashtext('shipment|' || p_id)::bigint);

  if exists(select 1 from vyndi_shipments where id=p_id) then
    if exists(
      select 1 from vyndi_shipments
       where id=p_id and sales_order_id=p_sales_order_id and plan_month=p_plan_month
         and units=p_units and status='posted'
    ) then return p_id; end if;
    raise exception 'Shipment id already exists with different state.';
  end if;

  select o.status,o.units,o.revision
    into v_order_status,v_order_units,v_order_revision
    from vyndi_sales_orders o
   where o.id=p_sales_order_id;
  if not found then raise exception 'Sales order not found.'; end if;
  if v_order_status not in ('confirmed','delivered') then raise exception 'Shipment requires a confirmed sales order.'; end if;

  select c.id,c.status
    into v_job_card_id,v_job_status
    from epr_production_job_cards c
   where c.sales_order_id=p_sales_order_id
     and c.sales_order_revision=v_order_revision
     and c.status<>'cancelled'
   order by c.created_at desc,c.id desc
   limit 1;
  if not found or v_job_status is distinct from 'complete' then
    raise exception 'Shipment requires the current-revision Production Job Card to be complete.';
  end if;

  select unit_actual_cost_inr
    into v_unit_actual_cost
    from epr_job_cost_snapshots
   where job_card_id=v_job_card_id
     and completed_quantity>0
     and unit_actual_cost_inr>0
   order by captured_at desc
   limit 1;
  if not found or coalesce(v_unit_actual_cost,0)<=0 then
    raise exception 'Dispatch blocked: completed Job Card % has no governed actual finished-goods unit cost.',v_job_card_id;
  end if;

  select count(*)::numeric
    into v_quality_released
    from vyndi_quality_releases q
   where q.job_card_id=v_job_card_id
     and q.decision='released'
     and q.superseded_at is null;

  select coalesce(sum(units),0)
    into v_shipped
    from vyndi_shipments
   where sales_order_id=p_sales_order_id and status='posted';

  if p_units<=0 or p_units<>trunc(p_units) then
    raise exception 'Serialized bicycle shipment quantity must be a positive whole number.';
  end if;
  if v_shipped+p_units>v_order_units then
    raise exception 'Shipment quantity exceeds remaining confirmed order quantity.';
  end if;
  if v_shipped+p_units>v_quality_released then
    raise exception 'Dispatch is blocked: only % serialized unit(s) have current Quality release evidence for Job Card %.',v_quality_released,v_job_card_id;
  end if;

  insert into vyndi_shipments(
    id,sales_order_id,job_card_id,plan_month,units,source_reference,posted_by,owner_workspace,
    serial_allocation_required
  ) values(
    p_id,p_sales_order_id,v_job_card_id,p_plan_month,p_units,p_source_reference,p_actor_user_id,'operations',true
  );

  v_snapshot:=jsonb_build_object(
    'shipmentId',p_id,'salesOrderId',p_sales_order_id,'salesOrderRevision',v_order_revision,
    'jobCardId',v_job_card_id,'planMonth',p_plan_month,'units',p_units,
    'unitActualCostInr',v_unit_actual_cost,'qualityReleasedUnits',v_quality_released,
    'serialAllocationRequired',true,'ownerWorkspace','operations','sourceReference',p_source_reference
  );
  insert into vyndi_audit_events(
    id,entity_type,entity_id,entity_revision,action,actor_user_id,actor_role,source_reference,payload_json,
    correlation_id,gate_id,gate_result,previous_state,new_state,reason
  ) values(
    'AUD-SHIP-'||p_id||'-R1','shipment',p_id,1,'posted',p_actor_user_id,p_actor_role,p_source_reference,v_snapshot,
    'ORDER|'||p_sales_order_id||'|R'||v_order_revision,'G12-DISPATCH','pass',null,'posted',
    'Operations dispatch posted after Production completion, governed actual FG cost and Quality release; exact serial allocation required before invoice.'
  );

  return p_id;
end;
$$;

create or replace view vyndi_dispatch_register as
select
  s.id as shipment_id,
  s.sales_order_id,
  o.revision as sales_order_revision,
  s.job_card_id,
  s.plan_month,
  s.units,
  s.status,
  s.owner_workspace,
  s.source_reference,
  s.posted_by,
  s.posted_at,
  coalesce(q.current_quality_release_count,0)::int as current_quality_release_count,
  i.id as invoice_id,
  i.status as invoice_status,
  i.amount_lakh as invoice_amount_lakh,
  -- CREATE OR REPLACE VIEW in PostgreSQL requires existing columns to keep
  -- their names and ordinal positions. Package M fields are append-only here.
  s.serial_allocation_required,
  coalesce(a.allocated_serial_count,0)::int as allocated_serial_count,
  coalesce(a.current_released_serial_count,0)::int as current_released_serial_count,
  coalesce(a.serial_numbers,'') as serial_numbers,
  coalesce(a.allocations,'[]'::jsonb) as serial_allocations,
  case
    when not s.serial_allocation_required then false
    else coalesce(a.allocated_serial_count,0)=s.units
  end as serialization_complete,
  case
    when not s.serial_allocation_required then false
    else coalesce(a.current_released_serial_count,0)=s.units
  end as release_coverage_complete
from vyndi_shipments s
join vyndi_sales_orders o on o.id=s.sales_order_id
left join lateral (
  select count(*)::int as current_quality_release_count
    from vyndi_quality_releases qr
   where qr.job_card_id=s.job_card_id and qr.decision='released' and qr.superseded_at is null
) q on true
left join lateral (
  select
    count(*)::int as allocated_serial_count,
    count(*) filter (where sq.decision='released' and sq.superseded_at is null)::int as current_released_serial_count,
    string_agg(sa.serial_number,'|' order by sa.serial_number) as serial_numbers,
    jsonb_agg(jsonb_build_object(
      'allocationId',sa.id,
      'qualityReleaseId',sa.quality_release_id,
      'travellerId',sa.traveller_id,
      'serialNumber',sa.serial_number,
      'currentRelease',(sq.decision='released' and sq.superseded_at is null)
    ) order by sa.serial_number) as allocations
  from vyndi_shipment_serial_allocations sa
  left join vyndi_quality_releases sq on sq.id=sa.quality_release_id
  where sa.shipment_id=s.id and sa.status='active'
) a on true
left join vyndi_invoices i on i.shipment_id=s.id;

comment on view vyndi_dispatch_register is
  'Operations dispatch register with exact serialized allocation coverage for future controlled shipments and downstream Finance invoice visibility. Legacy shipment serial identity is never inferred.';
