-- VYNDI actual manufacturing cost -> finished goods -> dispatch COGS hardening.
-- Source journals remain canonical. Job allocations only reclassify evidenced posted costs into WIP.

create table if not exists epr_job_conversion_cost_allocations (
  id text primary key,
  job_card_id text not null references epr_production_job_cards(id) on delete restrict,
  category text not null check (category in (
    'direct_labour','outsourcing','manufacturing_consumables','manufacturing_depreciation',
    'support_depreciation','overhead','scrap','rework'
  )),
  amount_inr numeric(18,2) not null check (amount_inr > 0),
  source_journal_id text not null references epr_finance_journals(id) on delete restrict,
  source_line_no integer not null,
  source_reference text not null,
  status text not null default 'draft' check (status in ('draft','approved','rejected')),
  created_by text not null,
  created_at timestamptz not null default now(),
  approved_by text,
  approved_at timestamptz,
  rejected_by text,
  rejected_at timestamptz,
  rejection_reason text,
  unique(job_card_id,category,source_journal_id,source_line_no)
);

create index if not exists epr_job_conversion_cost_job_idx
  on epr_job_conversion_cost_allocations(job_card_id,status,category);

create or replace function approve_vyndi_job_conversion_cost(
  p_id text,
  p_actor_user_id text,
  p_actor_role text
) returns text
language plpgsql
as $$
declare
  v_row epr_job_conversion_cost_allocations%rowtype;
  v_account text;
  v_debit numeric;
  v_allocated numeric;
  v_job_status text;
begin
  perform pg_advisory_xact_lock(hashtext('job-cost|'||p_id)::bigint);

  select * into v_row
    from epr_job_conversion_cost_allocations
   where id=p_id for update;
  if not found then raise exception 'Job conversion cost allocation not found.'; end if;
  if v_row.status='approved' then return v_row.id; end if;
  if v_row.status<>'draft' then raise exception 'Only draft job conversion cost can be approved.'; end if;

  select status into v_job_status from epr_production_job_cards where id=v_row.job_card_id;
  if not found then raise exception 'Job Card not found.'; end if;
  if v_job_status='complete' then raise exception 'Completed Job Card cannot accept new conversion-cost allocations.'; end if;

  select l.account_code,l.debit_inr into v_account,v_debit
    from epr_finance_journal_lines l
    join epr_finance_journals j on j.id=l.journal_id
   where l.journal_id=v_row.source_journal_id
     and l.line_no=v_row.source_line_no
     and j.status='posted';
  if not found then raise exception 'Source journal line must be posted.'; end if;
  if v_debit<=0 then raise exception 'Source journal line must be a debit cost line.'; end if;

  if v_row.category='direct_labour' and v_account not in ('5100','6100') then
    raise exception 'Direct labour requires a posted labour/payroll debit source.';
  elsif v_row.category='outsourcing' and v_account<>'6400' then
    raise exception 'Outsourcing requires account 6400 source.';
  elsif v_row.category in ('manufacturing_consumables','overhead','scrap','rework') and v_account not in ('5000','5200','6200','6300','6400') then
    raise exception 'Manufacturing overhead allocation requires an eligible operating-cost debit source.';
  elsif v_row.category in ('manufacturing_depreciation','support_depreciation') and v_account<>'6500' then
    raise exception 'Depreciation allocation requires account 6500 source.';
  end if;

  select coalesce(sum(amount_inr),0) into v_allocated
    from epr_job_conversion_cost_allocations
   where source_journal_id=v_row.source_journal_id
     and source_line_no=v_row.source_line_no
     and status='approved'
     and id<>v_row.id;

  if v_allocated+v_row.amount_inr>v_debit+0.01 then
    raise exception 'Job allocation exceeds the evidenced source journal debit.';
  end if;

  perform post_vyndi_finance_journal(
    'FIN-WIP-CONV-'||v_row.id,
    current_date,
    'job_conversion_cost',
    v_row.id,
    'Capitalize evidenced '||v_row.category||' to WIP for '||v_row.job_card_id,
    jsonb_build_array(
      jsonb_build_object('accountCode','1210','debitInr',v_row.amount_inr,'memo','Job conversion cost to WIP'),
      jsonb_build_object('accountCode',v_account,'creditInr',v_row.amount_inr,'memo','Reclassify source cost into WIP')
    )
  );

  update epr_job_conversion_cost_allocations
     set status='approved',approved_by=p_actor_user_id,approved_at=now()
   where id=v_row.id;

  insert into vyndi_audit_events(
    id,entity_type,entity_id,action,actor_user_id,actor_role,source_reference,payload_json
  ) values (
    'AUD-JCOST-'||v_row.id,'job_conversion_cost',v_row.id,'approved',
    p_actor_user_id,p_actor_role,v_row.source_reference,
    jsonb_build_object(
      'jobCardId',v_row.job_card_id,'category',v_row.category,'amountInr',v_row.amount_inr,
      'sourceJournalId',v_row.source_journal_id,'sourceLineNo',v_row.source_line_no,'sourceAccount',v_account
    )
  );

  return v_row.id;
end;
$$;

create or replace function vyndi_finance_job_complete_trigger() returns trigger
language plpgsql as $$
declare
  v_material numeric:=0;
  v_labour numeric:=0;
  v_outsourcing numeric:=0;
  v_consumables numeric:=0;
  v_mfg_dep numeric:=0;
  v_support_dep numeric:=0;
  v_overhead numeric:=0;
  v_scrap numeric:=0;
  v_rework numeric:=0;
  v_total numeric:=0;
  v_units numeric:=0;
  v_model text;
  v_snapshot_id text;
begin
  if new.status<>'complete' or (tg_op='UPDATE' and old.status='complete') then return new; end if;

  select coalesce(sum(c.cogs_inr),0) into v_material
    from epr_cogs_entries c
    join epr_travellers t on t.id=c.traveller_id
   where t.job_card_id=new.id;

  select
    coalesce(sum(amount_inr) filter(where category='direct_labour'),0),
    coalesce(sum(amount_inr) filter(where category='outsourcing'),0),
    coalesce(sum(amount_inr) filter(where category='manufacturing_consumables'),0),
    coalesce(sum(amount_inr) filter(where category='manufacturing_depreciation'),0),
    coalesce(sum(amount_inr) filter(where category='support_depreciation'),0),
    coalesce(sum(amount_inr) filter(where category='overhead'),0),
    coalesce(sum(amount_inr) filter(where category='scrap'),0),
    coalesce(sum(amount_inr) filter(where category='rework'),0)
  into v_labour,v_outsourcing,v_consumables,v_mfg_dep,v_support_dep,v_overhead,v_scrap,v_rework
  from epr_job_conversion_cost_allocations
  where job_card_id=new.id and status='approved';

  v_total:=round(v_material+v_labour+v_outsourcing+v_consumables+v_mfg_dep+v_support_dep+v_overhead+v_scrap+v_rework,2);
  v_units:=greatest(coalesce(new.units,0),0);
  v_model:=coalesce(nullif(new.variant_id,''),nullif(new.product_label,''),new.product_id,'unknown');
  v_snapshot_id:='COST-'||new.id||'-COMPLETE';

  insert into epr_job_cost_snapshots(
    id,job_card_id,model,planned_quantity,completed_quantity,
    material_actual_inr,material_standard_inr,material_variance_inr,
    direct_labour_inr,outsourcing_inr,manufacturing_consumables_inr,
    manufacturing_depreciation_inr,support_depreciation_inr,overhead_inr,scrap_inr,rework_inr,
    total_actual_cost_inr,unit_actual_cost_inr,finished_goods_value_inr,wip_value_inr,source_action_id
  ) values (
    v_snapshot_id,new.id,v_model,v_units,v_units,
    v_material,v_material,0,
    v_labour,v_outsourcing,v_consumables,v_mfg_dep,v_support_dep,v_overhead,v_scrap,v_rework,
    v_total,
    case when v_units>0 then round(v_total/v_units,2) else 0 end,
    v_total,0,new.sales_order_id
  )
  on conflict (id) do nothing;

  if v_total>0 then
    perform post_vyndi_finance_journal(
      'FIN-FG-'||new.id,current_date,'production_completion',new.id,
      'Production completion '||new.id,
      jsonb_build_array(
        jsonb_build_object('accountCode','1220','debitInr',v_total,'memo','Finished goods capitalization · full actual job cost'),
        jsonb_build_object('accountCode','1210','creditInr',v_total,'memo','Clear material + conversion WIP')
      )
    );
  else
    insert into epr_finance_posting_exceptions(id,source_type,source_id,severity,message)
    values(
      'FIN-EX-JOB-'||new.id,'production_completion',new.id,'high',
      'Job completed with no governed material or conversion cost. Finished-goods valuation was not posted.'
    ) on conflict do nothing;
  end if;

  return new;
end;
$$;



-- Harden dispatch: do not permit a new shipment unless the completed Job Card has a governed actual-cost snapshot.
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

  if p_units<=0 or v_shipped+p_units>v_order_units then
    raise exception 'Shipment quantity exceeds remaining confirmed order quantity.';
  end if;
  if v_shipped+p_units>v_quality_released then
    raise exception 'Dispatch is blocked: only % serialized unit(s) have current Quality release evidence for Job Card %.',v_quality_released,v_job_card_id;
  end if;

  insert into vyndi_shipments(id,sales_order_id,job_card_id,plan_month,units,source_reference,posted_by,owner_workspace)
  values(p_id,p_sales_order_id,v_job_card_id,p_plan_month,p_units,p_source_reference,p_actor_user_id,'operations');

  v_snapshot:=jsonb_build_object(
    'shipmentId',p_id,'salesOrderId',p_sales_order_id,'salesOrderRevision',v_order_revision,
    'jobCardId',v_job_card_id,'planMonth',p_plan_month,'units',p_units,
    'unitActualCostInr',v_unit_actual_cost,
    'qualityReleasedUnits',v_quality_released,'ownerWorkspace','operations','sourceReference',p_source_reference
  );
  insert into vyndi_audit_events(
    id,entity_type,entity_id,entity_revision,action,actor_user_id,actor_role,source_reference,payload_json,
    correlation_id,gate_id,gate_result,previous_state,new_state,reason
  ) values(
    'AUD-SHIP-'||p_id||'-R1','shipment',p_id,1,'posted',p_actor_user_id,p_actor_role,p_source_reference,v_snapshot,
    'ORDER|'||p_sales_order_id||'|R'||v_order_revision,'G12-DISPATCH','pass',null,'posted',
    'Operations dispatch posted after Production completion, governed actual FG cost and Quality release.'
  );

  return p_id;
end;
$$;

create or replace view vyndi_job_actual_cost_trace as
select
  s.job_card_id,
  s.model,
  s.completed_quantity,
  s.material_actual_inr,
  s.direct_labour_inr,
  s.outsourcing_inr,
  s.manufacturing_consumables_inr,
  s.manufacturing_depreciation_inr,
  s.support_depreciation_inr,
  s.overhead_inr,
  s.scrap_inr,
  s.rework_inr,
  s.total_actual_cost_inr,
  s.unit_actual_cost_inr,
  s.finished_goods_value_inr,
  s.captured_at,
  count(a.id) filter(where a.status='approved') as approved_conversion_allocations
from epr_job_cost_snapshots s
left join epr_job_conversion_cost_allocations a on a.job_card_id=s.job_card_id
group by s.id,s.job_card_id,s.model,s.completed_quantity,s.material_actual_inr,s.direct_labour_inr,
         s.outsourcing_inr,s.manufacturing_consumables_inr,s.manufacturing_depreciation_inr,
         s.support_depreciation_inr,s.overhead_inr,s.scrap_inr,s.rework_inr,
         s.total_actual_cost_inr,s.unit_actual_cost_inr,s.finished_goods_value_inr,s.captured_at;

comment on table epr_job_conversion_cost_allocations is
  'Evidence-backed reclassification of posted labour/outsourcing/manufacturing cost into Job Card WIP. No manual parallel cost truth.';
comment on view vyndi_job_actual_cost_trace is
  'Actual Job Card cost provenance used for finished-goods valuation and downstream dispatch COGS.';
