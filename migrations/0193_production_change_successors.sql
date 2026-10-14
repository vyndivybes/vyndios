-- Approved production changes create a new controlled, current Job Card.
-- Original approved Job Cards, travellers, evidence and released BOM snapshots survive untouched.
alter table epr_production_job_cards
  add column if not exists current_for_order boolean not null default true;
alter table epr_production_job_cards
  add column if not exists supersedes_job_card_id text references epr_production_job_cards(id) on delete restrict;
alter table epr_production_job_cards
  add column if not exists production_change_id text;

-- Existing production data has exactly one card per order; only the designated
-- current card is unique. Historical superseded records remain addressable by id.
alter table epr_production_job_cards
  drop constraint if exists epr_production_job_cards_sales_order_id_key;
create unique index if not exists epr_production_job_cards_current_order_uq
  on epr_production_job_cards (sales_order_id) where current_for_order=true;
create unique index if not exists epr_production_job_cards_change_uq
  on epr_production_job_cards(production_change_id) where production_change_id is not null;
create index if not exists epr_production_job_cards_supersedes_idx
  on epr_production_job_cards(supersedes_job_card_id);

create table if not exists vyndi_production_change_requests (
  id text primary key,
  sales_order_id text not null references vyndi_sales_orders(id) on delete restrict,
  source_job_card_id text not null references epr_production_job_cards(id) on delete restrict,
  target_sales_revision integer not null check (target_sales_revision>0),
  reason text not null check (length(trim(reason))>=12),
  ecn_id text references vyndi_engineering_change_notices(id) on delete restrict,
  status text not null default 'requested' check (status in ('requested','applied','rejected')),
  source_snapshot jsonb not null,
  created_by text not null,
  approved_by text,
  successor_job_card_id text references epr_production_job_cards(id) on delete restrict,
  created_at timestamptz not null default now(),
  applied_at timestamptz,
  updated_at timestamptz not null default now()
);
create unique index if not exists vyndi_production_change_pending_uq
  on vyndi_production_change_requests(sales_order_id) where status='requested';
create index if not exists vyndi_production_change_order_idx
  on vyndi_production_change_requests(sales_order_id,created_at desc);

-- A superseded batch must never receive further reservation or batch approval.
-- Existing R2 release/evidence stays auditable; only its current eligibility changes.
create or replace function vyndi_production_successor_guard()
returns trigger language plpgsql as $$
declare
  v_current boolean;
begin
  if tg_table_name='epr_production_job_cards' then
    if tg_op='UPDATE' and old.current_for_order=false and
       (new.current_for_order=true or new.sales_order_revision is distinct from old.sales_order_revision
       or new.bom_revision is distinct from old.bom_revision) then
      raise exception 'Superseded Job Card is immutable; use the current controlled successor.';
    end if;
    return new;
  end if;
  return new;
end;
$$;
drop trigger if exists vyndi_production_successor_guard_trigger on epr_production_job_cards;
create trigger vyndi_production_successor_guard_trigger
before update on epr_production_job_cards
for each row execute function vyndi_production_successor_guard();

comment on table vyndi_production_change_requests is
  'Audited request and approval evidence linking immutable approved Job Card revisions to controlled successors; application gates verify no physical execution or downstream commitment before release.';

-- Prevent any new physical execution, release evidence or serial allocation
-- from being recorded against a superseded (noncurrent) approved Job Card.
create or replace function vyndi_block_superseded_traveller_activity()
returns trigger language plpgsql as $$
declare
  v_traveller text;
  v_current boolean;
begin
  v_traveller:=new.traveller_id;
  select c.current_for_order into v_current
    from epr_travellers t
    join epr_production_job_cards c on c.id=t.job_card_id
    where t.id=v_traveller
    for share of c;
  if v_current=false then
    raise exception 'Superseded production Job Card cannot accept new traveller, quality or dispatch evidence.';
  end if;
  return new;
end;
$$;
drop trigger if exists vyndi_gate_supersession_guard on epr_gate_events;
create trigger vyndi_gate_supersession_guard
before insert or update on epr_gate_events
for each row execute function vyndi_block_superseded_traveller_activity();

drop trigger if exists vyndi_evidence_supersession_guard on epr_evidence;
create trigger vyndi_evidence_supersession_guard
before insert or update on epr_evidence
for each row execute function vyndi_block_superseded_traveller_activity();

drop trigger if exists vyndi_quality_supersession_guard on vyndi_quality_releases;
create trigger vyndi_quality_supersession_guard
before insert on vyndi_quality_releases
for each row execute function vyndi_block_superseded_traveller_activity();

drop trigger if exists vyndi_shipment_supersession_guard on vyndi_shipment_serial_allocations;
create trigger vyndi_shipment_supersession_guard
before insert on vyndi_shipment_serial_allocations
for each row execute function vyndi_block_superseded_traveller_activity();
