-- Stage-4 VAOS approved operational write: People master draft only.
-- Exactly one operational mutation is commissioned. It is limited to existing
-- draft People records, requires optimistic revision control, independent
-- maker/checker approval lineage, idempotency and immutable evidence.

create table if not exists vyndi_vaos_operational_writes (
  execution_job_id text primary key,
  intent_id text not null,
  approval_id text not null,
  idempotency_key text not null unique,
  action_type text not null check (action_type = 'PEOPLE.CHANGE_EMPLOYEE_MASTER'),
  operational_profile text not null check (operational_profile = 'PEOPLE_DRAFT_MASTER_V1'),
  requested_by_hash text not null check (requested_by_hash ~ '^[0-9a-f]{64}$'),
  approved_by_hash text not null check (approved_by_hash ~ '^[0-9a-f]{64}$'),
  target_id text not null,
  initial_revision integer not null check (initial_revision > 0),
  final_revision integer not null,
  outcome text not null check (outcome = 'EXECUTED'),
  final_state text not null check (final_state = 'draft'),
  before_state jsonb not null,
  after_state jsonb not null,
  created_at timestamptz not null default now(),
  check (requested_by_hash <> approved_by_hash),
  check (final_revision > initial_revision)
);

revoke all on vyndi_vaos_operational_writes from public;

create or replace function execute_vaos_people_master_draft_change(
  p_execution_job_id text,
  p_intent_id text,
  p_approval_id text,
  p_idempotency_key text,
  p_requested_by_hash text,
  p_approved_by_hash text,
  p_operational_profile text,
  p_target_id text,
  p_expected_revision integer,
  p_display_name text,
  p_function_name text,
  p_role_title text,
  p_engagement_type text,
  p_start_month integer,
  p_end_month integer,
  p_source_reference text,
  p_notes text
) returns jsonb
language plpgsql
as $$
declare
  v_existing vyndi_vaos_operational_writes%rowtype;
  v_current vyndi_people_records%rowtype;
  v_final_revision integer;
  v_before jsonb;
  v_after jsonb;
  v_expected_source text;
begin
  if p_operational_profile is distinct from 'PEOPLE_DRAFT_MASTER_V1' then
    raise exception 'OPERATIONAL_WRITE_PROFILE_INVALID';
  end if;
  if p_execution_job_id is null or btrim(p_execution_job_id)=''
     or p_intent_id is null or btrim(p_intent_id)=''
     or p_approval_id is null or btrim(p_approval_id)=''
     or p_idempotency_key is null or length(btrim(p_idempotency_key)) < 4 then
    raise exception 'OPERATIONAL_WRITE_LINEAGE_REQUIRED';
  end if;
  if p_requested_by_hash !~ '^[0-9a-f]{64}$'
     or p_approved_by_hash !~ '^[0-9a-f]{64}$'
     or p_requested_by_hash = p_approved_by_hash then
    raise exception 'MAKER_CHECKER_REQUIRED';
  end if;
  if p_target_id is null or btrim(p_target_id)='' or length(p_target_id)>120 then
    raise exception 'PEOPLE_TARGET_REQUIRED';
  end if;
  if p_expected_revision is null or p_expected_revision < 1 then
    raise exception 'EXPECTED_REVISION_REQUIRED';
  end if;
  if p_display_name is null or btrim(p_display_name)='' or length(p_display_name)>300
     or p_function_name is null or btrim(p_function_name)='' or length(p_function_name)>200
     or p_role_title is null or btrim(p_role_title)='' or length(p_role_title)>200 then
    raise exception 'PEOPLE_MASTER_INPUT_INVALID';
  end if;
  if p_engagement_type not in ('employee','contractor','consultant','planned_role') then
    raise exception 'PEOPLE_ENGAGEMENT_TYPE_INVALID';
  end if;
  if p_start_month is not null and (p_start_month<1 or p_start_month>36) then
    raise exception 'PEOPLE_START_MONTH_INVALID';
  end if;
  if p_end_month is not null and (p_end_month<1 or p_end_month>36) then
    raise exception 'PEOPLE_END_MONTH_INVALID';
  end if;
  if p_start_month is not null and p_end_month is not null and p_end_month<p_start_month then
    raise exception 'PEOPLE_MONTH_RANGE_INVALID';
  end if;
  if length(coalesce(p_notes,''))>2000 then
    raise exception 'PEOPLE_NOTES_INVALID';
  end if;

  v_expected_source := 'VAOS|' || p_intent_id || '|' || p_execution_job_id;
  if p_source_reference is distinct from v_expected_source then
    raise exception 'OPERATIONAL_WRITE_SOURCE_REFERENCE_INVALID';
  end if;

  perform pg_advisory_xact_lock(hashtext('vaos-operational-write|' || p_target_id)::bigint);

  select * into v_existing
    from vyndi_vaos_operational_writes
   where execution_job_id=p_execution_job_id
      or idempotency_key=p_idempotency_key
   order by case when execution_job_id=p_execution_job_id then 0 else 1 end
   limit 1;

  if v_existing.execution_job_id is not null then
    if v_existing.execution_job_id is distinct from p_execution_job_id
       or v_existing.intent_id is distinct from p_intent_id
       or v_existing.approval_id is distinct from p_approval_id
       or v_existing.idempotency_key is distinct from p_idempotency_key
       or v_existing.target_id is distinct from p_target_id
       or v_existing.operational_profile is distinct from p_operational_profile then
      raise exception 'OPERATIONAL_WRITE_IDEMPOTENCY_CONFLICT';
    end if;
    return jsonb_build_object(
      'resourceId',v_existing.target_id,
      'operationalWriteProfile',v_existing.operational_profile,
      'outcome',v_existing.outcome,
      'finalState',v_existing.final_state,
      'initialRevision',v_existing.initial_revision,
      'finalRevision',v_existing.final_revision,
      'replay',true
    );
  end if;

  select * into v_current
    from vyndi_people_records
   where id=p_target_id
   for update;

  if v_current.id is null then
    raise exception 'People record not found.';
  end if;
  if v_current.lifecycle_status is distinct from 'draft' then
    raise exception 'Only draft People records may be edited; create a controlled superseding record instead.';
  end if;
  if v_current.record_revision is distinct from p_expected_revision then
    raise exception 'Stale People record revision: expected %, current %.', p_expected_revision, v_current.record_revision;
  end if;

  v_before := jsonb_build_object(
    'id',v_current.id,
    'displayName',v_current.display_name,
    'functionName',v_current.function_name,
    'roleTitle',v_current.role_title,
    'engagementType',v_current.engagement_type,
    'lifecycleStatus',v_current.lifecycle_status,
    'startMonth',v_current.start_month,
    'endMonth',v_current.end_month,
    'sourceReference',v_current.source_ref,
    'notes',v_current.notes,
    'recordRevision',v_current.record_revision,
    'operationalStatus',v_current.operational_status
  );

  update vyndi_people_records
     set display_name=p_display_name,
         function_name=p_function_name,
         role_title=p_role_title,
         engagement_type=p_engagement_type,
         start_month=p_start_month,
         end_month=p_end_month,
         source_ref=p_source_reference,
         notes=coalesce(p_notes,''),
         record_revision=record_revision+1,
         updated_at=now()
   where id=p_target_id
     and lifecycle_status='draft'
     and record_revision=p_expected_revision
   returning record_revision into v_final_revision;

  if v_final_revision is null then
    raise exception 'Stale People record revision; reload before saving.';
  end if;

  select jsonb_build_object(
    'id',id,
    'displayName',display_name,
    'functionName',function_name,
    'roleTitle',role_title,
    'engagementType',engagement_type,
    'lifecycleStatus',lifecycle_status,
    'startMonth',start_month,
    'endMonth',end_month,
    'sourceReference',source_ref,
    'notes',notes,
    'recordRevision',record_revision,
    'operationalStatus',operational_status
  ) into v_after
  from vyndi_people_records
  where id=p_target_id;

  insert into vyndi_audit_events(
    id,entity_type,entity_id,entity_revision,action,actor_user_id,actor_role,
    source_reference,payload_json,previous_state,new_state,reason
  ) values(
    p_execution_job_id || ':people-master',
    'people_record',
    p_target_id,
    v_final_revision,
    'PEOPLE_RECORD_DRAFT_SAVED',
    'vaos-approved-write',
    'system',
    p_source_reference,
    jsonb_build_object(
      'operationalWriteProfile',p_operational_profile,
      'approvalId',p_approval_id,
      'executionJobId',p_execution_job_id,
      'requestedByHash',p_requested_by_hash,
      'approvedByHash',p_approved_by_hash,
      'engagementType',p_engagement_type
    ),
    'draft',
    'draft',
    'Stage-4 approved VAOS operational People master draft write'
  );

  insert into vyndi_vaos_operational_writes(
    execution_job_id,intent_id,approval_id,idempotency_key,action_type,
    operational_profile,requested_by_hash,approved_by_hash,target_id,
    initial_revision,final_revision,outcome,final_state,before_state,after_state
  ) values(
    p_execution_job_id,p_intent_id,p_approval_id,p_idempotency_key,
    'PEOPLE.CHANGE_EMPLOYEE_MASTER',p_operational_profile,
    p_requested_by_hash,p_approved_by_hash,p_target_id,
    p_expected_revision,v_final_revision,'EXECUTED','draft',v_before,v_after
  );

  return jsonb_build_object(
    'resourceId',p_target_id,
    'operationalWriteProfile',p_operational_profile,
    'outcome','EXECUTED',
    'finalState','draft',
    'initialRevision',p_expected_revision,
    'finalRevision',v_final_revision,
    'replay',false
  );
end;
$$;

revoke all on function execute_vaos_people_master_draft_change(
  text,text,text,text,text,text,text,text,integer,text,text,text,text,integer,integer,text,text
) from public;
