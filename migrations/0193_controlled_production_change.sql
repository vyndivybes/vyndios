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
