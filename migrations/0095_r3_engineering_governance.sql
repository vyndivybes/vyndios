-- R3 engineering governance: governed workflow, immutable evidence decisions,
-- deterministic release decisions, and digital-product-thread snapshots.

create table if not exists vyndi_engineering_workflows (
  id text primary key,
  subject_id text not null,
  subject_type text not null default 'vedm_authority',
  state text not null default 'draft'
    check (state in ('draft','pending_approval','approved','released','superseded','rejected','blocked')),
  criticality text not null default 'release'
    check (criticality in ('ordinary','release')),
  blocker_ids jsonb not null default '[]'::jsonb,
  supersedes_id text,
  successor_id text,
  source_ref text not null,
  created_by text not null,
  created_role text not null,
  record_revision integer not null default 1 check (record_revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_vyndi_engineering_workflows_subject
  on vyndi_engineering_workflows(subject_id,state,updated_at desc);

create table if not exists vyndi_engineering_workflow_events (
  id text primary key,
  workflow_id text not null references vyndi_engineering_workflows(id),
  from_state text,
  to_state text not null,
  decision_code text not null,
  actor_user_id text not null,
  actor_role text not null,
  actor_authority text not null,
  reason text not null,
  source_ref text not null,
  payload_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists vyndi_engineering_waivers (
  id text primary key,
  workflow_id text not null references vyndi_engineering_workflows(id),
  blocker_id text not null,
  blocker_class text not null,
  requested_by text not null,
  approved_by text not null,
  reason text not null,
  evidence_ref text not null,
  expires_at date not null,
  source_ref text not null,
  created_at timestamptz not null default now()
);

alter table vyndi_engineering_evidence_receipts
  add column if not exists authority_node_id text,
  add column if not exists authority_source_commit text;

create table if not exists vyndi_engineering_evidence_acceptances (
  id text primary key,
  receipt_fingerprint text not null references vyndi_engineering_evidence_receipts(fingerprint),
  authority_node_id text not null,
  authority_source_commit text not null,
  decision text not null check (decision in ('accepted','rejected','superseded')),
  reason text not null,
  actor_user_id text not null,
  actor_role text not null,
  source_ref text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_vyndi_engineering_evidence_acceptance_fingerprint
  on vyndi_engineering_evidence_acceptances(receipt_fingerprint,created_at desc);

create table if not exists vyndi_engineering_release_decisions (
  id text primary key,
  workflow_id text not null references vyndi_engineering_workflows(id),
  subject_id text not null,
  release_fingerprint text not null unique,
  source_repository text not null,
  source_commit text not null,
  as_of_date date not null,
  controlling_authority_id text,
  releasable boolean not null,
  blocker_ids jsonb not null default '[]'::jsonb,
  accepted_evidence_fingerprints jsonb not null default '[]'::jsonb,
  authority_snapshot_json jsonb not null,
  actor_user_id text not null,
  actor_role text not null,
  decision text not null check (decision in ('assessed','released','blocked')),
  source_ref text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_vyndi_engineering_release_decisions_subject
  on vyndi_engineering_release_decisions(subject_id,created_at desc);

create table if not exists vyndi_engineering_thread_snapshots (
  id text primary key,
  subject_id text not null,
  source_repository text not null,
  source_commit text not null,
  node_count integer not null check (node_count >= 0),
  edge_count integer not null check (edge_count >= 0),
  gap_count integer not null check (gap_count >= 0),
  snapshot_json jsonb not null,
  actor_user_id text not null,
  actor_role text not null,
  source_ref text not null,
  created_at timestamptz not null default now()
);

create table if not exists vyndi_engineering_thread_links (
  id text primary key,
  snapshot_id text not null references vyndi_engineering_thread_snapshots(id),
  from_node_id text not null,
  to_node_id text not null,
  relation text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_vyndi_engineering_thread_links_snapshot
  on vyndi_engineering_thread_links(snapshot_id,from_node_id,to_node_id);

-- One common append-only trigger for event/evidence/release/thread history.
create or replace function vyndi_r3_append_only_guard()
returns trigger language plpgsql as $$
begin
  raise exception '% is append-only', tg_table_name;
end;
$$;

drop trigger if exists trg_vyndi_engineering_workflow_events_append_only on vyndi_engineering_workflow_events;
create trigger trg_vyndi_engineering_workflow_events_append_only
before update or delete on vyndi_engineering_workflow_events
for each row execute function vyndi_r3_append_only_guard();

drop trigger if exists trg_vyndi_engineering_waivers_append_only on vyndi_engineering_waivers;
create trigger trg_vyndi_engineering_waivers_append_only
before update or delete on vyndi_engineering_waivers
for each row execute function vyndi_r3_append_only_guard();

drop trigger if exists trg_vyndi_engineering_evidence_acceptances_append_only on vyndi_engineering_evidence_acceptances;
create trigger trg_vyndi_engineering_evidence_acceptances_append_only
before update or delete on vyndi_engineering_evidence_acceptances
for each row execute function vyndi_r3_append_only_guard();

drop trigger if exists trg_vyndi_engineering_release_decisions_append_only on vyndi_engineering_release_decisions;
create trigger trg_vyndi_engineering_release_decisions_append_only
before update or delete on vyndi_engineering_release_decisions
for each row execute function vyndi_r3_append_only_guard();

drop trigger if exists trg_vyndi_engineering_thread_snapshots_append_only on vyndi_engineering_thread_snapshots;
create trigger trg_vyndi_engineering_thread_snapshots_append_only
before update or delete on vyndi_engineering_thread_snapshots
for each row execute function vyndi_r3_append_only_guard();

drop trigger if exists trg_vyndi_engineering_thread_links_append_only on vyndi_engineering_thread_links;
create trigger trg_vyndi_engineering_thread_links_append_only
before update or delete on vyndi_engineering_thread_links
for each row execute function vyndi_r3_append_only_guard();

comment on table vyndi_engineering_workflows is
  'R3-B mutable engineering lifecycle head. Every transition is separately recorded in append-only workflow events.';
comment on table vyndi_engineering_evidence_acceptances is
  'R3-C append-only human acceptance/rejection/supersession decisions over immutable evidence receipts.';
comment on table vyndi_engineering_release_decisions is
  'R3-C immutable deterministic release assessments/decisions pinned to one VEDM authority snapshot.';
comment on table vyndi_engineering_thread_snapshots is
  'R3-E immutable digital-product-thread snapshots spanning engineering authority and downstream execution lineage.';
