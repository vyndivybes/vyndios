-- VYNDI V1 H5 governed external integration contracts.
-- External systems exchange evidence/events through controlled inbox/outbox records.
-- They do not become parallel writers of canonical VYNDI business truth.

create table if not exists vyndi_integration_contracts (
  id text primary key,
  domain text not null check (domain in ('accounting','supplier','logistics','commerce')),
  provider_code text not null check (trim(provider_code) <> ''),
  direction text not null check (direction in ('inbound','outbound','bidirectional')),
  schema_version text not null check (trim(schema_version) <> ''),
  authority_owner text not null check (trim(authority_owner) <> ''),
  config_reference text not null check (trim(config_reference) <> ''),
  secret_binding_reference text,
  signature_required boolean not null default true,
  max_delivery_attempts integer not null default 5 check (max_delivery_attempts between 1 and 20),
  status text not null default 'draft' check (status in ('draft','approved','disabled')),
  prepared_by text not null,
  prepared_at timestamptz not null default now(),
  approved_by text,
  approved_at timestamptz,
  disabled_by text,
  disabled_at timestamptz,
  unique(domain,provider_code,schema_version)
);

create table if not exists vyndi_integration_inbox (
  id text primary key,
  contract_id text not null references vyndi_integration_contracts(id) on delete restrict,
  external_event_id text not null check (trim(external_event_id) <> ''),
  event_type text not null check (trim(event_type) <> ''),
  payload_json jsonb not null default '{}'::jsonb,
  payload_fingerprint text not null,
  signature_verified boolean not null default false,
  status text not null check (status in ('accepted','processed','quarantined')),
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  linked_entity_type text,
  linked_entity_id text,
  evidence_reference text not null default '',
  unique(contract_id,external_event_id)
);

create table if not exists vyndi_integration_outbox (
  id text primary key,
  contract_id text not null references vyndi_integration_contracts(id) on delete restrict,
  idempotency_key text not null check (trim(idempotency_key) <> ''),
  event_type text not null check (trim(event_type) <> ''),
  aggregate_type text not null check (trim(aggregate_type) <> ''),
  aggregate_id text not null check (trim(aggregate_id) <> ''),
  payload_json jsonb not null default '{}'::jsonb,
  payload_fingerprint text not null,
  status text not null default 'pending' check (status in ('pending','delivered','dead_letter')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  replay_count integer not null default 0 check (replay_count >= 0),
  next_attempt_at timestamptz not null default now(),
  delivered_at timestamptz,
  created_by text not null,
  created_at timestamptz not null default now(),
  unique(contract_id,idempotency_key)
);

create table if not exists vyndi_integration_delivery_attempts (
  id text primary key,
  outbox_id text not null references vyndi_integration_outbox(id) on delete restrict,
  attempt_no integer not null check (attempt_no > 0),
  replay_count integer not null default 0 check (replay_count >= 0),
  success boolean not null,
  http_status integer,
  response_reference text not null default '',
  error_class text not null default '',
  actor_reference text not null,
  attempted_at timestamptz not null default now(),
  unique(outbox_id,attempt_no,replay_count)
);


create table if not exists vyndi_integration_replay_requests (
  id text primary key,
  outbox_id text not null references vyndi_integration_outbox(id) on delete restrict,
  reason text not null check (trim(reason) <> ''),
  evidence_reference text not null check (trim(evidence_reference) <> ''),
  status text not null default 'pending' check (status in ('pending','approved','rejected','executed')),
  requested_by text not null,
  requested_at timestamptz not null default now(),
  approved_by text,
  approved_at timestamptz,
  executed_at timestamptz
);

create unique index if not exists vyndi_integration_replay_pending_uidx
  on vyndi_integration_replay_requests(outbox_id)
  where status in ('pending','approved');

create table if not exists vyndi_integration_events (
  id text primary key,
  contract_id text references vyndi_integration_contracts(id) on delete restrict,
  entity_type text not null check (trim(entity_type) <> ''),
  entity_id text not null check (trim(entity_id) <> ''),
  event_type text not null check (trim(event_type) <> ''),
  actor_user_id text not null,
  actor_role text not null,
  evidence_reference text not null default '',
  payload_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists vyndi_integration_inbox_status_idx
  on vyndi_integration_inbox(status,received_at);
create index if not exists vyndi_integration_outbox_due_idx
  on vyndi_integration_outbox(status,next_attempt_at,created_at);
create index if not exists vyndi_integration_events_entity_idx
  on vyndi_integration_events(entity_type,entity_id,created_at);

create or replace function reject_vyndi_integration_evidence_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'VYNDI integration evidence is append-only.';
end;
$$;

drop trigger if exists trg_reject_vyndi_integration_event_mutation on vyndi_integration_events;
create trigger trg_reject_vyndi_integration_event_mutation
before update or delete on vyndi_integration_events
for each row execute function reject_vyndi_integration_evidence_mutation();

drop trigger if exists trg_reject_vyndi_integration_attempt_mutation on vyndi_integration_delivery_attempts;
create trigger trg_reject_vyndi_integration_attempt_mutation
before update or delete on vyndi_integration_delivery_attempts
for each row execute function reject_vyndi_integration_evidence_mutation();

create or replace function guard_vyndi_integration_contract_mutation()
returns trigger language plpgsql as $$
begin
  if tg_op='DELETE' then raise exception 'Integration contracts cannot be deleted.'; end if;
  if old.status='approved' and (
    new.domain<>old.domain or new.provider_code<>old.provider_code or
    new.direction<>old.direction or new.schema_version<>old.schema_version or
    new.authority_owner<>old.authority_owner or new.config_reference<>old.config_reference or
    coalesce(new.secret_binding_reference,'')<>coalesce(old.secret_binding_reference,'') or
    new.signature_required<>old.signature_required or
    new.max_delivery_attempts<>old.max_delivery_attempts or
    new.prepared_by<>old.prepared_by or new.prepared_at<>old.prepared_at
  ) then
    raise exception 'Approved integration contract identity/configuration is immutable; create a new schema/version contract.';
  end if;
  if old.status<>new.status and not (
    (old.status='draft' and new.status in ('approved','disabled')) or
    (old.status='approved' and new.status='disabled')
  ) then
    raise exception 'Invalid integration contract status transition from % to %.',old.status,new.status;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_vyndi_integration_contract_mutation on vyndi_integration_contracts;
create trigger trg_guard_vyndi_integration_contract_mutation
before update or delete on vyndi_integration_contracts
for each row execute function guard_vyndi_integration_contract_mutation();

create or replace function guard_vyndi_integration_inbox_mutation()
returns trigger language plpgsql as $$
begin
  if tg_op='DELETE' then raise exception 'Integration inbox envelopes cannot be deleted.'; end if;
  if new.contract_id<>old.contract_id or new.external_event_id<>old.external_event_id or
     new.event_type<>old.event_type or new.payload_json<>old.payload_json or
     new.payload_fingerprint<>old.payload_fingerprint or new.signature_verified<>old.signature_verified or
     new.received_at<>old.received_at then
    raise exception 'Integration inbox envelope identity/payload is immutable.';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_vyndi_integration_inbox_mutation on vyndi_integration_inbox;
create trigger trg_guard_vyndi_integration_inbox_mutation
before update or delete on vyndi_integration_inbox
for each row execute function guard_vyndi_integration_inbox_mutation();

create or replace function guard_vyndi_integration_outbox_mutation()
returns trigger language plpgsql as $$
begin
  if tg_op='DELETE' then raise exception 'Integration outbox envelopes cannot be deleted.'; end if;
  if new.contract_id<>old.contract_id or new.idempotency_key<>old.idempotency_key or
     new.event_type<>old.event_type or new.aggregate_type<>old.aggregate_type or
     new.aggregate_id<>old.aggregate_id or new.payload_json<>old.payload_json or
     new.payload_fingerprint<>old.payload_fingerprint or new.created_by<>old.created_by or
     new.created_at<>old.created_at then
    raise exception 'Integration outbox identity/payload is immutable.';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_vyndi_integration_outbox_mutation on vyndi_integration_outbox;
create trigger trg_guard_vyndi_integration_outbox_mutation
before update or delete on vyndi_integration_outbox
for each row execute function guard_vyndi_integration_outbox_mutation();

create or replace function append_vyndi_integration_event(
  p_contract_id text,
  p_entity_type text,
  p_entity_id text,
  p_event_type text,
  p_actor_user_id text,
  p_actor_role text,
  p_evidence_reference text,
  p_payload_json jsonb
) returns text
language plpgsql as $$
declare v_id text;
begin
  v_id:='INTEG-EVT-'||md5(coalesce(p_contract_id,'')||'|'||p_entity_type||'|'||p_entity_id||'|'||p_event_type||'|'||clock_timestamp()::text||'|'||random()::text);
  insert into vyndi_integration_events
    (id,contract_id,entity_type,entity_id,event_type,actor_user_id,actor_role,evidence_reference,payload_json)
  values
    (v_id,p_contract_id,p_entity_type,p_entity_id,p_event_type,p_actor_user_id,p_actor_role,
     coalesce(p_evidence_reference,''),coalesce(p_payload_json,'{}'::jsonb));

  insert into vyndi_audit_events
    (id,entity_type,entity_id,action,actor_user_id,actor_role,source_reference,payload_json)
  values
    ('AUD-'||v_id,'integration_'||p_entity_type,p_entity_id,p_event_type,p_actor_user_id,p_actor_role,
     coalesce(p_evidence_reference,''),coalesce(p_payload_json,'{}'::jsonb));
  return v_id;
end;
$$;

create or replace function propose_vyndi_integration_contract(
  p_id text,
  p_domain text,
  p_provider_code text,
  p_direction text,
  p_schema_version text,
  p_authority_owner text,
  p_config_reference text,
  p_secret_binding_reference text,
  p_signature_required boolean,
  p_max_delivery_attempts integer,
  p_actor_user_id text,
  p_actor_role text
) returns text
language plpgsql as $$
begin
  if p_actor_role<>'admin' then raise exception 'Integration contract configuration requires Admin role.'; end if;
  insert into vyndi_integration_contracts
    (id,domain,provider_code,direction,schema_version,authority_owner,config_reference,
     secret_binding_reference,signature_required,max_delivery_attempts,prepared_by)
  values
    (p_id,p_domain,lower(trim(p_provider_code)),p_direction,trim(p_schema_version),trim(p_authority_owner),
     trim(p_config_reference),nullif(trim(coalesce(p_secret_binding_reference,'')),''),
     coalesce(p_signature_required,true),p_max_delivery_attempts,p_actor_user_id);

  perform append_vyndi_integration_event(
    p_id,'contract',p_id,'contract_proposed',p_actor_user_id,p_actor_role,p_config_reference,
    jsonb_build_object('domain',p_domain,'providerCode',lower(trim(p_provider_code)),'direction',p_direction,'schemaVersion',p_schema_version)
  );
  return p_id;
end;
$$;

create or replace function approve_vyndi_integration_contract(
  p_contract_id text,
  p_evidence_reference text,
  p_actor_user_id text,
  p_actor_role text
) returns text
language plpgsql as $$
declare c record;
begin
  if p_actor_role<>'admin' then raise exception 'Integration contract approval requires Admin role.'; end if;
  select * into c from vyndi_integration_contracts where id=p_contract_id for update;
  if not found then raise exception 'Integration contract not found.'; end if;
  if c.status<>'draft' then raise exception 'Only a draft integration contract can be approved.'; end if;
  if c.prepared_by=p_actor_user_id then raise exception 'A different Admin must approve the integration contract; maker/checker self-approval is not permitted.'; end if;
  if trim(coalesce(p_evidence_reference,''))='' then raise exception 'Integration contract approval evidence is required.'; end if;
  update vyndi_integration_contracts
     set status='approved',approved_by=p_actor_user_id,approved_at=now()
   where id=p_contract_id;
  perform append_vyndi_integration_event(
    p_contract_id,'contract',p_contract_id,'contract_approved',p_actor_user_id,p_actor_role,p_evidence_reference,
    jsonb_build_object('preparedBy',c.prepared_by,'approvedBy',p_actor_user_id)
  );
  return 'approved';
end;
$$;

create or replace function disable_vyndi_integration_contract(
  p_contract_id text,
  p_evidence_reference text,
  p_actor_user_id text,
  p_actor_role text
) returns text
language plpgsql as $$
declare c record;
begin
  if p_actor_role<>'admin' then raise exception 'Integration contract disable requires Admin role.'; end if;
  select * into c from vyndi_integration_contracts where id=p_contract_id for update;
  if not found then raise exception 'Integration contract not found.'; end if;
  if c.status='disabled' then return 'disabled'; end if;
  if trim(coalesce(p_evidence_reference,''))='' then raise exception 'Disable evidence is required.'; end if;
  update vyndi_integration_contracts
     set status='disabled',disabled_by=p_actor_user_id,disabled_at=now()
   where id=p_contract_id;
  perform append_vyndi_integration_event(
    p_contract_id,'contract',p_contract_id,'contract_disabled',p_actor_user_id,p_actor_role,p_evidence_reference,'{}'::jsonb
  );
  return 'disabled';
end;
$$;

create or replace function record_vyndi_integration_inbound(
  p_id text,
  p_contract_id text,
  p_external_event_id text,
  p_event_type text,
  p_payload_json jsonb,
  p_signature_verified boolean,
  p_evidence_reference text,
  p_actor_reference text
) returns table(result_id text,disposition text)
language plpgsql as $$
declare c record; existing record; v_fingerprint text; v_status text;
begin
  select * into c from vyndi_integration_contracts where id=p_contract_id;
  if not found or c.status<>'approved' then raise exception 'Approved integration contract required.'; end if;
  if c.direction not in ('inbound','bidirectional') then raise exception 'Integration contract does not permit inbound events.'; end if;
  if trim(coalesce(p_external_event_id,''))='' then raise exception 'External event id is required.'; end if;
  v_fingerprint:=md5(coalesce(p_payload_json,'{}'::jsonb)::text);

  select * into existing from vyndi_integration_inbox
   where contract_id=p_contract_id and external_event_id=p_external_event_id;
  if found then
    perform append_vyndi_integration_event(
      p_contract_id,'inbox',existing.id,
      case when existing.payload_fingerprint=v_fingerprint then 'duplicate_ignored' else 'duplicate_conflict' end,
      p_actor_reference,'system',p_evidence_reference,
      jsonb_build_object('externalEventId',p_external_event_id,'existingFingerprint',existing.payload_fingerprint,'incomingFingerprint',v_fingerprint)
    );
    return query select existing.id,
      case when existing.payload_fingerprint=v_fingerprint then 'duplicate'::text else 'idempotency_conflict'::text end;
    return;
  end if;

  v_status:=case when c.signature_required and not coalesce(p_signature_verified,false) then 'quarantined' else 'accepted' end;
  insert into vyndi_integration_inbox
    (id,contract_id,external_event_id,event_type,payload_json,payload_fingerprint,signature_verified,status,evidence_reference)
  values
    (p_id,p_contract_id,trim(p_external_event_id),trim(p_event_type),coalesce(p_payload_json,'{}'::jsonb),
     v_fingerprint,coalesce(p_signature_verified,false),v_status,coalesce(p_evidence_reference,''));

  perform append_vyndi_integration_event(
    p_contract_id,'inbox',p_id,
    case when v_status='accepted' then 'inbound_accepted' else 'inbound_quarantined' end,
    p_actor_reference,'system',p_evidence_reference,
    jsonb_build_object('externalEventId',p_external_event_id,'eventType',p_event_type,'signatureVerified',coalesce(p_signature_verified,false))
  );
  return query select p_id,v_status;
end;
$$;

create or replace function mark_vyndi_integration_inbound_processed(
  p_inbox_id text,
  p_linked_entity_type text,
  p_linked_entity_id text,
  p_evidence_reference text,
  p_actor_reference text
) returns text
language plpgsql as $$
declare i record;
begin
  select * into i from vyndi_integration_inbox where id=p_inbox_id for update;
  if not found then raise exception 'Integration inbox envelope not found.'; end if;
  if i.status<>'accepted' then raise exception 'Only an accepted inbound envelope can be marked processed.'; end if;
  if trim(coalesce(p_linked_entity_type,''))='' or trim(coalesce(p_linked_entity_id,''))='' then
    raise exception 'Canonical linked entity type/id are required before an inbound envelope is processed.';
  end if;
  update vyndi_integration_inbox
     set status='processed',processed_at=now(),linked_entity_type=trim(p_linked_entity_type),
         linked_entity_id=trim(p_linked_entity_id),evidence_reference=trim(coalesce(p_evidence_reference,''))
   where id=p_inbox_id;
  perform append_vyndi_integration_event(
    i.contract_id,'inbox',p_inbox_id,'inbound_processed',p_actor_reference,'system',p_evidence_reference,
    jsonb_build_object('linkedEntityType',p_linked_entity_type,'linkedEntityId',p_linked_entity_id)
  );
  return 'processed';
end;
$$;

create or replace function queue_vyndi_integration_outbound(
  p_id text,
  p_contract_id text,
  p_idempotency_key text,
  p_event_type text,
  p_aggregate_type text,
  p_aggregate_id text,
  p_payload_json jsonb,
  p_actor_reference text
) returns table(result_id text,disposition text)
language plpgsql as $$
declare c record; existing record; v_fingerprint text;
begin
  select * into c from vyndi_integration_contracts where id=p_contract_id;
  if not found or c.status<>'approved' then raise exception 'Approved integration contract required.'; end if;
  if c.direction not in ('outbound','bidirectional') then raise exception 'Integration contract does not permit outbound events.'; end if;
  v_fingerprint:=md5(coalesce(p_payload_json,'{}'::jsonb)::text);

  select * into existing from vyndi_integration_outbox
   where contract_id=p_contract_id and idempotency_key=p_idempotency_key;
  if found then
    perform append_vyndi_integration_event(
      p_contract_id,'outbox',existing.id,
      case when existing.payload_fingerprint=v_fingerprint then 'outbound_duplicate_ignored' else 'outbound_idempotency_conflict' end,
      p_actor_reference,'system','',
      jsonb_build_object('idempotencyKey',p_idempotency_key)
    );
    return query select existing.id,
      case when existing.payload_fingerprint=v_fingerprint then 'duplicate'::text else 'idempotency_conflict'::text end;
    return;
  end if;

  insert into vyndi_integration_outbox
    (id,contract_id,idempotency_key,event_type,aggregate_type,aggregate_id,payload_json,payload_fingerprint,created_by)
  values
    (p_id,p_contract_id,trim(p_idempotency_key),trim(p_event_type),trim(p_aggregate_type),trim(p_aggregate_id),
     coalesce(p_payload_json,'{}'::jsonb),v_fingerprint,p_actor_reference);

  perform append_vyndi_integration_event(
    p_contract_id,'outbox',p_id,'outbound_queued',p_actor_reference,'system','',
    jsonb_build_object('idempotencyKey',p_idempotency_key,'aggregateType',p_aggregate_type,'aggregateId',p_aggregate_id)
  );
  return query select p_id,'queued'::text;
end;
$$;

create or replace function record_vyndi_integration_delivery_attempt(
  p_outbox_id text,
  p_success boolean,
  p_http_status integer,
  p_response_reference text,
  p_error_class text,
  p_actor_reference text
) returns table(outbox_status text,attempt_no integer)
language plpgsql as $$
declare o record; c record; v_attempt integer; v_status text; v_delay interval;
begin
  select * into o from vyndi_integration_outbox where id=p_outbox_id for update;
  if not found then raise exception 'Integration outbox envelope not found.'; end if;
  if o.status<>'pending' then raise exception 'Only a pending outbox envelope can record a delivery attempt.'; end if;
  select * into c from vyndi_integration_contracts where id=o.contract_id;
  if c.status<>'approved' then raise exception 'Integration contract is not approved.'; end if;

  v_attempt:=o.attempt_count+1;
  insert into vyndi_integration_delivery_attempts
    (id,outbox_id,attempt_no,replay_count,success,http_status,response_reference,error_class,actor_reference)
  values
    ('INTEG-ATT-'||md5(p_outbox_id||'|'||o.replay_count::text||'|'||v_attempt::text||'|'||clock_timestamp()::text),
     p_outbox_id,v_attempt,o.replay_count,coalesce(p_success,false),p_http_status,
     coalesce(p_response_reference,''),coalesce(p_error_class,''),p_actor_reference);

  if coalesce(p_success,false) then
    v_status:='delivered';
    update vyndi_integration_outbox
       set status='delivered',attempt_count=v_attempt,delivered_at=now()
     where id=p_outbox_id;
    update vyndi_integration_replay_requests
       set status='executed',executed_at=now()
     where outbox_id=p_outbox_id and status='approved';
  elsif v_attempt>=c.max_delivery_attempts then
    v_status:='dead_letter';
    update vyndi_integration_outbox
       set status='dead_letter',attempt_count=v_attempt
     where id=p_outbox_id;
  else
    v_status:='pending';
    v_delay:=case v_attempt when 1 then interval '1 minute' when 2 then interval '5 minutes'
      when 3 then interval '15 minutes' else interval '60 minutes' end;
    update vyndi_integration_outbox
       set attempt_count=v_attempt,next_attempt_at=now()+v_delay
     where id=p_outbox_id;
  end if;

  perform append_vyndi_integration_event(
    o.contract_id,'outbox',p_outbox_id,
    case when v_status='delivered' then 'outbound_delivered'
         when v_status='dead_letter' then 'outbound_dead_letter' else 'outbound_retry_scheduled' end,
    p_actor_reference,'system',p_response_reference,
    jsonb_build_object('attemptNo',v_attempt,'replayCount',o.replay_count,'httpStatus',p_http_status,'errorClass',coalesce(p_error_class,''))
  );
  return query select v_status,v_attempt;
end;
$$;

create or replace function request_vyndi_integration_replay(
  p_request_id text,
  p_outbox_id text,
  p_reason text,
  p_evidence_reference text,
  p_actor_user_id text,
  p_actor_role text
) returns text
language plpgsql as $$
declare o record;
begin
  if p_actor_role<>'admin' then raise exception 'Dead-letter replay requires Admin role.'; end if;
  select * into o from vyndi_integration_outbox where id=p_outbox_id;
  if not found or o.status<>'dead_letter' then raise exception 'Only a dead-letter outbox envelope can be requested for replay.'; end if;
  insert into vyndi_integration_replay_requests
    (id,outbox_id,reason,evidence_reference,requested_by)
  values
    (p_request_id,p_outbox_id,trim(p_reason),trim(p_evidence_reference),p_actor_user_id);
  perform append_vyndi_integration_event(
    o.contract_id,'replay',p_request_id,'replay_requested',p_actor_user_id,p_actor_role,p_evidence_reference,
    jsonb_build_object('outboxId',p_outbox_id,'reason',p_reason)
  );
  return p_request_id;
end;
$$;

create or replace function approve_vyndi_integration_replay(
  p_request_id text,
  p_evidence_reference text,
  p_actor_user_id text,
  p_actor_role text
) returns text
language plpgsql as $$
declare r record; o record;
begin
  if p_actor_role<>'admin' then raise exception 'Dead-letter replay approval requires Admin role.'; end if;
  select * into r from vyndi_integration_replay_requests where id=p_request_id for update;
  if not found then raise exception 'Integration replay request not found.'; end if;
  if r.status<>'pending' then raise exception 'Only a pending replay request can be approved.'; end if;
  if r.requested_by=p_actor_user_id then raise exception 'A different Admin must approve dead-letter replay; maker/checker self-approval is not permitted.'; end if;
  select * into o from vyndi_integration_outbox where id=r.outbox_id for update;
  if o.status<>'dead_letter' then raise exception 'Outbox envelope is no longer dead-lettered.'; end if;

  update vyndi_integration_replay_requests
     set status='approved',approved_by=p_actor_user_id,approved_at=now()
   where id=p_request_id;
  update vyndi_integration_outbox
     set status='pending',attempt_count=0,replay_count=replay_count+1,next_attempt_at=now(),delivered_at=null
   where id=r.outbox_id;

  perform append_vyndi_integration_event(
    o.contract_id,'replay',p_request_id,'replay_approved',p_actor_user_id,p_actor_role,p_evidence_reference,
    jsonb_build_object('outboxId',r.outbox_id,'requestedBy',r.requested_by,'approvedBy',p_actor_user_id)
  );
  return 'approved';
end;
$$;

create or replace view vyndi_integration_control_summary as
select c.id,c.domain,c.provider_code,c.direction,c.schema_version,c.status,c.prepared_by,c.approved_by,
       count(distinct i.id) as inbox_count,
       count(distinct i.id) filter(where i.status='quarantined') as quarantined_inbox_count,
       count(distinct o.id) as outbox_count,
       count(distinct o.id) filter(where o.status='pending') as pending_outbox_count,
       count(distinct o.id) filter(where o.status='dead_letter') as dead_letter_count,
       max(greatest(coalesce(i.received_at,'epoch'::timestamptz),coalesce(o.created_at,'epoch'::timestamptz))) as latest_activity_at
  from vyndi_integration_contracts c
  left join vyndi_integration_inbox i on i.contract_id=c.id
  left join vyndi_integration_outbox o on o.contract_id=c.id
 group by c.id,c.domain,c.provider_code,c.direction,c.schema_version,c.status,c.prepared_by,c.approved_by
 order by c.domain,c.provider_code,c.schema_version;

comment on table vyndi_integration_contracts is
  'H5 governed external integration contracts. Provider secrets are never stored here; only secret-binding references are permitted.';
comment on table vyndi_integration_inbox is
  'Immutable inbound envelopes with provider event idempotency and signature-verification disposition. Processing only records linkage to canonical VYNDI authority.';
comment on table vyndi_integration_outbox is
  'Durable outbound event queue with idempotency, bounded retries and dead-letter state; it does not replace canonical transaction truth.';
comment on table vyndi_integration_delivery_attempts is
  'Append-only outbound delivery evidence across initial and approved replay cycles.';
comment on table vyndi_integration_events is
  'Append-only H5 integration governance evidence mirrored into the canonical VYNDI audit-event stream.';
