-- DOC 04 Rev 1.2 governance hardening.
-- The examples LON/LAT/ALT-0926-* demonstrate format only. September 2026 has
-- not been declared the official launch month for every model, so no example
-- launch code may become production authority merely because it was seeded in
-- the preceding structural migration.

alter table vyndi_identity_model_rules
  add column if not exists launch_code_confirmed boolean not null default false;

-- On first deployment there can be no canonical identities from this new
-- namespace before this migration completes. Keep any illustrative seed values
-- non-authoritative until an authorised launch-code configuration is recorded.
update vyndi_identity_model_rules rules
   set status='draft',
       launch_code_confirmed=false,
       source_ref='DOC04-REV1.2:LAUNCH-MMYY-AWAITING-AUTHORISATION',
       updated_at=now()
 where rules.family_code in ('longitude','latitude','altitude')
   and not exists (
     select 1
       from vyndi_identity_registry i
      where i.identity_kind='finished_product'
        and i.legacy_format=false
        and i.family_code=rules.family_code
   );

create or replace function generate_vyndi_finished_product_serial(p_model_reference text)
returns text
language plpgsql
as $$
declare
  r record;
  v_mmyy text;
  v_seq bigint;
  v_serial text;
begin
  select rules.family_code,rules.model_code,rules.launch_month,rules.launch_year,rules.sequence_width
    into r
    from vyndi_identity_model_rules rules
    join vyndi_product_families fam on fam.family_code=rules.family_code
   where rules.status='approved'
     and rules.launch_code_confirmed=true
     and fam.status='approved'
     and (
       lower(rules.family_code)=lower(trim(p_model_reference))
       or lower(fam.compatibility_tier)=lower(trim(p_model_reference))
       or upper(rules.model_code)=upper(trim(p_model_reference))
     )
   limit 1;
  if not found then
    raise exception 'No authorised launch MMYY exists for model reference %. Configure the official model launch identity before issuing production serials.',p_model_reference;
  end if;

  v_mmyy:=vyndi_identity_mmyy(r.launch_month,r.launch_year);
  v_seq:=next_vyndi_identity_sequence('PRODUCT:'||r.model_code||':'||v_mmyy);
  if v_seq>=power(10,r.sequence_width) then
    raise exception 'Serial namespace %-% is exhausted; issue a controlled identity revision.',r.model_code,v_mmyy;
  end if;
  v_serial:=r.model_code||'-'||v_mmyy||'-'||lpad(v_seq::text,r.sequence_width,'0');

  insert into vyndi_identity_registry
    (visible_id,identity_kind,traceability_class,family_code,legacy_format,source_ref,created_by)
  values
    (v_serial,'finished_product','A',r.family_code,false,'DOC04-REV1.2','VYNDI-SERIAL-GENERATOR');

  return v_serial;
end;
$$;

create or replace function configure_vyndi_model_launch(
  p_family_code text,
  p_launch_month integer,
  p_launch_year integer,
  p_actor_user_id text,
  p_actor_role text
) returns table (family_code text,model_code text,launch_code text)
language plpgsql
as $$
declare
  r record;
  v_new_code text:=vyndi_identity_mmyy(p_launch_month,p_launch_year);
begin
  select * into r
    from vyndi_identity_model_rules rules
   where rules.family_code=lower(trim(p_family_code))
   for update;
  if not found then raise exception 'Unknown controlled product family %.',p_family_code; end if;

  if (r.launch_code_confirmed=true and (r.launch_month<>p_launch_month or r.launch_year<>p_launch_year))
     and exists(
       select 1 from vyndi_identity_registry i
        where i.identity_kind='finished_product'
          and i.legacy_format=false
          and i.family_code=r.family_code
     ) then
    raise exception 'Launch code for % is frozen because canonical product serials already exist.',r.family_code;
  end if;

  update vyndi_identity_model_rules rules set
    launch_month=p_launch_month,
    launch_year=p_launch_year,
    launch_code_confirmed=true,
    status='approved',
    source_ref='DOC04-REV1.2:AUTHORISED-LAUNCH-MMYY',
    updated_by=p_actor_user_id,
    updated_at=now()
  where rules.family_code=r.family_code;

  insert into vyndi_audit_events
    (id,entity_type,entity_id,entity_revision,action,actor_user_id,actor_role,source_reference,payload_json)
  values
    ('AUD-IDRULE-'||r.family_code||'-'||substr(md5(clock_timestamp()::text),1,10),
     'identity_model_rule',r.family_code,1,'official_launch_mmyy_authorised',p_actor_user_id,p_actor_role,'DOC04-REV1.2',
     jsonb_build_object('modelCode',r.model_code,'launchCode',v_new_code,'launchCodeConfirmed',true));

  return query select r.family_code,r.model_code,v_new_code;
end;
$$;

create or replace view vyndi_model_identity_authority as
select
  rules.family_code,
  fam.display_name as business_model_name,
  rules.model_code,
  vyndi_identity_mmyy(rules.launch_month,rules.launch_year) as configured_launch_code,
  rules.launch_code_confirmed,
  rules.status,
  case
    when rules.status='approved' and rules.launch_code_confirmed then 'AUTHORISED'
    else 'BLOCKED_AWAITING_OFFICIAL_LAUNCH_MMYY'
  end as issuance_status,
  rules.source_ref,
  rules.updated_by,
  rules.updated_at
from vyndi_identity_model_rules rules
join vyndi_product_families fam on fam.family_code=rules.family_code;

comment on view vyndi_model_identity_authority is
  'Shows whether each LON/LAT/ALT serial namespace is authorised for issuance. Example MMYY values are not production authority until launch_code_confirmed=true.';
