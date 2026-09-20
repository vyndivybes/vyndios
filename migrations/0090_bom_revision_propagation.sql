-- Controlled BOM revision release and downstream propagation.
-- New planning/procurement/VIBPE reads follow the newly active revision immediately.
-- Released Job Cards remain frozen to their captured bom_revision + released_mapping_set.

create table if not exists vyndi_bom_revision_releases (
  id text primary key,
  venture text not null check (venture in ('carbon','aluminium')),
  model_id text not null,
  bom_revision text not null,
  previous_bom_revision text,
  release_reason text not null,
  mapping_count integer not null check (mapping_count > 0),
  released_by text not null,
  released_at timestamptz not null default now(),
  unique(venture,model_id,bom_revision)
);

create index if not exists vyndi_bom_revision_release_scope_idx
  on vyndi_bom_revision_releases(venture,model_id,released_at desc);

create or replace function release_vyndi_bom_revision(
  p_venture text,
  p_model_id text,
  p_bom_revision text,
  p_reason text,
  p_actor_user_id text,
  p_actor_role text
) returns table(
  release_id text,
  previous_bom_revision text,
  released_bom_revision text,
  mapping_count integer,
  protected_job_cards integer
)
language plpgsql
as $$
declare
  v_previous text;
  v_count integer:=0;
  v_protected integer:=0;
  v_release_id text;
  v_duplicates integer:=0;
  v_missing_master integer:=0;
  v_bom_master_id uuid;
  v_previous_master_id uuid;
begin
  if p_venture not in ('carbon','aluminium') then raise exception 'Unsupported BOM venture.'; end if;
  if trim(coalesce(p_model_id,''))='' then raise exception 'BOM model/variant scope is required.'; end if;
  if trim(coalesce(p_bom_revision,''))='' then raise exception 'BOM revision is required.'; end if;
  if trim(coalesce(p_reason,''))='' then raise exception 'BOM release reason is required.'; end if;

  perform pg_advisory_xact_lock(hashtext('bom-release|'||p_venture||'|'||p_model_id)::bigint);

  select md.id into v_bom_master_id
    from master_data_records md
   where md.domain='bom'
     and md.status='approved'
     and coalesce(md.attributes->>'venture','')=p_venture
     and coalesce(md.attributes->>'modelId','')=p_model_id
     and (
       md.code=p_bom_revision
       or coalesce(md.attributes->>'bomRevision','')=p_bom_revision
       or (
         regexp_replace(p_bom_revision,'^[Rr]','') ~ '^\\d+
   where venture=p_venture
     and model_id=p_model_id
     and bom_revision=p_bom_revision
     and status in ('draft','active');
  if v_count=0 then raise exception 'No draft/active BOM mappings exist for requested revision.'; end if;

  select count(*)::int into v_duplicates
    from (
      select bom_line_key,coalesce(configuration_option_id,''),count(*)
        from epr_bom_inventory_mappings
       where venture=p_venture
         and model_id=p_model_id
         and bom_revision=p_bom_revision
         and status in ('draft','active')
       group by bom_line_key,coalesce(configuration_option_id,'')
      having count(*)>1
    ) d;
  if v_duplicates>0 then
    raise exception 'BOM revision contains duplicate controlled component/option lines.';
  end if;

  select count(*)::int into v_missing_master
    from epr_bom_inventory_mappings m
   where m.venture=p_venture
     and m.model_id=p_model_id
     and m.bom_revision=p_bom_revision
     and m.status in ('draft','active')
     and not exists(
       select 1 from master_data_records md
        where md.domain='inventory'
          and upper(md.code)=upper(m.sku)
          and md.status='approved'
     );
  if v_missing_master>0 then
    raise exception 'BOM release blocked: % mapped SKU(s) are not approved in Inventory Master.',v_missing_master;
  end if;

  select bom_revision into v_previous
    from epr_bom_inventory_mappings
   where venture=p_venture
     and model_id=p_model_id
     and status='active'
     and effective_to is null
     and bom_revision<>p_bom_revision
   order by approved_at desc nulls last,effective_from desc nulls last
   limit 1;

  -- Retire every other active revision for this model/variant scope in one transaction.
  update epr_bom_inventory_mappings
     set status='superseded',effective_to=now(),updated_at=now(),
         notes=case
           when coalesce(notes,'')='' then 'Superseded by BOM '||p_bom_revision||' · '||trim(p_reason)
           else notes||E'\nSuperseded by BOM '||p_bom_revision||' · '||trim(p_reason)
         end
   where venture=p_venture
     and model_id=p_model_id
     and bom_revision<>p_bom_revision
     and status='active'
     and effective_to is null;

  -- Release every row in the new revision as one coherent BOM, not line-by-line.
  update epr_bom_inventory_mappings
     set status='active',
         approved_by=coalesce(approved_by,p_actor_user_id),
         approved_at=coalesce(approved_at,now()),
         effective_from=coalesce(effective_from,now()),
         effective_to=null,
         updated_at=now()
   where venture=p_venture
     and model_id=p_model_id
     and bom_revision=p_bom_revision
     and status in ('draft','active');

  -- Keep the BOM master register aligned with the released mapping authority.
  select md.id into v_previous_master_id
    from master_data_records md
   where md.domain='bom'
     and md.status='approved'
     and md.id<>v_bom_master_id
     and coalesce(md.attributes->>'venture','')=p_venture
     and coalesce(md.attributes->>'modelId','')=p_model_id
   order by md.revision desc
   limit 1;

  update master_data_records
     set status='superseded',updated_at=now()
   where domain='bom'
     and status='approved'
     and id<>v_bom_master_id
     and coalesce(attributes->>'venture','')=p_venture
     and coalesce(attributes->>'modelId','')=p_model_id;

  if v_previous_master_id is not null then
    insert into master_data_audit_events(
      id,master_data_id,event_type,actor_user_id,actor_role,from_status,to_status,note,source_ref
    ) values(
      gen_random_uuid(),v_previous_master_id,'BOM_SUPERSEDED_BY_RELEASE',
      p_actor_user_id,p_actor_role,'approved','superseded',
      'Superseded by controlled BOM release '||p_bom_revision,trim(p_reason)
    );
  end if;

  v_release_id:='BOMREL-'||upper(substr(md5(p_venture||'|'||p_model_id||'|'||p_bom_revision),1,24));

  insert into vyndi_bom_revision_releases(
    id,venture,model_id,bom_revision,previous_bom_revision,release_reason,mapping_count,released_by
  ) values(
    v_release_id,p_venture,p_model_id,p_bom_revision,v_previous,trim(p_reason),v_count,p_actor_user_id
  )
  on conflict (venture,model_id,bom_revision) do update set
    previous_bom_revision=excluded.previous_bom_revision,
    release_reason=excluded.release_reason,
    mapping_count=excluded.mapping_count,
    released_by=excluded.released_by,
    released_at=now();

  -- Existing Job Cards are deliberately not rewritten.
  select count(*)::int into v_protected
    from epr_production_job_cards j
   where j.status not in ('cancelled','complete')
     and j.bom_revision is not null
     and j.bom_revision<>p_bom_revision
     and (
       j.variant_id=p_model_id
       or (j.model_tier=p_model_id and not exists(
         select 1 from epr_bom_inventory_mappings em
          where em.venture=p_venture and em.model_id=j.variant_id and em.status='active' and em.effective_to is null
       ))
     );

  insert into vyndi_audit_events(
    id,entity_type,entity_id,action,actor_user_id,actor_role,source_reference,payload_json
  ) values(
    'AUD-'||v_release_id,'bom_revision_release',v_release_id,'released',
    p_actor_user_id,p_actor_role,trim(p_reason),
    jsonb_build_object(
      'venture',p_venture,'modelId',p_model_id,'bomRevision',p_bom_revision,
      'previousBomRevision',v_previous,'mappingCount',v_count,
      'protectedExistingJobCards',v_protected,
      'propagation','planning/procurement/VIBPE read active mappings immediately; released Job Cards remain frozen'
    )
  ) on conflict do nothing;

  return query select v_release_id,v_previous,p_bom_revision,v_count,v_protected;
end;
$$;

create or replace view vyndi_bom_revision_current_state as
with active as (
  select
    venture,model_id,bom_revision,
    count(*)::int as active_mapping_count,
    max(approved_at) as approved_at
  from epr_bom_inventory_mappings
  where status='active' and effective_to is null
  group by venture,model_id,bom_revision
),
costs as (
  select
    m.venture,m.model_id,m.bom_revision,
    count(*) filter(where c.governed_cost_inr is null)::int as missing_cost_skus,
    sum(m.quantity*coalesce(c.governed_cost_inr,0))::numeric(18,2) as governed_bom_cost_inr
  from epr_bom_inventory_mappings m
  left join vyndi_procurement_cost_authority c on upper(c.sku)=upper(m.sku)
  where m.status='active' and m.effective_to is null
  group by m.venture,m.model_id,m.bom_revision
)
select
  a.venture,a.model_id,a.bom_revision,a.active_mapping_count,
  coalesce(c.missing_cost_skus,0) as missing_cost_skus,
  case when coalesce(c.missing_cost_skus,0)>0 then null else c.governed_bom_cost_inr end as governed_bom_cost_inr,
  r.previous_bom_revision,r.release_reason,r.released_by,r.released_at
from active a
left join costs c using(venture,model_id,bom_revision)
left join lateral (
  select previous_bom_revision,release_reason,released_by,released_at
    from vyndi_bom_revision_releases r
   where r.venture=a.venture and r.model_id=a.model_id and r.bom_revision=a.bom_revision
   order by r.released_at desc limit 1
) r on true;

create or replace view vyndi_bom_revision_job_card_impact as
select
  j.id as job_card_id,
  j.sales_order_id,
  j.status as job_card_status,
  j.model_tier,
  j.variant_id,
  j.bom_revision as frozen_bom_revision,
  s.bom_revision as current_bom_revision,
  case
    when s.bom_revision is null then 'NO_CURRENT_BOM'
    when j.bom_revision=s.bom_revision then 'CURRENT'
    when j.approved_at is not null or j.status in ('in_progress','complete') then 'PROTECTED_FROZEN'
    else 'RELEASED_REVIEW_REQUIRED'
  end as bom_revision_state,
  jsonb_array_length(coalesce(j.released_mapping_set,'[]'::jsonb)) as frozen_mapping_count,
  j.approved_at,
  j.updated_at
from epr_production_job_cards j
left join lateral (
  select x.bom_revision
  from (
    select m.bom_revision,0 as priority,max(m.approved_at) as approved_at
      from epr_bom_inventory_mappings m
     where m.status='active' and m.effective_to is null and m.model_id=j.variant_id
     group by m.bom_revision
    union all
    select m.bom_revision,1 as priority,max(m.approved_at) as approved_at
      from epr_bom_inventory_mappings m
     where m.status='active' and m.effective_to is null and m.model_id=j.model_tier
     group by m.bom_revision
  ) x
  order by x.priority,x.approved_at desc nulls last
  limit 1
) s on true
where j.status<>'cancelled';

comment on table vyndi_bom_revision_releases is
  'Atomic BOM revision release history. Releasing a revision supersedes other active revisions for the same model/variant scope.';
comment on view vyndi_bom_revision_current_state is
  'Current released BOM revision, governed bottom-up cost and missing-cost coverage used by planning/procurement/VIBPE.';
comment on view vyndi_bom_revision_job_card_impact is
  'Compares frozen Job Card BOM snapshots with current released BOM. Existing execution is never silently rewritten.';

         and md.revision=regexp_replace(p_bom_revision,'^[Rr]','')::integer
       )
     )
   order by md.revision desc
   limit 1;
  if not found then
    raise exception 'BOM release blocked: an approved BOM master revision matching % / % / % is required.',p_venture,p_model_id,p_bom_revision;
  end if;

  select count(*)::int into v_count
    from epr_bom_inventory_mappings
   where venture=p_venture
     and model_id=p_model_id
     and bom_revision=p_bom_revision
     and status in ('draft','active');
  if v_count=0 then raise exception 'No draft/active BOM mappings exist for requested revision.'; end if;

  select count(*)::int into v_duplicates
    from (
      select bom_line_key,coalesce(configuration_option_id,''),count(*)
        from epr_bom_inventory_mappings
       where venture=p_venture
         and model_id=p_model_id
         and bom_revision=p_bom_revision
         and status in ('draft','active')
       group by bom_line_key,coalesce(configuration_option_id,'')
      having count(*)>1
    ) d;
  if v_duplicates>0 then
    raise exception 'BOM revision contains duplicate controlled component/option lines.';
  end if;

  select count(*)::int into v_missing_master
    from epr_bom_inventory_mappings m
   where m.venture=p_venture
     and m.model_id=p_model_id
     and m.bom_revision=p_bom_revision
     and m.status in ('draft','active')
     and not exists(
       select 1 from master_data_records md
        where md.domain='inventory'
          and upper(md.code)=upper(m.sku)
          and md.status='approved'
     );
  if v_missing_master>0 then
    raise exception 'BOM release blocked: % mapped SKU(s) are not approved in Inventory Master.',v_missing_master;
  end if;

  select bom_revision into v_previous
    from epr_bom_inventory_mappings
   where venture=p_venture
     and model_id=p_model_id
     and status='active'
     and effective_to is null
     and bom_revision<>p_bom_revision
   order by approved_at desc nulls last,effective_from desc nulls last
   limit 1;

  -- Retire every other active revision for this model/variant scope in one transaction.
  update epr_bom_inventory_mappings
     set status='superseded',effective_to=now(),updated_at=now(),
         notes=case
           when coalesce(notes,'')='' then 'Superseded by BOM '||p_bom_revision||' · '||trim(p_reason)
           else notes||E'\nSuperseded by BOM '||p_bom_revision||' · '||trim(p_reason)
         end
   where venture=p_venture
     and model_id=p_model_id
     and bom_revision<>p_bom_revision
     and status='active'
     and effective_to is null;

  -- Release every row in the new revision as one coherent BOM, not line-by-line.
  update epr_bom_inventory_mappings
     set status='active',
         approved_by=coalesce(approved_by,p_actor_user_id),
         approved_at=coalesce(approved_at,now()),
         effective_from=coalesce(effective_from,now()),
         effective_to=null,
         updated_at=now()
   where venture=p_venture
     and model_id=p_model_id
     and bom_revision=p_bom_revision
     and status in ('draft','active');

  v_release_id:='BOMREL-'||upper(substr(md5(p_venture||'|'||p_model_id||'|'||p_bom_revision),1,24));

  insert into vyndi_bom_revision_releases(
    id,venture,model_id,bom_revision,previous_bom_revision,release_reason,mapping_count,released_by
  ) values(
    v_release_id,p_venture,p_model_id,p_bom_revision,v_previous,trim(p_reason),v_count,p_actor_user_id
  )
  on conflict (venture,model_id,bom_revision) do update set
    previous_bom_revision=excluded.previous_bom_revision,
    release_reason=excluded.release_reason,
    mapping_count=excluded.mapping_count,
    released_by=excluded.released_by,
    released_at=now();

  -- Existing Job Cards are deliberately not rewritten.
  select count(*)::int into v_protected
    from epr_production_job_cards j
   where j.status not in ('cancelled','complete')
     and j.bom_revision is not null
     and j.bom_revision<>p_bom_revision
     and (
       j.variant_id=p_model_id
       or (j.model_tier=p_model_id and not exists(
         select 1 from epr_bom_inventory_mappings em
          where em.venture=p_venture and em.model_id=j.variant_id and em.status='active' and em.effective_to is null
       ))
     );

  insert into vyndi_audit_events(
    id,entity_type,entity_id,action,actor_user_id,actor_role,source_reference,payload_json
  ) values(
    'AUD-'||v_release_id,'bom_revision_release',v_release_id,'released',
    p_actor_user_id,p_actor_role,trim(p_reason),
    jsonb_build_object(
      'venture',p_venture,'modelId',p_model_id,'bomRevision',p_bom_revision,
      'previousBomRevision',v_previous,'mappingCount',v_count,
      'protectedExistingJobCards',v_protected,
      'propagation','planning/procurement/VIBPE read active mappings immediately; released Job Cards remain frozen'
    )
  ) on conflict do nothing;

  return query select v_release_id,v_previous,p_bom_revision,v_count,v_protected;
end;
$$;

create or replace view vyndi_bom_revision_current_state as
with active as (
  select
    venture,model_id,bom_revision,
    count(*)::int as active_mapping_count,
    max(approved_at) as approved_at
  from epr_bom_inventory_mappings
  where status='active' and effective_to is null
  group by venture,model_id,bom_revision
),
costs as (
  select
    m.venture,m.model_id,m.bom_revision,
    count(*) filter(where c.governed_cost_inr is null)::int as missing_cost_skus,
    sum(m.quantity*coalesce(c.governed_cost_inr,0))::numeric(18,2) as governed_bom_cost_inr
  from epr_bom_inventory_mappings m
  left join vyndi_procurement_cost_authority c on upper(c.sku)=upper(m.sku)
  where m.status='active' and m.effective_to is null
  group by m.venture,m.model_id,m.bom_revision
)
select
  a.venture,a.model_id,a.bom_revision,a.active_mapping_count,
  coalesce(c.missing_cost_skus,0) as missing_cost_skus,
  case when coalesce(c.missing_cost_skus,0)>0 then null else c.governed_bom_cost_inr end as governed_bom_cost_inr,
  r.previous_bom_revision,r.release_reason,r.released_by,r.released_at
from active a
left join costs c using(venture,model_id,bom_revision)
left join lateral (
  select previous_bom_revision,release_reason,released_by,released_at
    from vyndi_bom_revision_releases r
   where r.venture=a.venture and r.model_id=a.model_id and r.bom_revision=a.bom_revision
   order by r.released_at desc limit 1
) r on true;

create or replace view vyndi_bom_revision_job_card_impact as
select
  j.id as job_card_id,
  j.sales_order_id,
  j.status as job_card_status,
  j.model_tier,
  j.variant_id,
  j.bom_revision as frozen_bom_revision,
  s.bom_revision as current_bom_revision,
  case
    when s.bom_revision is null then 'NO_CURRENT_BOM'
    when j.bom_revision=s.bom_revision then 'CURRENT'
    when j.approved_at is not null or j.status in ('in_progress','complete') then 'PROTECTED_FROZEN'
    else 'RELEASED_REVIEW_REQUIRED'
  end as bom_revision_state,
  jsonb_array_length(coalesce(j.released_mapping_set,'[]'::jsonb)) as frozen_mapping_count,
  j.approved_at,
  j.updated_at
from epr_production_job_cards j
left join lateral (
  select x.bom_revision
  from (
    select m.bom_revision,0 as priority,max(m.approved_at) as approved_at
      from epr_bom_inventory_mappings m
     where m.status='active' and m.effective_to is null and m.model_id=j.variant_id
     group by m.bom_revision
    union all
    select m.bom_revision,1 as priority,max(m.approved_at) as approved_at
      from epr_bom_inventory_mappings m
     where m.status='active' and m.effective_to is null and m.model_id=j.model_tier
     group by m.bom_revision
  ) x
  order by x.priority,x.approved_at desc nulls last
  limit 1
) s on true
where j.status<>'cancelled';

comment on table vyndi_bom_revision_releases is
  'Atomic BOM revision release history. Releasing a revision supersedes other active revisions for the same model/variant scope.';
comment on view vyndi_bom_revision_current_state is
  'Current released BOM revision, governed bottom-up cost and missing-cost coverage used by planning/procurement/VIBPE.';
comment on view vyndi_bom_revision_job_card_impact is
  'Compares frozen Job Card BOM snapshots with current released BOM. Existing execution is never silently rewritten.';
