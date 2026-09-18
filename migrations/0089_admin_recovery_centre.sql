-- VYNDI Admin Recovery Centre
-- Recovery never overwrites canonical truth directly. Selective recovery replays a
-- verified historical snapshot through the owning canonical writer so a new
-- revision/audit event is created. Full-database restore remains an infrastructure
-- operation and this schema governs request, approval, validation and cutover evidence.

create table if not exists vyndi_recovery_checkpoints (
  id text primary key,
  checkpoint_type text not null check (checkpoint_type in ('neon_history','neon_branch','pg_dump','managed_snapshot')),
  captured_at timestamptz not null,
  source_sha text not null default '',
  source_reference text not null,
  storage_reference text not null default '',
  checksum text not null default '',
  size_bytes bigint,
  notes text not null default '',
  recorded_by text not null,
  created_at timestamptz not null default now()
);

create table if not exists vyndi_recovery_requests (
  id text primary key,
  mode text not null check (mode in ('selective','full_restore')),
  source_kind text not null check (source_kind in ('revision_history','external_backup','checkpoint')),
  checkpoint_id text references vyndi_recovery_checkpoints(id),
  entity_type text,
  entity_id text,
  source_revision integer,
  recovery_snapshot jsonb,
  current_snapshot jsonb,
  current_fingerprint text,
  impact_preview jsonb not null default '{}'::jsonb,
  reason text not null,
  evidence_reference text not null,
  status text not null default 'pending'
    check (status in ('pending','approved','rejected','cutover_ready','executed','cancelled')),
  requested_by text not null,
  requested_at timestamptz not null default now(),
  decided_by text,
  decided_at timestamptz,
  decision_note text,
  validation_evidence jsonb,
  validated_by text,
  validated_at timestamptz,
  executed_by text,
  executed_at timestamptz,
  result_revision integer,
  cutover_reference text
);

create index if not exists vyndi_recovery_requests_status_idx
  on vyndi_recovery_requests(status,requested_at desc);
create index if not exists vyndi_recovery_requests_entity_idx
  on vyndi_recovery_requests(entity_type,entity_id,requested_at desc);

create table if not exists vyndi_recovery_events (
  id text primary key,
  request_id text references vyndi_recovery_requests(id),
  checkpoint_id text references vyndi_recovery_checkpoints(id),
  event_type text not null,
  actor_user_id text not null,
  actor_role text not null,
  evidence_reference text not null default '',
  payload_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create or replace function deny_vyndi_recovery_event_mutation() returns trigger
language plpgsql as $$
begin
  raise exception 'VYNDI recovery events are append-only.';
end;
$$;

drop trigger if exists trg_vyndi_recovery_events_append_only on vyndi_recovery_events;
create trigger trg_vyndi_recovery_events_append_only
before update or delete on vyndi_recovery_events
for each row execute function deny_vyndi_recovery_event_mutation();

create or replace function append_vyndi_recovery_event(
  p_request_id text,
  p_checkpoint_id text,
  p_event_type text,
  p_actor_user_id text,
  p_actor_role text,
  p_evidence_reference text,
  p_payload_json jsonb
) returns text
language plpgsql as $$
declare v_id text;
begin
  v_id:='REC-EVT-'||md5(
    coalesce(p_request_id,'')||'|'||coalesce(p_checkpoint_id,'')||'|'||
    coalesce(p_event_type,'')||'|'||coalesce(p_actor_user_id,'')||'|'||clock_timestamp()::text
  );
  insert into vyndi_recovery_events
    (id,request_id,checkpoint_id,event_type,actor_user_id,actor_role,evidence_reference,payload_json)
  values
    (v_id,p_request_id,p_checkpoint_id,trim(p_event_type),p_actor_user_id,p_actor_role,
     trim(coalesce(p_evidence_reference,'')),coalesce(p_payload_json,'{}'::jsonb));
  return v_id;
end;
$$;

create or replace function register_vyndi_recovery_checkpoint(
  p_id text,
  p_checkpoint_type text,
  p_captured_at timestamptz,
  p_source_sha text,
  p_source_reference text,
  p_storage_reference text,
  p_checksum text,
  p_size_bytes bigint,
  p_notes text,
  p_actor_user_id text,
  p_actor_role text
) returns text
language plpgsql as $$
begin
  if p_actor_role<>'admin' then raise exception 'Recovery checkpoint registration requires Admin role.'; end if;
  if p_checkpoint_type not in ('neon_history','neon_branch','pg_dump','managed_snapshot') then
    raise exception 'Unsupported recovery checkpoint type.';
  end if;
  if trim(coalesce(p_source_reference,''))='' then raise exception 'Checkpoint evidence reference is required.'; end if;
  insert into vyndi_recovery_checkpoints
    (id,checkpoint_type,captured_at,source_sha,source_reference,storage_reference,checksum,size_bytes,notes,recorded_by)
  values
    (upper(trim(p_id)),p_checkpoint_type,p_captured_at,trim(coalesce(p_source_sha,'')),
     trim(p_source_reference),trim(coalesce(p_storage_reference,'')),trim(coalesce(p_checksum,'')),
     p_size_bytes,trim(coalesce(p_notes,'')),p_actor_user_id);
  perform append_vyndi_recovery_event(
    null,upper(trim(p_id)),'checkpoint_registered',p_actor_user_id,p_actor_role,p_source_reference,
    jsonb_build_object('checkpointType',p_checkpoint_type,'capturedAt',p_captured_at,'sourceSha',coalesce(p_source_sha,''),
      'storageReference',coalesce(p_storage_reference,''),'sizeBytes',p_size_bytes)
  );
  return upper(trim(p_id));
end;
$$;

create or replace function vyndi_recovery_current_snapshot(
  p_entity_type text,
  p_entity_id text
) returns jsonb
language plpgsql stable as $$
declare v jsonb; v_month integer;
begin
  if p_entity_type='sales_order' then
    select jsonb_build_object(
      'id',id,'revision',revision,'month',plan_month,'product',product_id,'units',units,
      'aspLakh',asp_lakh,'channel',channel,'status',status,'modelTier',model_tier,
      'variantId',variant_id,'variantName',variant_name,'configuration',configuration
    ) into v from vyndi_sales_orders where id=p_entity_id;
  elsif p_entity_type='monthly_actual' then
    v_month:=regexp_replace(upper(trim(p_entity_id)),'^M','','i')::integer;
    select jsonb_build_object(
      'planMonth',plan_month,'revision',revision,'revenue',revenue,'units',units,
      'cogs',cogs,'opex',opex,'closingCash',closing_cash,'inventory',inventory,
      'receivables',receivables,'payables',payables,'sourceReference',source_reference,'verified',verified
    ) into v from vyndi_monthly_actuals where plan_month=v_month;
  else
    raise exception 'Selective recovery supports sales_order and monthly_actual in V1.';
  end if;
  return v;
exception when invalid_text_representation then
  raise exception 'Monthly actual entity id must be M1..M36 or 1..36.';
end;
$$;

create or replace function vyndi_recovery_revision_snapshot(
  p_entity_type text,
  p_entity_id text,
  p_revision integer
) returns jsonb
language plpgsql stable as $$
declare v jsonb; v_month integer;
begin
  if p_revision is null or p_revision<1 then raise exception 'A positive source revision is required.'; end if;
  if p_entity_type='sales_order' then
    select snapshot into v from vyndi_sales_order_revisions
     where sales_order_id=p_entity_id and revision=p_revision;
  elsif p_entity_type='monthly_actual' then
    v_month:=regexp_replace(upper(trim(p_entity_id)),'^M','','i')::integer;
    select snapshot into v from vyndi_monthly_actual_revisions
     where plan_month=v_month and revision=p_revision;
  else
    raise exception 'Selective recovery supports sales_order and monthly_actual in V1.';
  end if;
  if v is null then raise exception 'Requested historical revision was not found.'; end if;
  return v;
exception when invalid_text_representation then
  raise exception 'Monthly actual entity id must be M1..M36 or 1..36.';
end;
$$;

create or replace function request_vyndi_selective_recovery(
  p_id text,
  p_entity_type text,
  p_entity_id text,
  p_source_kind text,
  p_source_revision integer,
  p_recovery_snapshot jsonb,
  p_checkpoint_id text,
  p_reason text,
  p_evidence_reference text,
  p_actor_user_id text,
  p_actor_role text
) returns text
language plpgsql as $$
declare v_current jsonb; v_recovery jsonb; v_fingerprint text;
begin
  if p_actor_role<>'admin' then raise exception 'Selective recovery requires Admin role.'; end if;
  if p_entity_type not in ('sales_order','monthly_actual') then
    raise exception 'Selective recovery supports sales_order and monthly_actual in V1.';
  end if;
  if p_source_kind not in ('revision_history','external_backup') then
    raise exception 'Selective recovery source must be revision_history or external_backup.';
  end if;
  if length(trim(coalesce(p_reason,'')))<8 then raise exception 'A substantive recovery reason is required.'; end if;
  if trim(coalesce(p_evidence_reference,''))='' then raise exception 'Recovery evidence reference is required.'; end if;

  v_current:=vyndi_recovery_current_snapshot(p_entity_type,p_entity_id);
  if p_source_kind='revision_history' then
    v_recovery:=vyndi_recovery_revision_snapshot(p_entity_type,p_entity_id,p_source_revision);
  else
    if p_recovery_snapshot is null or p_recovery_snapshot='{}'::jsonb then
      raise exception 'External-backup recovery requires a recovered snapshot payload.';
    end if;
    if p_checkpoint_id is null then raise exception 'External-backup recovery requires a registered checkpoint.'; end if;
    if not exists(select 1 from vyndi_recovery_checkpoints where id=p_checkpoint_id) then
      raise exception 'Recovery checkpoint was not found.';
    end if;
    v_recovery:=p_recovery_snapshot;
  end if;
  if v_current is null then
    raise exception 'Canonical entity is not present. V1 selective recovery will not silently recreate a missing root record.';
  end if;

  v_fingerprint:=md5(v_current::text);
  insert into vyndi_recovery_requests
    (id,mode,source_kind,checkpoint_id,entity_type,entity_id,source_revision,recovery_snapshot,
     current_snapshot,current_fingerprint,impact_preview,reason,evidence_reference,requested_by)
  values
    (upper(trim(p_id)),'selective',p_source_kind,p_checkpoint_id,p_entity_type,trim(p_entity_id),p_source_revision,
     v_recovery,v_current,v_fingerprint,
     jsonb_build_object(
       'destructiveOverwrite',false,
       'willCreateNewRevision',true,
       'canonicalWriter',case p_entity_type when 'sales_order' then 'save_vyndi_sales_order' else 'save_vyndi_monthly_actual' end,
       'current',v_current,'recovery',v_recovery
     ),
     trim(p_reason),trim(p_evidence_reference),p_actor_user_id);

  perform append_vyndi_recovery_event(
    upper(trim(p_id)),p_checkpoint_id,'selective_recovery_requested',p_actor_user_id,p_actor_role,p_evidence_reference,
    jsonb_build_object('entityType',p_entity_type,'entityId',p_entity_id,'sourceKind',p_source_kind,'sourceRevision',p_source_revision)
  );
  return upper(trim(p_id));
end;
$$;

create or replace function request_vyndi_full_restore(
  p_id text,
  p_checkpoint_id text,
  p_reason text,
  p_evidence_reference text,
  p_actor_user_id text,
  p_actor_role text
) returns text
language plpgsql as $$
begin
  if p_actor_role<>'admin' then raise exception 'Full restore governance requires Admin role.'; end if;
  if not exists(select 1 from vyndi_recovery_checkpoints where id=p_checkpoint_id) then
    raise exception 'A registered recovery checkpoint is required.';
  end if;
  if length(trim(coalesce(p_reason,'')))<8 then raise exception 'A substantive recovery reason is required.'; end if;
  insert into vyndi_recovery_requests
    (id,mode,source_kind,checkpoint_id,reason,evidence_reference,requested_by,impact_preview)
  values
    (upper(trim(p_id)),'full_restore','checkpoint',p_checkpoint_id,trim(p_reason),trim(p_evidence_reference),
     p_actor_user_id,jsonb_build_object(
       'productionOverwrite',false,
       'restoreTarget','new database or branch',
       'requiresValidation',true,
       'requiresCutoverApproval',true
     ));
  perform append_vyndi_recovery_event(
    upper(trim(p_id)),p_checkpoint_id,'full_restore_requested',p_actor_user_id,p_actor_role,p_evidence_reference,
    jsonb_build_object('restoreTarget','new database or branch','productionOverwrite',false)
  );
  return upper(trim(p_id));
end;
$$;

create or replace function decide_vyndi_recovery_request(
  p_request_id text,
  p_decision text,
  p_note text,
  p_actor_user_id text,
  p_actor_role text
) returns text
language plpgsql as $$
declare r record; v_status text;
begin
  if p_actor_role<>'admin' then raise exception 'Recovery approval requires Admin role.'; end if;
  if p_decision not in ('approve','reject') then raise exception 'Recovery decision must be approve or reject.'; end if;
  select * into r from vyndi_recovery_requests where id=p_request_id for update;
  if not found then raise exception 'Recovery request was not found.'; end if;
  if r.status<>'pending' then raise exception 'Only a pending recovery request can be decided.'; end if;
  if r.requested_by=p_actor_user_id then
    raise exception 'Maker/checker control requires a different administrator to decide this recovery request.';
  end if;
  v_status:=case when p_decision='approve' then 'approved' else 'rejected' end;
  update vyndi_recovery_requests
     set status=v_status,decided_by=p_actor_user_id,decided_at=now(),decision_note=trim(coalesce(p_note,''))
   where id=p_request_id;
  perform append_vyndi_recovery_event(
    p_request_id,r.checkpoint_id,'recovery_'||v_status,p_actor_user_id,p_actor_role,r.evidence_reference,
    jsonb_build_object('requestedBy',r.requested_by,'decisionNote',coalesce(p_note,''))
  );
  return v_status;
end;
$$;

create or replace function execute_vyndi_selective_recovery(
  p_request_id text,
  p_execution_reference text,
  p_actor_user_id text,
  p_actor_role text
) returns table(entity_type text,entity_id text,new_revision integer)
language plpgsql as $$
declare r record; v_current jsonb; v_revision integer; s jsonb; v_month integer;
begin
  if p_actor_role<>'admin' then raise exception 'Selective recovery execution requires Admin role.'; end if;
  if trim(coalesce(p_execution_reference,''))='' then raise exception 'Execution evidence reference is required.'; end if;
  select * into r from vyndi_recovery_requests where id=p_request_id for update;
  if not found then raise exception 'Recovery request was not found.'; end if;
  if r.mode<>'selective' or r.status<>'approved' then
    raise exception 'Only an approved selective recovery request can be executed.';
  end if;
  if r.requested_by=p_actor_user_id then
    raise exception 'The recovery maker cannot execute the same selective recovery.';
  end if;
  v_current:=vyndi_recovery_current_snapshot(r.entity_type,r.entity_id);
  if md5(coalesce(v_current,'null'::jsonb)::text)<>r.current_fingerprint then
    raise exception 'Canonical entity changed after the recovery request. Refresh and raise a new recovery request.';
  end if;
  s:=r.recovery_snapshot;

  if r.entity_type='sales_order' then
    if coalesce(s->>'status','') not in ('lead','confirmed','delivered','cancelled') then
      raise exception 'Recovered Sales Order has an invalid status.';
    end if;
    if coalesce(s->>'product','') not in ('aluminium','carbon','premiumCarbon') then
      raise exception 'Recovered Sales Order has an invalid product authority.';
    end if;
    if coalesce(s->>'channel','') not in ('direct','dealer','online') then
      raise exception 'Recovered Sales Order has an invalid channel.';
    end if;
    if coalesce((s->>'units')::numeric,0)<=0 then
      raise exception 'Recovered Sales Order units must be greater than zero.';
    end if;
    if coalesce((s->>'aspLakh')::numeric,-1)<0 then
      raise exception 'Recovered Sales Order ASP cannot be negative.';
    end if;
    if (s->>'status') in ('confirmed','delivered') and (
      coalesce(s->>'modelTier','') not in ('core','pro','apex')
      or trim(coalesce(s->>'variantId',''))=''
      or jsonb_typeof(coalesce(s->'configuration','{}'::jsonb))<>'object'
    ) then
      raise exception 'Recovered committed Sales Order lacks controlled model/configuration authority.';
    end if;

    if exists(select 1 from vyndi_shipments where sales_order_id=r.entity_id)
       or exists(select 1 from vyndi_invoices where sales_order_id=r.entity_id) then
      raise exception 'Sales Order selective recovery is blocked after dispatch or invoice evidence exists. Use the owning reversal/correction authorities.';
    end if;
    if exists(
      select 1 from epr_production_job_cards
       where sales_order_id=r.entity_id and status in ('in_progress','complete')
    ) then
      raise exception 'Sales Order selective recovery is blocked once Production is in progress or complete. Use controlled Production correction/hold authority.';
    end if;
    if exists(
      select 1
        from vyndi_purchase_orders p
        join epr_production_job_cards c on c.id=p.job_card_id
       where c.sales_order_id=r.entity_id
         and p.status not in ('draft','cancelled')
    ) then
      raise exception 'Sales Order selective recovery is blocked after committed Procurement evidence exists. Use Procurement correction/cancellation authority.';
    end if;

    select revision into v_revision from save_vyndi_sales_order(
      r.entity_id,
      (s->>'month')::integer,
      s->>'product',
      (s->>'units')::numeric,
      (s->>'aspLakh')::numeric,
      s->>'channel',
      s->>'status',
      s->>'modelTier',
      s->>'variantId',
      s->>'variantName',
      coalesce(s->'configuration','{}'::jsonb),
      'Governed selective recovery '||r.id||' · '||trim(p_execution_reference),
      p_actor_user_id,
      p_actor_role
    );
  elsif r.entity_type='monthly_actual' then
    v_month:=coalesce((s->>'planMonth')::integer,regexp_replace(upper(trim(r.entity_id)),'^M','','i')::integer);
    v_revision:=save_vyndi_monthly_actual(
      v_month,
      null,
      null,
      nullif(s->>'cogs','')::numeric,
      nullif(s->>'opex','')::numeric,
      nullif(s->>'closingCash','')::numeric,
      nullif(s->>'inventory','')::numeric,
      null,
      nullif(s->>'payables','')::numeric,
      trim(p_execution_reference),
      coalesce((s->>'verified')::boolean,false),
      p_actor_user_id,
      p_actor_role
    );
  else
    raise exception 'Unsupported selective recovery entity type.';
  end if;

  update vyndi_recovery_requests
     set status='executed',executed_by=p_actor_user_id,executed_at=now(),
         result_revision=v_revision,cutover_reference=trim(p_execution_reference)
   where id=p_request_id;

  perform append_vyndi_recovery_event(
    p_request_id,r.checkpoint_id,'selective_recovery_executed',p_actor_user_id,p_actor_role,p_execution_reference,
    jsonb_build_object('entityType',r.entity_type,'entityId',r.entity_id,'newRevision',v_revision,'destructiveOverwrite',false)
  );
  insert into vyndi_audit_events
    (id,entity_type,entity_id,entity_revision,action,actor_user_id,actor_role,source_reference,payload_json)
  values
    ('AUD-REC-'||md5(p_request_id||'|'||v_revision::text||'|'||clock_timestamp()::text),
     'recovery_request',p_request_id,v_revision,'selective_recovery_executed',
     p_actor_user_id,p_actor_role,trim(p_execution_reference),
     jsonb_build_object('recoveredEntityType',r.entity_type,'recoveredEntityId',r.entity_id,'newRevision',v_revision));

  return query select r.entity_type,r.entity_id,v_revision;
end;
$$;

create or replace function validate_vyndi_full_restore(
  p_request_id text,
  p_validation_evidence jsonb,
  p_evidence_reference text,
  p_actor_user_id text,
  p_actor_role text
) returns text
language plpgsql as $$
declare r record;
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
  update vyndi_recovery_requests
     set status='cutover_ready',validation_evidence=coalesce(p_validation_evidence,'{}'::jsonb),
         validated_by=p_actor_user_id,validated_at=now(),decision_note=concat_ws('; ',decision_note,'restore validated')
   where id=p_request_id;
  perform append_vyndi_recovery_event(
    p_request_id,r.checkpoint_id,'full_restore_validated',p_actor_user_id,p_actor_role,p_evidence_reference,
    coalesce(p_validation_evidence,'{}'::jsonb)
  );
  return 'cutover_ready';
end;
$$;

create or replace function record_vyndi_full_restore_cutover(
  p_request_id text,
  p_cutover_reference text,
  p_actor_user_id text,
  p_actor_role text
) returns text
language plpgsql as $$
declare r record;
begin
  if p_actor_role<>'admin' then raise exception 'Full restore cutover recording requires Admin role.'; end if;
  if trim(coalesce(p_cutover_reference,''))='' then raise exception 'Cutover evidence reference is required.'; end if;
  select * into r from vyndi_recovery_requests where id=p_request_id for update;
  if not found or r.mode<>'full_restore' then raise exception 'Full restore request was not found.'; end if;
  if r.status<>'cutover_ready' then raise exception 'Only a validated cutover-ready restore can be recorded as executed.'; end if;
  if r.requested_by=p_actor_user_id then
    raise exception 'The recovery maker cannot record the same full restore cutover.';
  end if;
  update vyndi_recovery_requests
     set status='executed',executed_by=p_actor_user_id,executed_at=now(),cutover_reference=trim(p_cutover_reference)
   where id=p_request_id;
  perform append_vyndi_recovery_event(
    p_request_id,r.checkpoint_id,'full_restore_cutover_recorded',p_actor_user_id,p_actor_role,p_cutover_reference,
    jsonb_build_object('productionOverwrite',false,'validatedRestore',true)
  );
  return 'executed';
end;
$$;

create or replace function vyndi_recovery_compare_snapshot(
  p_entity_type text,
  p_entity_id text
) returns jsonb
language plpgsql stable as $recovery$
declare v jsonb;
begin
  if trim(coalesce(p_entity_id,''))='' then
    raise exception 'Compare entity id is required.';
  end if;

  if p_entity_type='purchase_order' then
    select to_jsonb(t) into v from vyndi_purchase_orders t where t.id=p_entity_id;
  elsif p_entity_type='grn_receipt' then
    select to_jsonb(t) into v from vyndi_goods_receipts t where t.id=p_entity_id;
  elsif p_entity_type='production_job_card' then
    select to_jsonb(t) into v from epr_production_job_cards t where t.id=p_entity_id;
  elsif p_entity_type='inventory_identity' then
    select to_jsonb(t) into v
      from vyndi_identity_registry t
     where t.identity_uid::text=p_entity_id or t.visible_id=p_entity_id
     order by case when t.visible_id=p_entity_id then 0 else 1 end
     limit 1;
  elsif p_entity_type='invoice' then
    select to_jsonb(t) into v from vyndi_invoices t where t.id=p_entity_id;
  elsif p_entity_type='supplier_payment' then
    select to_jsonb(t) into v from vyndi_supplier_payments t where t.id=p_entity_id;
  elsif p_entity_type='quality_record' then
    select jsonb_build_object('recordType','inspection','record',to_jsonb(t))
      into v from vyndi_quality_inspections t where t.id=p_entity_id;
    if v is null then
      select jsonb_build_object('recordType','release','record',to_jsonb(t))
        into v from vyndi_quality_releases t where t.id=p_entity_id;
    end if;
  else
    raise exception 'Unsupported compare-only recovery entity type.';
  end if;

  if v is null then
    raise exception 'Canonical compare record was not found.';
  end if;
  return v;
end;
$recovery$;

create or replace view vyndi_recovery_control_summary as
select
  (select max(captured_at) from vyndi_recovery_checkpoints) as latest_checkpoint_at,
  (select count(*) from vyndi_recovery_checkpoints) as checkpoint_count,
  (select count(*) from vyndi_recovery_requests where status='pending') as pending_requests,
  (select count(*) from vyndi_recovery_requests where status='cutover_ready') as cutover_ready_requests,
  (select count(*) from vyndi_recovery_requests where status='executed') as executed_requests;

comment on table vyndi_recovery_checkpoints is
  'Evidence register for recoverable VYNDI checkpoints. It stores references/hashes only; never database credentials or backup bytes.';
comment on table vyndi_recovery_requests is
  'Admin maker/checker recovery workflow. Selective recovery replays through canonical writers; full restore is validated on a separate database/branch before controlled cutover.';
comment on table vyndi_recovery_events is
  'Append-only recovery governance evidence. Recovery history cannot be rewritten or deleted.';
