-- Controlled production revision: retain approved R2 and open exactly one current Job Card per order.
-- The migration changes schema only. It does not modify existing orders, approved builds or stock.
alter table epr_production_job_cards
  add column if not exists superseded_at timestamptz,
  add column if not exists supersedes_job_card_id text references epr_production_job_cards(id) on delete restrict,
  add column if not exists production_change_id text;
alter table epr_production_job_cards
  drop constraint if exists epr_production_job_cards_sales_order_id_key;
create unique index if not exists epr_current_job_card_per_order_uq
  on epr_production_job_cards(sales_order_id) where superseded_at is null;
create index if not exists epr_job_card_supersession_idx
  on epr_production_job_cards(supersedes_job_card_id,created_at desc)
  where supersedes_job_card_id is not null;

create table if not exists vyndi_production_changes (
  id text primary key,
  sales_order_id text not null references vyndi_sales_orders(id) on delete restrict,
  previous_job_card_id text not null references epr_production_job_cards(id) on delete restrict,
  requested_sales_revision integer not null check (requested_sales_revision>0),
  reason text not null check (length(trim(reason))>=5),
  status text not null default 'requested' check (status in ('requested','approved','applied','rejected')),
  ecn_id text references vyndi_engineering_change_notices(id) on delete restrict,
  requested_by text not null,
  requested_role text not null,
  approved_by text,
  applied_by text,
  successor_job_card_id text references epr_production_job_cards(id) on delete restrict,
  previous_snapshot jsonb,
  successor_snapshot jsonb,
  created_at timestamptz not null default now(),
  approved_at timestamptz,
  applied_at timestamptz,
  updated_at timestamptz not null default now(),
  check (status not in ('approved','applied') or (ecn_id is not null and approved_by is not null)),
  check (status<>'applied' or (successor_job_card_id is not null and applied_at is not null))
);
create unique index if not exists vyndi_one_active_production_change_uq
  on vyndi_production_changes(previous_job_card_id,requested_sales_revision)
  where status<>'rejected';
create index if not exists vyndi_production_changes_order_idx
  on vyndi_production_changes(sales_order_id,created_at desc);

alter table epr_production_job_cards
  add constraint epr_job_card_supersession_change_fk foreign key (production_change_id)
  references vyndi_production_changes(id) on delete restrict;

-- No new reservation may be consumed from a superseded/cancelled Job Card.
-- Releasing an old unconsumed reservation is permitted; issuing it is not.
create or replace function vyndi_guard_superseded_reservation_issue()
returns trigger language plpgsql as $$
begin
  if new.status='consumed' or (tg_op='INSERT' and new.status='active') then
    if exists (
      select 1 from epr_production_job_cards jc
       where jc.id=new.job_card_id
         and (jc.superseded_at is not null or jc.status='cancelled')
    ) then
      raise exception 'Superseded or cancelled Job Card % cannot issue reserved stock.',new.job_card_id;
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_vyndi_no_superseded_reservation_issue on epr_inventory_reservations;
create trigger trg_vyndi_no_superseded_reservation_issue
before insert or update of status on epr_inventory_reservations
for each row execute function vyndi_guard_superseded_reservation_issue();

comment on table vyndi_production_changes is
  'Approved commercial-order revision linked to immutable ECR/ECO/ECN authority and an archived predecessor Job Card. Application is one serializable transaction, not a silent in-place rewrite.';


-- A superseded predecessor remains queryable but cannot acquire new EPR
-- evidence, traverse new production gates, or be silently resumed.
create or replace function vyndi_guard_superseded_traveller_mutation()
returns trigger language plpgsql as $$
declare v_job_card text;
begin
  v_job_card:=case when tg_op='DELETE' then old.job_card_id else new.job_card_id end;
  if v_job_card is not null and exists(
    select 1 from epr_production_job_cards c where c.id=v_job_card and c.superseded_at is not null
  ) then
    raise exception 'Historical traveller on superseded Job Card % is immutable.',v_job_card;
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$;
drop trigger if exists trg_vyndi_superseded_traveller_immutability on epr_travellers;
create trigger trg_vyndi_superseded_traveller_immutability
before insert or update or delete on epr_travellers
for each row execute function vyndi_guard_superseded_traveller_mutation();

create or replace function vyndi_guard_superseded_epr_evidence()
returns trigger language plpgsql as $$
declare v_traveller text;
begin
  v_traveller:=case when tg_op='DELETE' then old.traveller_id else new.traveller_id end;
  if exists(
    select 1 from epr_travellers t
    join epr_production_job_cards c on c.id=t.job_card_id
    where t.id=v_traveller and c.superseded_at is not null
  ) then
    raise exception 'Historical EPR evidence for superseded traveller % is immutable.',v_traveller;
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$;
drop trigger if exists trg_vyndi_superseded_epr_gates on epr_gate_events;
create trigger trg_vyndi_superseded_epr_gates
before insert or update or delete on epr_gate_events
for each row execute function vyndi_guard_superseded_epr_evidence();
drop trigger if exists trg_vyndi_superseded_epr_records on epr_evidence;
create trigger trg_vyndi_superseded_epr_records
before insert or update or delete on epr_evidence
for each row execute function vyndi_guard_superseded_epr_evidence();

create or replace function vyndi_guard_superseded_supplier_order()
returns trigger language plpgsql as $$
begin
  if new.status<>'cancelled' and new.job_card_id is not null and exists(
    select 1 from epr_production_job_cards c where c.id=new.job_card_id and c.superseded_at is not null
  ) then
    raise exception 'Cannot create or reopen a purchase order on a superseded Job Card.';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_vyndi_superseded_supplier_order on vyndi_purchase_orders;
create trigger trg_vyndi_superseded_supplier_order
before insert or update of status,job_card_id on vyndi_purchase_orders
for each row execute function vyndi_guard_superseded_supplier_order();


-- Operational reports select the one current successor; historic predecessor
-- remains available through the lineage and audit views.
create or replace view vyndi_report_production_release_gate as
select
  c.id as job_card_id,
  c.sales_order_id,
  c.status,
  c.bom_revision,
  o.status as order_status,
  o.units as order_units,
  o.plan_month,
  case
    when c.status = 'planned' then 'AWAITING_RELEASE'
    when c.status = 'released' then 'RELEASED'
    when c.status = 'complete' then 'COMPLETE'
    else upper(c.status)
  end as gate_status
from epr_production_job_cards c
left join vyndi_sales_orders o on o.id = c.sales_order_id
where c.superseded_at is null;


create or replace view vyndi_report_order_book_sync as
select
  o.id as sales_order_id,
  o.revision as order_revision,
  o.status as order_status,
  o.plan_month,
  o.product_id,
  o.units as order_units,
  o.asp_lakh,
  c.id as job_card_id,
  c.sales_order_revision as job_order_revision,
  c.status as job_status,
  case
    when c.id is null and o.status in ('confirmed', 'delivered') then 'MISSING_JOB_CARD'
    when c.id is not null and c.sales_order_revision is distinct from o.revision then 'STALE_JOB_CARD'
    when o.status = 'cancelled' and c.status <> 'cancelled' then 'CANCELLED_ORDER_ACTIVE_JOB'
    else 'SYNCED'
  end as sync_status
from vyndi_sales_orders o
left join epr_production_job_cards c on c.sales_order_id = o.id and c.superseded_at is null;


