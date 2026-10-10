-- Controlled schedule revisions (additive; requires separate migration qualification).
-- No existing program tasks or approved financial master-plan revisions are modified.
create table if not exists vyndi_schedule_revisions (
  id text primary key,
  program_id text not null references vyndi_programs(id) on delete restrict,
  parent_revision_id text references vyndi_schedule_revisions(id) on delete restrict,
  state text not null default 'draft' check (state in ('draft','submitted','rejected','approved','superseded')),
  scenario text not null default 'base',
  rationale text not null,
  source_reference text not null,
  proposed_by text not null,
  proposed_at timestamptz not null default now(),
  reviewed_by text,
  reviewed_at timestamptz,
  approval_reference text,
  approved_at timestamptz,
  approved_timezone text,
  baseline_hash text,
  document_json jsonb not null default '{}'::jsonb,
  check (state <> 'approved' or (
    reviewed_by is not null and reviewed_by <> proposed_by and
    reviewed_at is not null and approval_reference is not null and
    approved_at is not null and approved_timezone is not null and
    baseline_hash ~ '^sha256:[a-f0-9]{64}$'
  ))
);
create table if not exists vyndi_schedule_revision_changes (
  revision_id text not null references vyndi_schedule_revisions(id) on delete restrict,
  sequence_no integer not null check (sequence_no > 0),
  task_id text not null references vyndi_program_tasks(id) on delete restrict,
  field_name text not null check (field_name in (
    'title','domain','workPackage','owner','plannedStart','plannedFinish',
    'durationDays','predecessors','budgetLakh','milestoneMonth','scenario',
    'scope','status','deferUntil'
  )),
  old_value jsonb not null,
  new_value jsonb not null,
  source_reference text not null,
  primary key (revision_id,sequence_no),
  check (old_value <> new_value)
);
create unique index if not exists vyndi_schedule_one_approved_revision
  on vyndi_schedule_revisions(program_id) where state = 'approved';
create index if not exists vyndi_schedule_revision_history
  on vyndi_schedule_revisions(program_id,proposed_at desc);
comment on table vyndi_schedule_revisions is
  'Schedule revision proposals and independently reviewed baselines; not the separate financial master-plan authority.';
comment on table vyndi_schedule_revision_changes is
  'Per-field before/after schedule changes with evidence; database writes require governed application APIs.';
