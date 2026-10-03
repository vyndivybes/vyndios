-- VYNDI Readiness & Evidence Confidence Engine — Package C
-- Keeps readiness, evidence completeness/confidence and risk as separate measures.
-- No composite VPRI is emitted until governed weighting is explicitly approved.

create table if not exists vyndi_readiness_evidence (
  id text primary key,
  program_id text not null default 'VYNDI-MASTER-PROGRAM'
    references vyndi_programs(id) on delete restrict,
  subject_type text not null
    check (subject_type in ('program_task','vedm_node','release_gate','risk','other')),
  subject_id text not null,
  domain text not null,
  title text not null,
  required boolean not null default true,
  evidence_state text not null default 'unrated'
    check (evidence_state in ('sufficient','insufficient','unrated','not_applicable')),
  confidence numeric(5,4),
  authority text not null default 'governed-internal',
  provenance_class text not null default 'derived'
    check (provenance_class in ('measured','calculated','derived','assumed','predicted','ai_interpreted')),
  source_reference text not null,
  notes text not null default '',
  record_revision integer not null default 1 check (record_revision > 0),
  updated_by text not null,
  updated_at timestamptz not null default now(),
  check (confidence is null or confidence between 0 and 1)
);

create index if not exists vyndi_readiness_evidence_program_idx
  on vyndi_readiness_evidence(program_id,domain,evidence_state,id);

comment on table vyndi_readiness_evidence is
  'Governed readiness evidence assessments. Evidence state and confidence are explicit and separately auditable; no confidence is inferred from mere document presence.';
