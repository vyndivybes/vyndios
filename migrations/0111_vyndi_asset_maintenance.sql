-- VYNDI Asset & Maintenance Intelligence — Package L
-- Extends the existing EPR equipment identity into a governed maintenance lifecycle.
-- epr_equipment remains the single canonical asset/equipment master.

alter table epr_equipment
  add column if not exists manufacturer text,
  add column if not exists model_number text,
  add column if not exists serial_number text,
  add column if not exists location text,
  add column if not exists criticality text not null default 'medium',
  add column if not exists owner_ref text,
  add column if not exists commissioned_at timestamptz,
  add column if not exists last_maintained_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname='epr_equipment_criticality_chk') then
    alter table epr_equipment add constraint epr_equipment_criticality_chk
      check (criticality in ('low','medium','high','critical'));
  end if;
end $$;

create unique index if not exists epr_equipment_serial_uq
  on epr_equipment(serial_number)
  where serial_number is not null and btrim(serial_number) <> '';

create table if not exists vyndi_maintenance_plans (
  id text primary key,
  equipment_id text not null references epr_equipment(id) on delete restrict,
  title text not null,
  strategy text not null
    check (strategy in ('preventive','inspection','calibration','condition_based')),
  interval_days integer,
  next_due_at timestamptz,
  instructions text not null default '',
  active boolean not null default true,
  record_revision integer not null default 1 check (record_revision > 0),
  source_reference text not null,
  created_by text not null,
  updated_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (interval_days is null or interval_days > 0)
);

create index if not exists vyndi_maintenance_plans_equipment_due_idx
  on vyndi_maintenance_plans(equipment_id,active,next_due_at);

create table if not exists vyndi_maintenance_work_orders (
  id text primary key,
  equipment_id text not null references epr_equipment(id) on delete restrict,
  plan_id text references vyndi_maintenance_plans(id) on delete restrict,
  work_order_type text not null
    check (work_order_type in ('preventive','corrective','inspection','calibration')),
  priority text not null default 'normal'
    check (priority in ('low','normal','high','critical')),
  status text not null default 'scheduled'
    check (status in ('draft','scheduled','in_progress','completed','cancelled')),
  title text not null,
  description text not null default '',
  failure_code text,
  failure_mode text,
  root_cause text,
  action_taken text,
  opened_at timestamptz not null default now(),
  scheduled_for timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  downtime_started_at timestamptz,
  downtime_ended_at timestamptz,
  labour_hours numeric(12,3),
  parts_cost_inr numeric(14,2) not null default 0,
  external_cost_inr numeric(14,2) not null default 0,
  evidence_reference text,
  return_to_service_reference text,
  created_by text not null,
  completed_by text,
  returned_to_service_by text,
  source_reference text not null,
  record_revision integer not null default 1 check (record_revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (labour_hours is null or labour_hours >= 0),
  check (parts_cost_inr >= 0),
  check (external_cost_inr >= 0),
  check (completed_at is null or started_at is null or completed_at >= started_at),
  check (downtime_ended_at is null or downtime_started_at is null or downtime_ended_at >= downtime_started_at)
);

create index if not exists vyndi_maintenance_work_orders_equipment_idx
  on vyndi_maintenance_work_orders(equipment_id,status,opened_at desc);
create index if not exists vyndi_maintenance_work_orders_plan_idx
  on vyndi_maintenance_work_orders(plan_id,status,opened_at desc);

create table if not exists vyndi_maintenance_parts (
  id text primary key,
  work_order_id text not null references vyndi_maintenance_work_orders(id) on delete restrict,
  sku text not null,
  quantity numeric(14,4) not null check (quantity > 0),
  unit_cost_inr numeric(14,2) not null default 0 check (unit_cost_inr >= 0),
  source_reference text not null,
  recorded_by text not null,
  created_at timestamptz not null default now()
);

create index if not exists vyndi_maintenance_parts_work_order_idx
  on vyndi_maintenance_parts(work_order_id,created_at);

comment on table vyndi_maintenance_plans is
  'Governed preventive/inspection/calibration/condition-based maintenance plans linked to the canonical epr_equipment identity.';
comment on table vyndi_maintenance_work_orders is
  'Governed asset maintenance execution history including failures, corrective action, downtime, labour/cost evidence and return-to-service authority.';
comment on table vyndi_maintenance_parts is
  'Maintenance parts-consumption evidence. This table records maintenance usage but does not itself post or mutate canonical inventory balances.';
