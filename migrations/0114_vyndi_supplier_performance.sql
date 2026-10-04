-- VYNDI Package O — Supplier Performance & Quality Scorecard
-- Adds governed supplier-response evidence and immutable performance snapshots.
-- Existing supplier, PO, GRN, QMS and invoice authorities remain canonical.

create table if not exists vyndi_supplier_response_events (
  id text primary key,
  supplier_id text not null references vyndi_suppliers(id) on delete restrict,
  request_reference text not null,
  request_type text not null,
  requested_at timestamptz not null,
  responded_at timestamptz not null,
  supersedes_event_id text references vyndi_supplier_response_events(id) on delete restrict,
  source_reference text not null,
  recorded_by text not null,
  recorded_role text not null,
  created_at timestamptz not null default now(),
  check (responded_at>=requested_at)
);
create index if not exists vyndi_supplier_response_supplier_idx
  on vyndi_supplier_response_events(supplier_id,request_reference,created_at desc);

create or replace view vyndi_current_supplier_response_events as
select e.*
from vyndi_supplier_response_events e
where not exists (
  select 1 from vyndi_supplier_response_events newer
  where newer.supersedes_event_id=e.id
);

create table if not exists vyndi_supplier_performance_runs (
  id text primary key,
  result_json jsonb not null,
  source_reference text not null,
  actor_user_id text not null,
  actor_role text not null,
  created_at timestamptz not null default now()
);

comment on table vyndi_supplier_response_events is
  'Append-only supplier request/response timing evidence. Corrections supersede prior events rather than mutating them.';
comment on table vyndi_supplier_performance_runs is
  'Immutable supplier performance scorecard snapshots derived from canonical supplier, PO, GRN, QMS, invoice and response evidence.';

create or replace function vyndi_reject_supplier_performance_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'Supplier performance evidence is immutable: % on % is not permitted.',tg_op,tg_table_name;
end;
$$;

drop trigger if exists trg_vyndi_supplier_response_events_immutable on vyndi_supplier_response_events;
create trigger trg_vyndi_supplier_response_events_immutable
before update or delete on vyndi_supplier_response_events
for each row execute function vyndi_reject_supplier_performance_mutation();

drop trigger if exists trg_vyndi_supplier_performance_runs_immutable on vyndi_supplier_performance_runs;
create trigger trg_vyndi_supplier_performance_runs_immutable
before update or delete on vyndi_supplier_performance_runs
for each row execute function vyndi_reject_supplier_performance_mutation();
