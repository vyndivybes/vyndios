-- VYNDI H4 IAM / Segregation-of-Duties / Access Certification
-- Routine role changes become maker/checker. The existing single-role-per-user
-- schema remains the primary SoD boundary. Privileged identity events and
-- certification snapshots are immutable audit evidence.

create table if not exists vyndi_access_role_change_requests (
  id text primary key,
  target_user_id text not null,
  from_role text,
  to_role text not null check (to_role in ('admin','management','board','finance','operations','engineering','qa','compliance','viewer')),
  reason text not null check (length(trim(reason)) > 0),
  status text not null default 'pending' check (status in ('pending','applied','rejected')),
  requested_by text not null,
  requested_at timestamptz not null default now(),
  decided_by text,
  decided_at timestamptz,
  decision_note text,
  emergency_override boolean not null default false,
  check (from_role is null or from_role in ('admin','management','board','finance','operations','engineering','qa','compliance','viewer'))
);

create unique index if not exists vyndi_access_one_pending_role_change_per_user_uidx
  on vyndi_access_role_change_requests(target_user_id)
  where status='pending';

create index if not exists vyndi_access_role_change_status_idx
  on vyndi_access_role_change_requests(status, requested_at desc);

create table if not exists vyndi_access_events (
  id text primary key,
  event_type text not null check (event_type in (
    'user_provisioned',
    'role_change_requested',
    'role_change_approved',
    'role_change_rejected',
    'role_change_emergency',
    'password_reset',
    'user_deleted',
    'access_certified'
  )),
  target_user_id text,
  actor_user_id text not null,
  actor_role text not null,
  role_before text,
  role_after text,
  reason text,
  source_reference text,
  metadata_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check (role_before is null or role_before in ('admin','management','board','finance','operations','engineering','qa','compliance','viewer')),
  check (role_after is null or role_after in ('admin','management','board','finance','operations','engineering','qa','compliance','viewer'))
);

create index if not exists vyndi_access_events_target_idx
  on vyndi_access_events(target_user_id, created_at desc);
create index if not exists vyndi_access_events_actor_idx
  on vyndi_access_events(actor_user_id, created_at desc);

create table if not exists vyndi_access_certifications (
  id text primary key,
  captured_by text not null,
  actor_role text not null,
  source_reference text not null check (length(trim(source_reference)) > 0),
  snapshot_json jsonb not null,
  exception_count integer not null default 0 check (exception_count >= 0),
  created_at timestamptz not null default now()
);

create or replace function guard_vyndi_access_immutable() returns trigger
language plpgsql
as $$
begin
  raise exception 'VYNDI access governance evidence is append-only.';
end;
$$;

drop trigger if exists trg_guard_vyndi_access_events on vyndi_access_events;
create trigger trg_guard_vyndi_access_events
before update or delete on vyndi_access_events
for each row execute function guard_vyndi_access_immutable();

drop trigger if exists trg_guard_vyndi_access_certifications on vyndi_access_certifications;
create trigger trg_guard_vyndi_access_certifications
before update or delete on vyndi_access_certifications
for each row execute function guard_vyndi_access_immutable();

create or replace function record_vyndi_access_event(
  p_id text,
  p_event_type text,
  p_target_user_id text,
  p_actor_user_id text,
  p_actor_role text,
  p_role_before text,
  p_role_after text,
  p_reason text,
  p_source_reference text,
  p_metadata_json jsonb
) returns text
language plpgsql
as $$
begin
  if p_actor_role <> 'admin' then
    raise exception 'Access governance events require an administrator actor.';
  end if;
  insert into vyndi_access_events(
    id,event_type,target_user_id,actor_user_id,actor_role,role_before,role_after,
    reason,source_reference,metadata_json
  ) values (
    p_id,p_event_type,p_target_user_id,p_actor_user_id,p_actor_role,p_role_before,p_role_after,
    nullif(trim(coalesce(p_reason,'')),''),nullif(trim(coalesce(p_source_reference,'')),''),
    coalesce(p_metadata_json,'{}'::jsonb)
  );
  insert into vyndi_audit_events(
    id,entity_type,entity_id,action,actor_user_id,actor_role,source_reference,payload_json
  ) values (
    'AUD-ACCESS-EVENT-'||p_id,'access_control',coalesce(p_target_user_id,p_id),p_event_type,
    p_actor_user_id,p_actor_role,p_source_reference,
    jsonb_build_object('roleBefore',p_role_before,'roleAfter',p_role_after,'reason',p_reason)
      || coalesce(p_metadata_json,'{}'::jsonb)
  );
  return p_id;
end;
$$;

create or replace function request_vyndi_role_change(
  p_id text,
  p_target_user_id text,
  p_to_role text,
  p_reason text,
  p_actor_user_id text,
  p_actor_role text
) returns table(request_id text, from_role text, to_role text)
language plpgsql
as $$
declare
  v_from_role text;
begin
  if p_actor_role <> 'admin' then
    raise exception 'Role-change requests require an administrator.';
  end if;
  if trim(coalesce(p_reason,''))='' then
    raise exception 'Role-change reason is required.';
  end if;
  if p_to_role not in ('admin','management','board','finance','operations','engineering','qa','compliance','viewer') then
    raise exception 'Requested VYNDI role is invalid.';
  end if;
  if not exists(select 1 from "user" where id=p_target_user_id) then
    raise exception 'Target user account was not found.';
  end if;
  if exists(select 1 from vyndi_access_role_change_requests where target_user_id=p_target_user_id and status='pending') then
    raise exception 'A pending role-change request already exists for this user.';
  end if;

  select role into v_from_role from vindy_user_roles where user_id=p_target_user_id;
  if coalesce(v_from_role,'viewer')=p_to_role then
    raise exception 'Target user already has the requested role.';
  end if;

  insert into vyndi_access_role_change_requests(
    id,target_user_id,from_role,to_role,reason,requested_by
  ) values (
    p_id,p_target_user_id,v_from_role,p_to_role,trim(p_reason),p_actor_user_id
  );

  perform record_vyndi_access_event(
    'EVT-'||p_id,'role_change_requested',p_target_user_id,p_actor_user_id,p_actor_role,
    v_from_role,p_to_role,p_reason,p_id,jsonb_build_object('requestId',p_id)
  );

  return query select p_id,v_from_role,p_to_role;
end;
$$;

create or replace function decide_vyndi_role_change(
  p_request_id text,
  p_decision text,
  p_decision_note text,
  p_actor_user_id text,
  p_actor_role text
) returns table(target_user_id text, applied_role text, request_status text)
language plpgsql
as $$
declare
  r vyndi_access_role_change_requests%rowtype;
  v_current_role text;
begin
  if p_actor_role <> 'admin' then
    raise exception 'Role-change decisions require an administrator.';
  end if;
  if p_decision not in ('approve','reject') then
    raise exception 'Role-change decision must be approve or reject.';
  end if;

  select * into r from vyndi_access_role_change_requests
   where id=p_request_id for update;
  if not found then raise exception 'Role-change request was not found.'; end if;
  if r.status <> 'pending' then raise exception 'Role-change request is already decided.'; end if;
  if r.requested_by=p_actor_user_id then
    raise exception 'Maker/checker control requires a different administrator to decide this role change.';
  end if;

  if p_decision='reject' then
    update vyndi_access_role_change_requests
       set status='rejected',decided_by=p_actor_user_id,decided_at=now(),
           decision_note=nullif(trim(coalesce(p_decision_note,'')),'')
     where id=p_request_id;
    perform record_vyndi_access_event(
      'EVT-DECIDE-'||p_request_id,'role_change_rejected',r.target_user_id,p_actor_user_id,p_actor_role,
      r.from_role,r.to_role,coalesce(p_decision_note,r.reason),p_request_id,
      jsonb_build_object('requestId',p_request_id,'requestedBy',r.requested_by)
    );
    return query select r.target_user_id,coalesce(r.from_role,'viewer'),'rejected'::text;
    return;
  end if;

  select role into v_current_role from vindy_user_roles where user_id=r.target_user_id;
  if coalesce(v_current_role,'viewer') <> coalesce(r.from_role,'viewer') then
    raise exception 'Target user role changed after this request was raised; create a new request.';
  end if;

  insert into vindy_user_roles(user_id,role)
  values(r.target_user_id,r.to_role)
  on conflict(user_id) do update set role=excluded.role,updated_at=now();

  update vyndi_access_role_change_requests
     set status='applied',decided_by=p_actor_user_id,decided_at=now(),
         decision_note=nullif(trim(coalesce(p_decision_note,'')),'')
   where id=p_request_id;

  perform record_vyndi_access_event(
    'EVT-DECIDE-'||p_request_id,'role_change_approved',r.target_user_id,p_actor_user_id,p_actor_role,
    r.from_role,r.to_role,coalesce(p_decision_note,r.reason),p_request_id,
    jsonb_build_object('requestId',p_request_id,'requestedBy',r.requested_by)
  );

  return query select r.target_user_id,r.to_role,'applied'::text;
end;
$$;

create or replace function emergency_apply_vyndi_role_change(
  p_request_id text,
  p_break_glass_reason text,
  p_actor_user_id text,
  p_actor_role text
) returns table(target_user_id text, applied_role text, request_status text)
language plpgsql
as $$
declare
  r vyndi_access_role_change_requests%rowtype;
  v_current_role text;
begin
  if p_actor_role <> 'admin' then
    raise exception 'Break-glass role changes require an administrator.';
  end if;
  if trim(coalesce(p_break_glass_reason,''))='' then
    raise exception 'Break-glass reason is required.';
  end if;
  select * into r from vyndi_access_role_change_requests
   where id=p_request_id for update;
  if not found then raise exception 'Role-change request was not found.'; end if;
  if r.status <> 'pending' then raise exception 'Role-change request is already decided.'; end if;

  select role into v_current_role from vindy_user_roles where user_id=r.target_user_id;
  if coalesce(v_current_role,'viewer') <> coalesce(r.from_role,'viewer') then
    raise exception 'Target user role changed after this request was raised; create a new request.';
  end if;

  insert into vindy_user_roles(user_id,role)
  values(r.target_user_id,r.to_role)
  on conflict(user_id) do update set role=excluded.role,updated_at=now();

  update vyndi_access_role_change_requests
     set status='applied',decided_by=p_actor_user_id,decided_at=now(),
         decision_note=trim(p_break_glass_reason),emergency_override=true
   where id=p_request_id;

  perform record_vyndi_access_event(
    'EVT-EMERGENCY-'||p_request_id,'role_change_emergency',r.target_user_id,p_actor_user_id,p_actor_role,
    r.from_role,r.to_role,p_break_glass_reason,p_request_id,
    jsonb_build_object('requestId',p_request_id,'requestedBy',r.requested_by,'emergencyOverride',true)
  );

  return query select r.target_user_id,r.to_role,'applied'::text;
end;
$$;

create or replace function capture_vyndi_access_certification(
  p_id text,
  p_source_reference text,
  p_snapshot_json jsonb,
  p_exception_count integer,
  p_actor_user_id text,
  p_actor_role text
) returns text
language plpgsql
as $$
begin
  if p_actor_role <> 'admin' then
    raise exception 'Access certification requires an administrator.';
  end if;
  if trim(coalesce(p_source_reference,''))='' then
    raise exception 'Access certification source/reference is required.';
  end if;
  if p_exception_count < 0 then
    raise exception 'Access certification exception count cannot be negative.';
  end if;
  insert into vyndi_access_certifications(
    id,captured_by,actor_role,source_reference,snapshot_json,exception_count
  ) values(
    p_id,p_actor_user_id,p_actor_role,trim(p_source_reference),
    coalesce(p_snapshot_json,'{}'::jsonb),p_exception_count
  );
  perform record_vyndi_access_event(
    'EVT-'||p_id,'access_certified',null,p_actor_user_id,p_actor_role,
    null,null,'Periodic access certification',p_source_reference,
    jsonb_build_object('certificationId',p_id,'exceptionCount',p_exception_count)
  );
  return p_id;
end;
$$;

comment on table vyndi_access_role_change_requests is
  'H4 maker/checker role-change authority. Single-role-per-user remains the SoD boundary; routine changes require a different admin decision.';
comment on table vyndi_access_events is
  'Immutable privileged identity/access event history. Contains no passwords, tokens or credential material.';
comment on table vyndi_access_certifications is
  'Immutable periodic access-certification snapshots over users, roles, sessions and unresolved access exceptions.';
