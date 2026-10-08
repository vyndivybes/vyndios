-- Stage-3 VAOS write qualification canary.
-- Qualification only: this does not commission any operational mutation route.
-- A successful canary creates a synthetic lead and compensates it to cancelled
-- in the same PostgreSQL transaction, leaving immutable qualification evidence.

create table if not exists vyndi_vaos_write_qualifications (
  execution_job_id text primary key,
  intent_id text not null,
  approval_id text not null,
  idempotency_key text not null unique,
  canary_id text not null unique,
  action_type text not null check (action_type = 'COMMERCIAL.COMMIT_ORDER'),
  qualification_profile text not null check (qualification_profile = 'COMMERCIAL_WRITE_CANARY_V1'),
  requested_by_hash text not null check (requested_by_hash ~ '^[0-9a-f]{64}$'),
  approved_by_hash text not null check (approved_by_hash ~ '^[0-9a-f]{64}$'),
  initial_revision integer not null,
  final_revision integer not null,
  outcome text not null check (outcome = 'COMPENSATED'),
  final_state text not null check (final_state = 'cancelled'),
  before_state jsonb not null,
  after_state jsonb not null,
  created_at timestamptz not null default now(),
  check (requested_by_hash <> approved_by_hash),
  check (final_revision > initial_revision)
);

revoke all on vyndi_vaos_write_qualifications from public;

create or replace function qualify_vaos_commercial_write_canary(
  p_execution_job_id text,
  p_intent_id text,
  p_approval_id text,
  p_idempotency_key text,
  p_requested_by_hash text,
  p_approved_by_hash text,
  p_canary_id text,
  p_qualification_profile text
) returns jsonb
language plpgsql
as $$
declare
  v_existing vyndi_vaos_write_qualifications%rowtype;
  v_initial_revision integer;
  v_final_revision integer;
  v_final_status text;
  v_before jsonb := jsonb_build_object('exists',false);
  v_after jsonb;
begin
  if p_qualification_profile is distinct from 'COMMERCIAL_WRITE_CANARY_V1' then
    raise exception 'WRITE_QUALIFICATION_PROFILE_INVALID';
  end if;
  if p_execution_job_id is null or btrim(p_execution_job_id)='' then
    raise exception 'WRITE_QUALIFICATION_JOB_REQUIRED';
  end if;
  if p_intent_id is null or btrim(p_intent_id)=''
     or p_approval_id is null or btrim(p_approval_id)=''
     or p_idempotency_key is null or btrim(p_idempotency_key)='' then
    raise exception 'WRITE_QUALIFICATION_LINEAGE_REQUIRED';
  end if;
  if p_requested_by_hash !~ '^[0-9a-f]{64}$'
     or p_approved_by_hash !~ '^[0-9a-f]{64}$'
     or p_requested_by_hash = p_approved_by_hash then
    raise exception 'MAKER_CHECKER_REQUIRED';
  end if;
  if p_canary_id is distinct from 'VAOS-CANARY-SO-' || p_execution_job_id then
    raise exception 'WRITE_QUALIFICATION_CANARY_ID_INVALID';
  end if;

  perform pg_advisory_xact_lock(hashtext('vaos-write-qualification|' || p_execution_job_id)::bigint);

  select * into v_existing
    from vyndi_vaos_write_qualifications
   where execution_job_id=p_execution_job_id;

  if v_existing.execution_job_id is not null then
    return jsonb_build_object(
      'canaryId',v_existing.canary_id,
      'qualificationProfile',v_existing.qualification_profile,
      'outcome',v_existing.outcome,
      'finalState',v_existing.final_state,
      'initialRevision',v_existing.initial_revision,
      'finalRevision',v_existing.final_revision,
      'replay',true
    );
  end if;

  if exists(select 1 from vyndi_sales_orders where id=p_canary_id) then
    raise exception 'WRITE_QUALIFICATION_CANARY_COLLISION';
  end if;

  select revision into v_initial_revision
    from save_vyndi_sales_order(
      p_canary_id,
      36,
      'aluminium',
      1,
      0,
      'direct',
      'lead',
      null,
      null,
      null,
      '{}'::jsonb,
      'VAOS Stage-3 write qualification synthetic lead',
      'vaos-write-qualification',
      'system'
    );

  if v_initial_revision is null then
    raise exception 'WRITE_QUALIFICATION_CREATE_FAILED';
  end if;

  select revision into v_final_revision
    from save_vyndi_sales_order(
      p_canary_id,
      36,
      'aluminium',
      1,
      0,
      'direct',
      'cancelled',
      null,
      null,
      null,
      '{}'::jsonb,
      'VAOS Stage-3 automatic compensation',
      'vaos-write-qualification',
      'system'
    );

  select status into v_final_status
    from vyndi_sales_orders
   where id=p_canary_id;

  if v_final_revision is null
     or v_final_revision <= v_initial_revision
     or v_final_status is distinct from 'cancelled' then
    raise exception 'WRITE_QUALIFICATION_COMPENSATION_FAILED';
  end if;

  v_after := jsonb_build_object(
    'exists',true,
    'status',v_final_status,
    'revision',v_final_revision
  );

  insert into vyndi_vaos_write_qualifications(
    execution_job_id,intent_id,approval_id,idempotency_key,canary_id,
    action_type,qualification_profile,requested_by_hash,approved_by_hash,
    initial_revision,final_revision,outcome,final_state,before_state,after_state
  ) values (
    p_execution_job_id,p_intent_id,p_approval_id,p_idempotency_key,p_canary_id,
    'COMMERCIAL.COMMIT_ORDER','COMMERCIAL_WRITE_CANARY_V1',
    p_requested_by_hash,p_approved_by_hash,
    v_initial_revision,v_final_revision,'COMPENSATED','cancelled',v_before,v_after
  );

  return jsonb_build_object(
    'canaryId',p_canary_id,
    'qualificationProfile','COMMERCIAL_WRITE_CANARY_V1',
    'outcome','COMPENSATED',
    'finalState','cancelled',
    'initialRevision',v_initial_revision,
    'finalRevision',v_final_revision,
    'replay',false
  );
end;
$$;
