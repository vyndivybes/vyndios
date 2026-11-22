-- Vāyú Shastr pre-operational, founder-authorized genuine INTERNAL_DRAFT writes.
-- Isolated from sales, purchases, physical inventory, finance, payroll and engineering release.
-- Does not certify historical simulation as actual business records.

create table if not exists vyndi_vaos_internal_drafts (
  record_id text primary key check (record_id ~ '^VAOS-DRAFT-[A-Za-z0-9_-]{5,110}$'),
  execution_job_id text not null,
  intent_id text not null,
  idempotency_key text not null unique,
  approval_ref text not null check (approval_ref = 'founder:internal-startup-writes:20261123'),
  category text not null check (category in (
    'SIMULATION_CLASSIFICATION_REGISTER', 'ENGINEERING_EVIDENCE_REGISTER',
    'CASH_RUNWAY_REVIEW', 'FOUNDER_INTERNAL_ACTION_PLAN',
    'PURCHASE_REQUEST_DRAFT', 'SUPPLIER_OUTREACH_DRAFT'
  )),
  title text not null check (length(btrim(title)) between 1 and 160),
  content text not null check (length(content) between 8 and 8000),
  content_sha256 text not null check (content_sha256 ~ '^[0-9a-f]{64}$'),
  classification text not null default 'INTERNAL_DRAFT'
    check (classification = 'INTERNAL_DRAFT'),
  state text not null check (state in ('DRAFT_PREPARED','AWAITING_FOUNDER_APPROVAL')),
  external_sent boolean not null default false check (external_sent = false),
  purchase_issued boolean not null default false check (purchase_issued = false),
  source_reference text not null check (left(source_reference,5) = 'VAOS|'),
  record_revision integer not null default 1 check (record_revision = 1),
  created_by text not null default 'vaos-orchestrator'
    check (created_by = 'vaos-orchestrator'),
  created_at timestamptz not null default now(),
  check ((category in ('PURCHASE_REQUEST_DRAFT','SUPPLIER_OUTREACH_DRAFT')
           and state = 'AWAITING_FOUNDER_APPROVAL')
    or (category not in ('PURCHASE_REQUEST_DRAFT','SUPPLIER_OUTREACH_DRAFT')
        and state = 'DRAFT_PREPARED'))
);
revoke all on vyndi_vaos_internal_drafts from public, anon, authenticated;

create table if not exists vyndi_vaos_internal_draft_events (
  event_id uuid primary key default gen_random_uuid(),
  record_id text not null references vyndi_vaos_internal_drafts(record_id),
  event_type text not null check (event_type = 'VAOS_INTERNAL_DRAFT_PERSISTED'),
  source_reference text not null,
  content_sha256 text not null check (content_sha256 ~ '^[0-9a-f]{64}$'),
  approval_ref text not null,
  occurred_at timestamptz not null default now(),
  unique(record_id,event_type)
);
revoke all on vyndi_vaos_internal_draft_events from public, anon, authenticated;

create or replace function persist_vaos_internal_draft(
  p_record_id text,
  p_intent_id text,
  p_execution_job_id text,
  p_idempotency_key text,
  p_approval_ref text,
  p_category text,
  p_title text,
  p_content text,
  p_content_sha256 text,
  p_source_reference text
) returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_existing vyndi_vaos_internal_drafts%rowtype;
  v_state text;
begin
  if p_approval_ref is distinct from 'founder:internal-startup-writes:20261123' then
    raise exception 'INTERNAL_WRITE_APPROVAL_REQUIRED';
  end if;
  if p_record_id is null or p_record_id !~ '^VAOS-DRAFT-[A-Za-z0-9_-]{5,110}$'
    or p_intent_id is null or length(btrim(p_intent_id)) not between 1 and 160
    or p_execution_job_id is null or length(btrim(p_execution_job_id)) not between 1 and 160
    or p_idempotency_key is null or length(p_idempotency_key) not between 8 and 160
    or p_source_reference is null or left(p_source_reference,5) <> 'VAOS|'
    or position('|' || p_intent_id in p_source_reference) = 0
  then raise exception 'INTERNAL_WRITE_LINEAGE_INVALID'; end if;
  if p_category not in (
    'SIMULATION_CLASSIFICATION_REGISTER','ENGINEERING_EVIDENCE_REGISTER',
    'CASH_RUNWAY_REVIEW','FOUNDER_INTERNAL_ACTION_PLAN',
    'PURCHASE_REQUEST_DRAFT','SUPPLIER_OUTREACH_DRAFT'
  ) or p_category is null then raise exception 'INTERNAL_WRITE_CATEGORY_NOT_ALLOWED'; end if;
  if p_title is null or length(btrim(p_title)) not between 1 and 160
    or p_content is null or length(p_content) not between 8 and 8000
    or p_content_sha256 is null or p_content_sha256 !~ '^[0-9a-f]{64}$'
  then raise exception 'INTERNAL_WRITE_PAYLOAD_INVALID'; end if;

  v_state := case when p_category in ('PURCHASE_REQUEST_DRAFT','SUPPLIER_OUTREACH_DRAFT')
    then 'AWAITING_FOUNDER_APPROVAL' else 'DRAFT_PREPARED' end;

  perform pg_advisory_xact_lock(hashtext('vaos-internal-draft:' || p_idempotency_key)::bigint);
  select * into v_existing from vyndi_vaos_internal_drafts
   where idempotency_key=p_idempotency_key for update;
  if found then
    if v_existing.record_id is distinct from p_record_id
      or v_existing.intent_id is distinct from p_intent_id
      or v_existing.execution_job_id is distinct from p_execution_job_id
      or v_existing.content_sha256 is distinct from p_content_sha256
      or v_existing.category is distinct from p_category
      or v_existing.title is distinct from btrim(p_title)
      or v_existing.content is distinct from p_content
      or v_existing.source_reference is distinct from p_source_reference
    then raise exception 'INTERNAL_WRITE_IDEMPOTENCY_CONFLICT'; end if;
    return jsonb_build_object('status','DRAFT_PERSISTED','replay',true,
      'recordId',v_existing.record_id,'category',v_existing.category,
      'classification',v_existing.classification,'state',v_existing.state,
      'contentSha256',v_existing.content_sha256,'revision',v_existing.record_revision);
  end if;

  insert into vyndi_vaos_internal_drafts(
    record_id,intent_id,execution_job_id,idempotency_key,approval_ref,
    category,title,content,content_sha256,state,source_reference
  ) values (
    p_record_id,p_intent_id,p_execution_job_id,p_idempotency_key,p_approval_ref,
    p_category,btrim(p_title),p_content,p_content_sha256,v_state,p_source_reference
  );
  insert into vyndi_vaos_internal_draft_events(
    record_id,event_type,source_reference,content_sha256,approval_ref
  ) values (
    p_record_id,'VAOS_INTERNAL_DRAFT_PERSISTED',
    p_source_reference,p_content_sha256,p_approval_ref
  );
  return jsonb_build_object('status','DRAFT_PERSISTED','replay',false,
    'recordId',p_record_id,'category',p_category,
    'classification','INTERNAL_DRAFT','state',v_state,
    'contentSha256',p_content_sha256,'revision',1);
end;
$$;
revoke all on function persist_vaos_internal_draft(text,text,text,text,text,text,text,text,text,text)
  from public, anon, authenticated;
