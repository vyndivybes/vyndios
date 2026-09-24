-- VYNDI engineering evidence receiver
-- Append-only governed receipt ledger for packets emitted by vayu-shastr/design.

create table if not exists vyndi_engineering_evidence_receipts (
  id text primary key,
  fingerprint text not null unique,
  schema_id text not null,
  configuration_id text not null,
  revision text not null,
  readiness_status text,
  release_authority text not null,
  actor_user_id text not null,
  actor_role text not null,
  source_origin text,
  payload_json jsonb not null,
  received_at timestamptz not null default now()
);

create index if not exists idx_vyndi_engineering_evidence_configuration
  on vyndi_engineering_evidence_receipts(configuration_id, received_at desc);

create or replace function vyndi_engineering_evidence_append_only()
returns trigger
language plpgsql
as $$
begin
  raise exception 'vyndi_engineering_evidence_receipts is append-only';
end;
$$;

drop trigger if exists trg_vyndi_engineering_evidence_append_only
  on vyndi_engineering_evidence_receipts;

create trigger trg_vyndi_engineering_evidence_append_only
before update or delete on vyndi_engineering_evidence_receipts
for each row execute function vyndi_engineering_evidence_append_only();
