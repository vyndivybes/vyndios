-- VYNDI Package P — PLM Engineering Change / Effectivity
-- Extends canonical Engineering ECR + baseline authority with ECO, effectivity and immutable ECN release.

create table if not exists vyndi_engineering_change_orders (
  id text primary key,
  ecr_id text not null references vyndi_engineering_change_requests(id) on delete restrict,
  from_baseline_id text references vyndi_engineering_baselines(id) on delete restrict,
  target_baseline_id text not null references vyndi_engineering_baselines(id) on delete restrict,
  change_class text not null check (change_class in ('form_fit_function','material','bom','process','tooling','documentation','mixed')),
  target_bom_venture text check (target_bom_venture is null or target_bom_venture in ('carbon','aluminium')),
  target_bom_model_id text,
  target_bom_revision text,
  implementation_plan text not null,
  verification_plan text not null,
  status text not null default 'draft' check (status in ('draft','pending_approval','approved','released','rejected')),
  record_revision integer not null default 1 check (record_revision>0),
  source_ref text not null,
  created_by text not null,
  submitted_by text,
  approved_by text,
  released_by text,
  released_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (target_bom_revision is null and target_bom_venture is null and target_bom_model_id is null)
    or
    (target_bom_revision is not null and target_bom_venture is not null and target_bom_model_id is not null)
  )
);
create index if not exists vyndi_eco_status_idx on vyndi_engineering_change_orders(status,updated_at desc);
create unique index if not exists vyndi_eco_one_active_per_ecr_uq
  on vyndi_engineering_change_orders(ecr_id)
  where status in ('draft','pending_approval','approved','released');

create table if not exists vyndi_engineering_change_effectivity (
  id text primary key,
  eco_id text not null references vyndi_engineering_change_orders(id) on delete restrict,
  effectivity_type text not null check (effectivity_type in ('variant','date','serial','sales_order','job_card')),
  value_from text,
  value_to text,
  effective_from date,
  effective_to date,
  source_ref text not null,
  created_by text not null,
  created_at timestamptz not null default now(),
  check (effective_to is null or effective_from is null or effective_to>=effective_from),
  check (
    (effectivity_type='date' and effective_from is not null and value_from is null and value_to is null)
    or
    (effectivity_type='serial' and value_from is not null and effective_from is null and effective_to is null)
    or
    (effectivity_type in ('variant','sales_order','job_card') and value_from is not null and value_to is null and effective_from is null and effective_to is null)
  )
);
create index if not exists vyndi_eco_effectivity_idx on vyndi_engineering_change_effectivity(eco_id,effectivity_type,created_at);

create table if not exists vyndi_engineering_change_notices (
  id text primary key,
  notice_number text not null unique,
  eco_id text not null unique references vyndi_engineering_change_orders(id) on delete restrict,
  ecr_id text not null references vyndi_engineering_change_requests(id) on delete restrict,
  from_baseline_id text references vyndi_engineering_baselines(id) on delete restrict,
  target_baseline_id text not null references vyndi_engineering_baselines(id) on delete restrict,
  target_bom_venture text,
  target_bom_model_id text,
  target_bom_revision text,
  change_class text not null,
  effectivity_json jsonb not null,
  implementation_plan text not null,
  verification_plan text not null,
  source_ref text not null,
  released_by text not null,
  released_at timestamptz not null default now()
);

comment on table vyndi_engineering_change_orders is
  'Controlled ECO implementation authority linked one-to-one to an approved Engineering Change Request. Baseline/BOM authorities remain separate release owners.';
comment on table vyndi_engineering_change_effectivity is
  'Governed ECO applicability. OR within one effectivity dimension and AND across represented dimensions; no rule means fail-closed.';
comment on table vyndi_engineering_change_notices is
  'Immutable ECN release record created only after ECR approval, target Engineering release, target BOM release when applicable, and explicit effectivity.';

create or replace function vyndi_guard_eco_effectivity_mutation()
returns trigger
language plpgsql
as $$
declare
  v_eco_id text;
  v_status text;
begin
  v_eco_id:=case when tg_op='DELETE' then old.eco_id else new.eco_id end;
  select status into v_status from vyndi_engineering_change_orders where id=v_eco_id;
  if v_status is distinct from 'draft' then
    raise exception 'Engineering change effectivity can only be edited while ECO is draft.';
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists trg_vyndi_eco_effectivity_mutation on vyndi_engineering_change_effectivity;
create trigger trg_vyndi_eco_effectivity_mutation
before insert or update or delete on vyndi_engineering_change_effectivity
for each row execute function vyndi_guard_eco_effectivity_mutation();

create or replace function vyndi_reject_ecn_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'Engineering Change Notice is immutable after release.';
end;
$$;

drop trigger if exists trg_vyndi_ecn_immutable on vyndi_engineering_change_notices;
create trigger trg_vyndi_ecn_immutable
before update or delete on vyndi_engineering_change_notices
for each row execute function vyndi_reject_ecn_mutation();

create or replace function release_vyndi_engineering_change_order(
  p_eco_id text,
  p_source_reference text,
  p_actor_user_id text,
  p_actor_role text
) returns text
language plpgsql
as $$
declare
  o record;
  e record;
  b record;
  v_effectivity jsonb;
  v_count integer;
  v_ecn_id text;
  v_notice text;
  v_ecr_revision integer;
begin
  if trim(coalesce(p_source_reference,''))='' then raise exception 'ECN release evidence reference is required.'; end if;
  perform pg_advisory_xact_lock(hashtext('engineering-change-order|'||p_eco_id)::bigint);

  select * into o from vyndi_engineering_change_orders where id=p_eco_id for update;
  if not found then raise exception 'Engineering Change Order not found.'; end if;
  if o.status<>'approved' then raise exception 'ECO must be approved before ECN release.'; end if;

  select * into e from vyndi_engineering_change_requests where id=o.ecr_id for update;
  if not found or e.status<>'approved' then raise exception 'ECR must be approved before ECO/ECN release.'; end if;

  select * into b from vyndi_engineering_baselines where id=o.target_baseline_id;
  if not found or b.status<>'released' then raise exception 'The target Engineering baseline must be released before ECN release.'; end if;
  if b.family_code<>e.family_code or b.variant_id is distinct from e.variant_id then
    raise exception 'The target Engineering baseline does not match the ECR family/variant scope.';
  end if;
  if b.revision_code<>e.target_revision_code then
    raise exception 'The target Engineering baseline revision does not match the approved ECR target revision.';
  end if;
  if e.target_bom_revision is distinct from o.target_bom_revision then
    raise exception 'The ECO target BOM revision does not match the approved ECR scope.';
  end if;

  if exists(
    select 1
      from vyndi_engineering_change_effectivity x
     where x.eco_id=p_eco_id
       and x.effectivity_type='variant'
       and not exists(
         select 1 from vyndi_product_variants v
          where v.variant_id=x.value_from
            and v.family_code=e.family_code
            and v.active=true
       )
  ) then
    raise exception 'Variant effectivity contains a value outside the approved ECR product family.';
  end if;

  if o.target_bom_revision is not null then
    if not exists(
      select 1 from vyndi_bom_revision_releases r
       where r.venture=o.target_bom_venture
         and r.model_id=o.target_bom_model_id
         and r.bom_revision=o.target_bom_revision
    ) then
      raise exception 'The target BOM revision must already be released for the declared venture/model scope.';
    end if;
  end if;

  select count(*)::int,
         coalesce(jsonb_agg(jsonb_build_object(
           'id',x.id,'type',x.effectivity_type,'valueFrom',x.value_from,'valueTo',x.value_to,
           'effectiveFrom',x.effective_from,'effectiveTo',x.effective_to,'sourceRef',x.source_ref
         ) order by x.effectivity_type,x.created_at,x.id),'[]'::jsonb)
    into v_count,v_effectivity
    from vyndi_engineering_change_effectivity x
   where x.eco_id=p_eco_id;
  if v_count=0 then raise exception 'At least one governed effectivity rule is required before ECN release.'; end if;

  v_ecn_id:='ECN-'||substr(md5(p_eco_id||'|'||clock_timestamp()::text),1,24);
  v_notice:='ECN-'||upper(substr(md5(p_eco_id),1,12));

  insert into vyndi_engineering_change_notices(
    id,notice_number,eco_id,ecr_id,from_baseline_id,target_baseline_id,
    target_bom_venture,target_bom_model_id,target_bom_revision,change_class,effectivity_json,
    implementation_plan,verification_plan,source_ref,released_by
  ) values(
    v_ecn_id,v_notice,o.id,o.ecr_id,o.from_baseline_id,o.target_baseline_id,
    o.target_bom_venture,o.target_bom_model_id,o.target_bom_revision,o.change_class,v_effectivity,
    o.implementation_plan,o.verification_plan,trim(p_source_reference),p_actor_user_id
  );

  update vyndi_engineering_change_orders
     set status='released',record_revision=record_revision+1,released_by=p_actor_user_id,released_at=now(),
         source_ref=trim(p_source_reference),updated_at=now()
   where id=p_eco_id;

  update vyndi_engineering_change_requests
     set status='implemented',record_revision=record_revision+1,implemented_by=p_actor_user_id,
         implemented_baseline_id=o.target_baseline_id,updated_at=now()
   where id=o.ecr_id
   returning record_revision into v_ecr_revision;

  insert into vyndi_audit_events(
    id,entity_type,entity_id,entity_revision,action,actor_user_id,actor_role,source_reference,payload_json,
    correlation_id,previous_state,new_state,reason
  ) values(
    'AUD-'||v_ecn_id,'engineering_change_notice',v_ecn_id,1,'ECN_RELEASED',
    p_actor_user_id,p_actor_role,trim(p_source_reference),
    jsonb_build_object('ecoId',o.id,'ecrId',o.ecr_id,'targetBaselineId',o.target_baseline_id,
      'targetBomRevision',o.target_bom_revision,'effectivityCount',v_count,'ecrRecordRevision',v_ecr_revision),
    'ECO|'||o.id,'approved','released','Approved ECO released as immutable ECN after authority/effectivity gates.'
  );

  return v_ecn_id;
end;
$$;
