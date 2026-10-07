-- H2 recovery qualification expansion
-- Adds append-only, request-scoped qualification evidence for multi-department,
-- configuration and binary-attachment restore verification.

create table if not exists vyndi_recovery_qualification_evidence (
  id text primary key,
  request_id text not null references vyndi_recovery_requests(id) on delete restrict,
  evidence_kind text not null check (evidence_kind in ('department','configuration','attachment')),
  scope_name text not null,
  revision integer not null check (revision > 0),
  source_hash text not null check (source_hash ~ '^[0-9a-f]{64}$'),
  restored_hash text not null check (restored_hash ~ '^[0-9a-f]{64}$'),
  source_count integer not null default 0 check (source_count >= 0),
  restored_count integer not null default 0 check (restored_count >= 0),
  source_bytes bigint check (source_bytes is null or source_bytes >= 0),
  restored_bytes bigint check (restored_bytes is null or restored_bytes >= 0),
  matched boolean not null,
  source_reference text not null,
  evidence_reference text not null,
  recorded_by text not null,
  recorded_role text not null,
  created_at timestamptz not null default now(),
  unique(request_id,evidence_kind,scope_name,revision)
);

create index if not exists vyndi_recovery_qualification_request_idx
  on vyndi_recovery_qualification_evidence(request_id,evidence_kind,scope_name,revision desc);

create or replace function deny_vyndi_recovery_qualification_mutation() returns trigger
language plpgsql as $$
begin
  raise exception 'Recovery qualification evidence is append-only.';
end;
$$;

drop trigger if exists trg_vyndi_recovery_qualification_append_only on vyndi_recovery_qualification_evidence;
create trigger trg_vyndi_recovery_qualification_append_only
before update or delete on vyndi_recovery_qualification_evidence
for each row execute function deny_vyndi_recovery_qualification_mutation();

create or replace view vyndi_recovery_qualification_current as
select distinct on (request_id,evidence_kind,scope_name)
  id,request_id,evidence_kind,scope_name,revision,source_hash,restored_hash,
  source_count,restored_count,source_bytes,restored_bytes,matched,
  source_reference,evidence_reference,recorded_by,recorded_role,created_at
from vyndi_recovery_qualification_evidence
order by request_id,evidence_kind,scope_name,revision desc,created_at desc,id desc;

create or replace view vyndi_recovery_qualification_summary as
select
  r.id as request_id,
  count(*) filter (where q.evidence_kind='department')::int as department_scope_count,
  count(*) filter (where q.evidence_kind='department' and q.matched)::int as matched_department_count,
  count(*) filter (where q.evidence_kind='configuration' and q.matched)::int as configuration_match_count,
  count(*) filter (where q.evidence_kind='attachment' and q.matched)::int as attachment_match_count,
  count(*) filter (where q.matched=false)::int as mismatch_count,
  coalesce(sum(q.source_bytes) filter (where q.evidence_kind='attachment'),0)::bigint as source_attachment_bytes,
  coalesce(sum(q.restored_bytes) filter (where q.evidence_kind='attachment'),0)::bigint as restored_attachment_bytes
from vyndi_recovery_requests r
left join vyndi_recovery_qualification_current q on q.request_id=r.id
where r.mode='full_restore'
group by r.id;

create or replace function register_vyndi_recovery_qualification_evidence(
  p_id text,
  p_request_id text,
  p_evidence_kind text,
  p_scope_name text,
  p_source_hash text,
  p_restored_hash text,
  p_source_count integer,
  p_restored_count integer,
  p_source_bytes bigint,
  p_restored_bytes bigint,
  p_source_reference text,
  p_evidence_reference text,
  p_actor_user_id text,
  p_actor_role text
) returns table (evidence_revision integer, matched boolean)
language plpgsql
as $$
declare
  v_request record;
  v_revision integer;
  v_matched boolean;
begin
  if p_actor_role<>'admin' then raise exception 'Recovery qualification evidence requires Admin role.'; end if;
  select id,mode,status,requested_by,checkpoint_id into v_request
    from vyndi_recovery_requests where id=p_request_id for update;
  if not found or v_request.mode<>'full_restore' then raise exception 'Full restore request was not found.'; end if;
  if v_request.status<>'approved' then raise exception 'Recovery qualification evidence requires an approved full restore.'; end if;
  if v_request.requested_by=p_actor_user_id then
    raise exception 'The recovery maker cannot qualify the same full restore.';
  end if;
  if p_evidence_kind not in ('department','configuration','attachment') then
    raise exception 'Unsupported recovery qualification evidence kind.';
  end if;
  if trim(coalesce(p_scope_name,''))='' then raise exception 'Recovery qualification scope is required.'; end if;
  if coalesce(p_source_count,0)<0 or coalesce(p_restored_count,0)<0 then
    raise exception 'Recovery qualification record counts cannot be negative.';
  end if;
  if p_evidence_kind='attachment' and (p_source_bytes is null or p_restored_bytes is null) then
    raise exception 'Attachment recovery evidence requires source and restored byte counts.';
  end if;
  if trim(coalesce(p_source_reference,''))='' or trim(coalesce(p_evidence_reference,''))='' then
    raise exception 'Recovery qualification source and evidence references are required.';
  end if;

  perform pg_advisory_xact_lock(hashtext(p_request_id||'|'||p_evidence_kind||'|'||lower(trim(p_scope_name)))::bigint);
  select coalesce(max(revision),0)+1 into v_revision
    from vyndi_recovery_qualification_evidence
   where request_id=p_request_id
     and evidence_kind=p_evidence_kind
     and scope_name=trim(p_scope_name);

  v_matched :=
    lower(trim(p_source_hash))=lower(trim(p_restored_hash))
    and coalesce(p_source_count,0)=coalesce(p_restored_count,0)
    and (
      p_evidence_kind<>'attachment'
      or coalesce(p_source_bytes,-1)=coalesce(p_restored_bytes,-2)
    );

  insert into vyndi_recovery_qualification_evidence(
    id,request_id,evidence_kind,scope_name,revision,source_hash,restored_hash,
    source_count,restored_count,source_bytes,restored_bytes,matched,
    source_reference,evidence_reference,recorded_by,recorded_role
  ) values (
    upper(trim(p_id)),p_request_id,p_evidence_kind,trim(p_scope_name),v_revision,
    lower(trim(p_source_hash)),lower(trim(p_restored_hash)),
    coalesce(p_source_count,0),coalesce(p_restored_count,0),p_source_bytes,p_restored_bytes,v_matched,
    trim(p_source_reference),trim(p_evidence_reference),p_actor_user_id,p_actor_role
  );

  perform append_vyndi_recovery_event(
    p_request_id,v_request.checkpoint_id,'recovery_qualification_evidence_recorded',
    p_actor_user_id,p_actor_role,p_evidence_reference,
    jsonb_build_object(
      'evidenceKind',p_evidence_kind,'scopeName',trim(p_scope_name),'revision',v_revision,
      'matched',v_matched,'sourceCount',coalesce(p_source_count,0),'restoredCount',coalesce(p_restored_count,0),
      'sourceBytes',p_source_bytes,'restoredBytes',p_restored_bytes
    )
  );

  return query select v_revision,v_matched;
end;
$$;

create or replace function validate_vyndi_full_restore(
  p_request_id text,
  p_validation_evidence jsonb,
  p_evidence_reference text,
  p_actor_user_id text,
  p_actor_role text
) returns text
language plpgsql
as $$
declare
  r record;
  q record;
  v_evidence jsonb;
begin
  if p_actor_role<>'admin' then raise exception 'Full restore validation requires Admin role.'; end if;
  select * into r from vyndi_recovery_requests where id=p_request_id for update;
  if not found or r.mode<>'full_restore' then raise exception 'Full restore request was not found.'; end if;
  if r.status<>'approved' then raise exception 'Full restore must be approved before validation.'; end if;
  if r.requested_by=p_actor_user_id then
    raise exception 'The recovery maker cannot validate the same full restore.';
  end if;

  if not coalesce((p_validation_evidence->>'hashMatch')::boolean,false)
     or not coalesce((p_validation_evidence->>'databaseHealth')::boolean,false)
     or not coalesce((p_validation_evidence->>'goldenOrder')::boolean,false)
     or not coalesce((p_validation_evidence->>'authenticatedSmoke')::boolean,false) then
    raise exception 'Full restore validation requires hash match, database health, Golden Order and authenticated smoke evidence.';
  end if;

  select * into q from vyndi_recovery_qualification_summary where request_id=p_request_id;
  if coalesce(q.mismatch_count,0)>0 then
    raise exception 'Full restore qualification contains mismatched recovery evidence.';
  end if;
  if coalesce(q.matched_department_count,0)<4 then
    raise exception 'Full restore validation requires at least four department recovery scopes.';
  end if;
  if coalesce(q.configuration_match_count,0)<1 then
    raise exception 'Full restore validation requires matched configuration recovery evidence.';
  end if;
  if coalesce(q.attachment_match_count,0)<1 then
    raise exception 'Full restore validation requires matched attachment recovery evidence.';
  end if;

  v_evidence:=coalesce(p_validation_evidence,'{}'::jsonb) || jsonb_build_object(
    'multiDepartmentRestore',true,
    'configurationHashMatch',true,
    'attachmentHashMatch',true,
    'qualificationSummary',jsonb_build_object(
      'matchedDepartmentCount',q.matched_department_count,
      'configurationMatchCount',q.configuration_match_count,
      'attachmentMatchCount',q.attachment_match_count,
      'mismatchCount',q.mismatch_count,
      'sourceAttachmentBytes',q.source_attachment_bytes,
      'restoredAttachmentBytes',q.restored_attachment_bytes
    )
  );

  update vyndi_recovery_requests
     set status='cutover_ready',validation_evidence=v_evidence,
         validated_by=p_actor_user_id,validated_at=now(),decision_note=concat_ws('; ',decision_note,'restore validated')
   where id=p_request_id;

  perform append_vyndi_recovery_event(
    p_request_id,r.checkpoint_id,'full_restore_validated',p_actor_user_id,p_actor_role,p_evidence_reference,
    v_evidence
  );
  return 'cutover_ready';
end;
$$;

comment on table vyndi_recovery_qualification_evidence is
  'Append-only source-vs-restored evidence for each full-restore qualification scope. Corrections append a higher revision.';
comment on view vyndi_recovery_qualification_summary is
  'Current full-restore qualification status across department, configuration and attachment evidence.';
