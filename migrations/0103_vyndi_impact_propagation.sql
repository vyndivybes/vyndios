-- VYNDI Engineering Impact Propagation — Package D
-- Stores immutable advisory impact-assessment snapshots. It never applies the engineering change itself.

create table if not exists vyndi_impact_assessments (
  id text primary key,
  source_node_id text not null,
  source_repository text not null,
  source_commit text not null,
  as_of_date date not null,
  change_reference text not null,
  result_json jsonb not null,
  actor_user_id text not null,
  actor_role text not null,
  created_at timestamptz not null default now()
);

create index if not exists vyndi_impact_assessments_source_idx
  on vyndi_impact_assessments(source_node_id,created_at desc);

comment on table vyndi_impact_assessments is
  'Immutable advisory Engineering Graph impact snapshots. The assessment identifies downstream review obligations; it does not approve, release or mutate engineering authority.';
