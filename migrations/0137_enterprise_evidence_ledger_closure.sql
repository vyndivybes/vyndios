-- Enterprise evidence/ledger closure.
-- Adds empirical Vibe evidence only; existing domain transaction authorities remain canonical.

create table if not exists vyndi_vibe_decisions (
 id text primary key,
 problem text not null,
 recommendation text not null,
 evidence_refs jsonb not null default '[]'::jsonb,
 expected_outcome_json jsonb not null default '{}'::jsonb,
 source_sha text not null,
 model_version text not null,
 actor_user_id text not null,
 actor_role text not null,
 source_reference text not null,
 created_at timestamptz not null default now()
);
create table if not exists vyndi_vibe_decision_events (
 id text primary key,
 decision_id text not null references vyndi_vibe_decisions(id),
 action text not null check(action in ('recommended','approved','rejected','executed')),
 actor_user_id text not null, actor_role text not null,
 source_reference text not null, payload_json jsonb not null default '{}'::jsonb,
 created_at timestamptz not null default now()
);
create table if not exists vyndi_vibe_outcomes (
 id text primary key,
 decision_id text not null references vyndi_vibe_decisions(id),
 actual_outcome_json jsonb not null,
 variance_json jsonb not null,
 evidence_refs jsonb not null default '[]'::jsonb,
 source_sha text not null, model_version text not null,
 actor_user_id text not null, actor_role text not null, source_reference text not null,
 observed_at timestamptz not null, created_at timestamptz not null default now()
);
create table if not exists vyndi_vibe_historical_replays (
 id text primary key,
 decision_id text not null references vyndi_vibe_decisions(id),
 outcome_id text references vyndi_vibe_outcomes(id),
 provenance text not null check(provenance='historical-replay'),
 hidden_outcome_json jsonb not null, result_json jsonb not null,
 evidence_refs jsonb not null default '[]'::jsonb,
 source_sha text not null, model_version text not null,
 actor_user_id text not null, actor_role text not null, source_reference text not null,
 created_at timestamptz not null default now()
);
create table if not exists vyndi_vibe_comparator_observations (
 id text primary key,
 replay_id text references vyndi_vibe_historical_replays(id),
 comparator_id text not null, observation_json jsonb not null,
 evidence_refs jsonb not null default '[]'::jsonb,
 source_sha text not null, model_version text not null,
 actor_user_id text not null, actor_role text not null, source_reference text not null,
 created_at timestamptz not null default now()
);
create table if not exists vyndi_vibe_certification_runs (
 id text primary key,
 certification_schema text not null,
 status text not null,
 result_json jsonb not null,
 evidence_refs jsonb not null default '[]'::jsonb,
 source_sha text not null, model_version text not null,
 actor_user_id text not null, actor_role text not null, source_reference text not null,
 created_at timestamptz not null default now()
);

-- Reuse the database append-only guard established by R3 engineering governance.
do $$ declare t text; begin
 foreach t in array array['vyndi_vibe_decisions','vyndi_vibe_decision_events','vyndi_vibe_outcomes','vyndi_vibe_historical_replays','vyndi_vibe_comparator_observations','vyndi_vibe_certification_runs']
 loop
  execute format('drop trigger if exists trg_%I_append_only on %I',t,t);
  execute format('create trigger trg_%I_append_only before update or delete on %I for each row execute function vyndi_r3_append_only_guard()',t,t);
 end loop;
end $$;

create index if not exists idx_vibe_decision_events_decision on vyndi_vibe_decision_events(decision_id,created_at);
create index if not exists idx_vibe_outcomes_decision on vyndi_vibe_outcomes(decision_id,observed_at);
create index if not exists idx_vibe_replays_decision on vyndi_vibe_historical_replays(decision_id,created_at);
create index if not exists idx_vibe_comparator_replay on vyndi_vibe_comparator_observations(replay_id,created_at);

comment on table vyndi_vibe_decisions is 'Immutable Vibe recommendation evidence; never transaction authority.';
comment on table vyndi_vibe_outcomes is 'Immutable governed actual outcome evidence linked to the originating Vibe decision.';
comment on table vyndi_vibe_historical_replays is 'Immutable real historical replay evidence; synthetic fixtures are not eligible.';
comment on table vyndi_vibe_comparator_observations is 'Immutable paired external comparator observations.';
comment on table vyndi_vibe_certification_runs is 'Immutable empirical certification evidence pinned to exact source/model lineage.';
