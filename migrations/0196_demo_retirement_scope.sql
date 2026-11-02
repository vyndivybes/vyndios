-- 0196: audited synthetic/demo retirement classifications; source transactions are immutable.
-- This migration creates no classification. Production projections are unchanged
-- until an independently approved case is activated by an authorized future workflow.
create table if not exists vyndi_demo_retirement_cases (
 case_id text primary key,
 sales_order_id text not null unique references vyndi_sales_orders(id) on delete restrict,
 source_order_revision integer not null check(source_order_revision > 0),
 source_card_id text not null references epr_production_job_cards(id) on delete restrict,
 source_card_revision integer not null check(source_card_revision > 0),
 evidence_sha256 text not null check(evidence_sha256 ~ '^[0-9a-f]{64}$'),
 reason text not null check(length(btrim(reason)) >= 12),
 created_by text not null check(length(btrim(created_by)) > 0),
 created_at timestamptz not null default now()
);
create table if not exists vyndi_demo_retirement_events (
 event_id bigint generated always as identity primary key,
 case_id text not null references vyndi_demo_retirement_cases(case_id) on delete restrict,
 event_type text not null check(event_type in ('proposed','approved','activated','reversed')),
 actor_user_id text not null check(length(btrim(actor_user_id))>0),
 idempotency_key text not null unique check(length(btrim(idempotency_key))>0),
 reason text not null check(length(btrim(reason))>0),
 occurred_at timestamptz not null default now()
);
create index if not exists idx_vyndi_demo_retirement_events_case
 on vyndi_demo_retirement_events(case_id,event_id desc);

create or replace function vyndi_demo_retirement_immutable_guard()
returns trigger language plpgsql as $demo_immutable$
begin
 raise exception 'Demo retirement case and event records are immutable; append a reversal event instead';
end;
$demo_immutable$;
drop trigger if exists trg_vyndi_demo_cases_immutable on vyndi_demo_retirement_cases;
create trigger trg_vyndi_demo_cases_immutable before update or delete on vyndi_demo_retirement_cases
for each row execute function vyndi_demo_retirement_immutable_guard();
drop trigger if exists trg_vyndi_demo_events_immutable on vyndi_demo_retirement_events;
create trigger trg_vyndi_demo_events_immutable before update or delete on vyndi_demo_retirement_events
for each row execute function vyndi_demo_retirement_immutable_guard();

create or replace function vyndi_demo_retirement_validate_transition()
returns trigger language plpgsql as $demo_transition$
declare
 v_case vyndi_demo_retirement_cases%rowtype;
 v_previous text;
 v_order_revision integer;
 v_order_status text;
 v_card_revision integer;
 v_card_status text;
 v_card_order_id text;
 v_card_superseded_at timestamptz;
begin
 -- Serialize transitions for this case even if two checker requests race.
 select * into v_case from vyndi_demo_retirement_cases where case_id=new.case_id for update;
 if not found then raise exception 'Demo retirement case does not exist'; end if;
 select event_type into v_previous
 from vyndi_demo_retirement_events where case_id=new.case_id
 order by event_id desc limit 1;

 if new.event_type='proposed' then
   if v_previous is not null and v_previous<>'reversed' then
     raise exception 'Demo retirement transition invalid: proposed requires a new/reversed case';
   end if;
   if new.actor_user_id<>v_case.created_by then
     raise exception 'Demo retirement proposal actor must match original maker';
   end if;
 elsif new.event_type='approved' then
   if v_previous is distinct from 'proposed' then
     raise exception 'Demo retirement transition invalid: approved requires proposed';
   end if;
   if new.actor_user_id=v_case.created_by then
     raise exception 'Independent checker required: maker cannot approve';
   end if;
 elsif new.event_type='activated' then
   if v_previous is distinct from 'approved' then
     raise exception 'Demo retirement transition invalid: activated requires approved';
   end if;
   if new.actor_user_id=v_case.created_by then
     raise exception 'Independent checker required: maker cannot activate';
   end if;
   select revision,status into v_order_revision,v_order_status
     from vyndi_sales_orders where id=v_case.sales_order_id for update;
   select sales_order_revision,status,sales_order_id,superseded_at
     into v_card_revision,v_card_status,v_card_order_id,v_card_superseded_at
     from epr_production_job_cards where id=v_case.source_card_id for update;
   if v_order_revision is distinct from v_case.source_order_revision
     or v_order_status is distinct from 'confirmed'
     or v_card_revision is distinct from v_case.source_card_revision
     or v_card_order_id is distinct from v_case.sales_order_id
     or v_card_superseded_at is not null
     or v_card_status is distinct from 'hold' then
     raise exception 'Demo retirement source revision/status drift; requalify original case';
   end if;
 elsif new.event_type='reversed' then
   if v_previous is distinct from 'activated' then
     raise exception 'Demo retirement transition invalid: reversed requires activated';
   end if;
   if new.actor_user_id=v_case.created_by then
     raise exception 'Independent checker required: maker cannot reverse';
   end if;
 else
   raise exception 'Unsupported retirement transition';
 end if;
 return new;
end;
$demo_transition$;
drop trigger if exists trg_vyndi_demo_event_transition on vyndi_demo_retirement_events;
create trigger trg_vyndi_demo_event_transition before insert on vyndi_demo_retirement_events
for each row execute function vyndi_demo_retirement_validate_transition();

-- Read-only operational scope; full original tables, audit and inventory remain unchanged.
create or replace view vyndi_operational_sales_orders as
 select o.* from vyndi_sales_orders o
 where not exists (
  select 1 from vyndi_demo_retirement_cases c
  join lateral (
   select e.event_type
     from vyndi_demo_retirement_events e
    where e.case_id=c.case_id
    order by e.event_id desc limit 1
  ) latest on true
  where c.sales_order_id=o.id and latest.event_type='activated'
 );

-- Retire exact classified demand from prospective procurement only, NOT from
-- inventory balances, FIFO cost, receipts, invoices, COGS, audit or genealogy.
create or replace view vyndi_committed_procurement_requirements as
 select r.due_month as requirement_month,
   r.sku,r.unit,
   sum(r.required_quantity) as committed_requirement,
   sum(r.reserved_quantity) as reserved_quantity,
   max(r.physical_quantity) as physical_quantity,
   max(r.available_to_promise) as available_to_promise,
   greatest(sum(r.required_quantity)-max(r.physical_quantity),0::numeric) as net_committed_shortage,
   count(distinct r.sales_order_id)::integer as committed_order_count
 from vyndi_live_job_card_requirements r
 join vyndi_operational_sales_orders o on o.id=r.sales_order_id
 where r.job_card_status = any(array['released'::text,'in_progress'::text])
   and r.sku is not null and r.issue_status<>'issued'
 group by r.due_month,r.sku,r.unit;

-- No external/browser grants, no transition endpoint, no automated activation.
revoke all on vyndi_demo_retirement_cases from public;
revoke all on vyndi_demo_retirement_events from public;
