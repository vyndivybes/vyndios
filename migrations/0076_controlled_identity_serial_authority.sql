-- DOC 04 Rev 1.2 / VYNDI controlled identity authority.
--
-- Governing principles:
--   * Finished products: MODEL-MMYY-NNNN (LON/LAT/ALT).
--   * VAYU-controlled components: FAMILY-VARIANT-MMYY-NNNN where individually serialized.
--   * Purchased items retain OEM/manufacturer/supplier identities unchanged.
--   * VYNDI adds its own internal reference for cross-ledger control; it never fabricates an OEM serial.
--   * Historical serials remain immutable and are registered as legacy identities / aliases.
--   * Every identity record has an immutable UUID independent of the human-readable code.

-- ---------------------------------------------------------------------------
-- 1. Model serial rules: a 1:1 identity-policy extension of the canonical
--    vyndi_product_families authority. Product identity is NOT duplicated here.
-- ---------------------------------------------------------------------------
create table if not exists vyndi_identity_model_rules (
  family_code text primary key references vyndi_product_families(family_code) on delete restrict,
  model_code text not null unique,
  launch_month smallint not null check (launch_month between 1 and 12),
  launch_year smallint not null check (launch_year between 2000 and 2199),
  sequence_width smallint not null default 4 check (sequence_width between 4 and 8),
  status text not null default 'approved' check (status in ('draft','approved','superseded')),
  source_ref text not null default 'DOC04-REV1.2',
  updated_by text not null default 'controlled-migration',
  updated_at timestamptz not null default now()
);

-- Initial controlled baseline accepted during the September 2026 reconciliation.
-- The launch month/year may be changed through configure_vyndi_model_launch only
-- until the first canonical serial has been issued for that model.
insert into vyndi_identity_model_rules
  (family_code,model_code,launch_month,launch_year,sequence_width,status,source_ref,updated_by)
values
  ('longitude','LON',9,2026,4,'approved','DOC04-REV1.2','controlled-migration'),
  ('latitude','LAT',9,2026,4,'approved','DOC04-REV1.2','controlled-migration'),
  ('altitude','ALT',9,2026,4,'approved','DOC04-REV1.2','controlled-migration')
on conflict (family_code) do update set
  model_code=excluded.model_code,
  source_ref=excluded.source_ref,
  updated_at=now();

-- ---------------------------------------------------------------------------
-- 2. Immutable identity registry, aliases and governed sequence authority.
-- ---------------------------------------------------------------------------
create table if not exists vyndi_identity_sequences (
  namespace_key text primary key,
  current_value bigint not null default 0 check (current_value >= 0),
  updated_at timestamptz not null default now()
);

create table if not exists vyndi_identity_registry (
  identity_uid uuid primary key default gen_random_uuid(),
  visible_id text not null unique,
  identity_kind text not null check (identity_kind in (
    'finished_product','vayu_component','purchased_item','asset','equipment','tool','spare','consumable','generic_item'
  )),
  traceability_class text not null check (traceability_class in ('A','B','C')),
  family_code text not null default '',
  variant_code text not null default '',
  part_sku text not null default '',
  engineering_revision text not null default '',
  source_entity_type text,
  source_entity_id text,
  manufacturer text not null default '',
  brand text not null default '',
  oem_model_number text not null default '',
  oem_part_number text not null default '',
  oem_serial_number text not null default '',
  supplier_sku text not null default '',
  supplier_lot text not null default '',
  invoice_reference text not null default '',
  grn_reference text not null default '',
  warranty_reference text not null default '',
  calibration_reference text not null default '',
  legacy_format boolean not null default false,
  status text not null default 'active' check (status in ('active','retired','superseded','disposed')),
  source_ref text not null default 'DOC04-REV1.2',
  created_by text not null default 'system',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source_entity_type,source_entity_id)
);

create index if not exists vyndi_identity_registry_kind_idx
  on vyndi_identity_registry(identity_kind,status,visible_id);
create index if not exists vyndi_identity_registry_part_idx
  on vyndi_identity_registry(part_sku,engineering_revision) where part_sku<>'';
create index if not exists vyndi_identity_registry_oem_serial_idx
  on vyndi_identity_registry(oem_serial_number) where oem_serial_number<>'';

create table if not exists vyndi_identity_aliases (
  alias text primary key,
  identity_uid uuid not null references vyndi_identity_registry(identity_uid) on delete restrict,
  alias_type text not null check (alias_type in ('legacy_serial','legacy_hash_serial','supplier_alias','historical_reference')),
  source_ref text not null default 'DOC04-REV1.2',
  created_at timestamptz not null default now()
);

create table if not exists vyndi_identity_genealogy (
  id uuid primary key default gen_random_uuid(),
  parent_identity_uid uuid not null references vyndi_identity_registry(identity_uid) on delete restrict,
  child_identity_uid uuid not null references vyndi_identity_registry(identity_uid) on delete restrict,
  relationship_type text not null check (relationship_type in ('installed','contained_in','replacement','removed')),
  effective_from timestamptz not null default now(),
  effective_to timestamptz,
  job_card_id text,
  traveller_id text,
  reason text not null default '',
  recorded_by text not null,
  created_at timestamptz not null default now(),
  check (parent_identity_uid<>child_identity_uid),
  check (effective_to is null or effective_to>=effective_from)
);

create index if not exists vyndi_identity_genealogy_parent_idx
  on vyndi_identity_genealogy(parent_identity_uid,effective_to);
create index if not exists vyndi_identity_genealogy_child_idx
  on vyndi_identity_genealogy(child_identity_uid,effective_to);

create or replace view vyndi_current_identity_genealogy as
select
  g.id,
  p.visible_id as parent_identity,
  c.visible_id as child_identity,
  g.relationship_type,
  g.effective_from,
  g.job_card_id,
  g.traveller_id,
  g.reason,
  g.recorded_by
from vyndi_identity_genealogy g
join vyndi_identity_registry p on p.identity_uid=g.parent_identity_uid
join vyndi_identity_registry c on c.identity_uid=g.child_identity_uid
where g.effective_to is null and g.relationship_type in ('installed','contained_in','replacement');

-- ---------------------------------------------------------------------------
-- 3. Sequence / formatting primitives.
-- ---------------------------------------------------------------------------
create or replace function next_vyndi_identity_sequence(p_namespace text)
returns bigint
language plpgsql
as $$
declare
  v_namespace text:=upper(trim(coalesce(p_namespace,'')));
  v_value bigint;
begin
  if v_namespace='' then raise exception 'Identity namespace is required.'; end if;
  insert into vyndi_identity_sequences(namespace_key,current_value,updated_at)
  values(v_namespace,1,now())
  on conflict (namespace_key) do update set
    current_value=vyndi_identity_sequences.current_value+1,
    updated_at=now()
  returning current_value into v_value;
  return v_value;
end;
$$;

create or replace function vyndi_identity_mmyy(p_month integer,p_year integer)
returns text
language plpgsql
immutable
as $$
begin
  if p_month not between 1 and 12 then raise exception 'Launch/release month must be 1..12.'; end if;
  if p_year not between 2000 and 2199 then raise exception 'Launch/release year must be 2000..2199.'; end if;
  return lpad(p_month::text,2,'0')||right(p_year::text,2);
end;
$$;

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
     and fam.status='approved'
     and (
       lower(rules.family_code)=lower(trim(p_model_reference))
       or lower(fam.compatibility_tier)=lower(trim(p_model_reference))
       or upper(rules.model_code)=upper(trim(p_model_reference))
     )
   limit 1;
  if not found then raise exception 'No approved identity rule exists for model reference %.',p_model_reference; end if;

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

create or replace function generate_vyndi_component_serial(
  p_family_code text,
  p_variant_code text,
  p_release_month integer,
  p_release_year integer,
  p_part_sku text,
  p_engineering_revision text,
  p_actor text
) returns text
language plpgsql
as $$
declare
  v_family text:=upper(trim(coalesce(p_family_code,'')));
  v_variant text:=upper(trim(coalesce(p_variant_code,'')));
  v_mmyy text;
  v_seq bigint;
  v_serial text;
begin
  if v_family!~'^[A-Z0-9]{2,5}$' then raise exception 'Component family code must be 2-5 alphanumeric characters.'; end if;
  if v_variant!~'^[A-Z0-9]{1,12}$' then raise exception 'Component variant code must be 1-12 alphanumeric characters.'; end if;
  if trim(coalesce(p_part_sku,''))='' then raise exception 'Controlled part/SKU is required for a VAYU component serial.'; end if;
  if trim(coalesce(p_engineering_revision,''))='' then raise exception 'Engineering revision is required for a VAYU component serial.'; end if;

  v_mmyy:=vyndi_identity_mmyy(p_release_month,p_release_year);
  v_seq:=next_vyndi_identity_sequence('COMPONENT:'||v_family||':'||v_variant||':'||v_mmyy);
  if v_seq>9999 then raise exception 'Component serial namespace %-%-% is exhausted; issue a controlled identity revision.',v_family,v_variant,v_mmyy; end if;
  v_serial:=v_family||'-'||v_variant||'-'||v_mmyy||'-'||lpad(v_seq::text,4,'0');

  insert into vyndi_identity_registry
    (visible_id,identity_kind,traceability_class,family_code,variant_code,part_sku,engineering_revision,
     legacy_format,source_ref,created_by)
  values
    (v_serial,'vayu_component','A',v_family,v_variant,upper(trim(p_part_sku)),trim(p_engineering_revision),
     false,'DOC04-REV1.2',coalesce(nullif(trim(p_actor),''),'system'));
  return v_serial;
end;
$$;

create or replace function generate_vyndi_internal_reference(p_prefix text)
returns text
language plpgsql
as $$
declare
  v_prefix text:=upper(trim(coalesce(p_prefix,'')));
  v_seq bigint;
begin
  if v_prefix not in ('AST','EQP','TOL','SPR','CON','ITM') then
    raise exception 'Internal identity prefix must be AST, EQP, TOL, SPR, CON or ITM.';
  end if;
  v_seq:=next_vyndi_identity_sequence('INTERNAL:'||v_prefix);
  if v_seq>999999 then raise exception 'Internal identity namespace % is exhausted; issue a controlled identity revision.',v_prefix; end if;
  return v_prefix||'-'||lpad(v_seq::text,6,'0');
end;
$$;

-- Launch code is configuration controlled. Once a canonical serial exists the
-- launch MMYY cannot be silently changed.
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
  select * into r from vyndi_identity_model_rules rules
   where rules.family_code=lower(trim(p_family_code)) for update;
  if not found then raise exception 'Unknown controlled product family %.',p_family_code; end if;

  if (r.launch_month<>p_launch_month or r.launch_year<>p_launch_year)
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
    updated_by=p_actor_user_id,
    updated_at=now()
  where rules.family_code=r.family_code;

  insert into vyndi_audit_events
    (id,entity_type,entity_id,entity_revision,action,actor_user_id,actor_role,source_reference,payload_json)
  values
    ('AUD-IDRULE-'||r.family_code||'-'||substr(md5(clock_timestamp()::text),1,10),
     'identity_model_rule',r.family_code,1,'launch_code_configured',p_actor_user_id,p_actor_role,'DOC04-REV1.2',
     jsonb_build_object('modelCode',r.model_code,'launchCode',v_new_code));

  return query select r.family_code,r.model_code,v_new_code;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Extend the existing Master Inventory / receiving authority; do not create
--    a parallel inventory ledger.
-- ---------------------------------------------------------------------------
alter table master_inventory_items add column if not exists identity_family_code text not null default '';
alter table master_inventory_items add column if not exists identity_variant_code text not null default '';
alter table master_inventory_items add column if not exists controlled_part_number text not null default '';
alter table master_inventory_items add column if not exists engineering_revision text not null default '';
alter table master_inventory_items add column if not exists traceability_class text not null default 'C';
alter table master_inventory_items add column if not exists internal_identity_prefix text not null default '';

alter table vyndi_inventory_receipt_metadata add column if not exists identity_uid uuid references vyndi_identity_registry(identity_uid) on delete restrict;
alter table vyndi_inventory_receipt_metadata add column if not exists vyndi_internal_reference text not null default '';
alter table vyndi_inventory_receipt_metadata add column if not exists traceability_class text not null default 'C';
alter table vyndi_inventory_receipt_metadata add column if not exists manufacturer text not null default '';
alter table vyndi_inventory_receipt_metadata add column if not exists brand text not null default '';
alter table vyndi_inventory_receipt_metadata add column if not exists oem_model_number text not null default '';
alter table vyndi_inventory_receipt_metadata add column if not exists oem_part_number text not null default '';
alter table vyndi_inventory_receipt_metadata add column if not exists oem_serial_number text not null default '';
alter table vyndi_inventory_receipt_metadata add column if not exists supplier_sku text not null default '';
alter table vyndi_inventory_receipt_metadata add column if not exists supplier_lot text not null default '';
alter table vyndi_inventory_receipt_metadata add column if not exists invoice_reference text not null default '';
alter table vyndi_inventory_receipt_metadata add column if not exists grn_reference text not null default '';
alter table vyndi_inventory_receipt_metadata add column if not exists warranty_reference text not null default '';
alter table vyndi_inventory_receipt_metadata add column if not exists calibration_reference text not null default '';

create unique index if not exists vyndi_inventory_receipt_identity_uidx
  on vyndi_inventory_receipt_metadata(identity_uid) where identity_uid is not null;

create or replace function register_vyndi_inventory_receipt_identity(
  p_movement_id text,
  p_traceability_class text,
  p_internal_prefix text,
  p_manufacturer text,
  p_brand text,
  p_oem_model_number text,
  p_oem_part_number text,
  p_oem_serial_number text,
  p_supplier_sku text,
  p_supplier_lot text,
  p_invoice_reference text,
  p_grn_reference text,
  p_warranty_reference text,
  p_calibration_reference text,
  p_actor text
) returns table (identity_uid uuid,internal_reference text)
language plpgsql
as $$
declare
  meta record;
  item record;
  existing record;
  v_class text:=upper(trim(coalesce(p_traceability_class,'C')));
  v_prefix text:=upper(trim(coalesce(p_internal_prefix,'')));
  v_ref text;
  v_uid uuid;
  v_kind text;
begin
  if v_class not in ('A','B','C') then raise exception 'Traceability class must be A, B or C.'; end if;

  select m.* into meta from vyndi_inventory_receipt_metadata m where m.movement_id=p_movement_id for update;
  if not found then raise exception 'Inventory receipt metadata % does not exist.',p_movement_id; end if;
  select i.* into item from master_inventory_items i where i.id=meta.master_inventory_item_id;
  if not found then raise exception 'Master Inventory item for receipt % does not exist.',p_movement_id; end if;

  select r.* into existing from vyndi_identity_registry r
   where r.source_entity_type='inventory_receipt' and r.source_entity_id=p_movement_id;

  if found then
    v_ref:=existing.visible_id;
    v_uid:=existing.identity_uid;
  else
    if v_prefix='' then
      v_prefix:=case item.ledger_id
        when 'components' then 'SPR'
        when 'raw-materials' then 'CON'
        when 'tooling' then 'TOL'
        when 'quality' then 'EQP'
        else 'ITM'
      end;
    end if;
    v_ref:=generate_vyndi_internal_reference(v_prefix);
    v_kind:=case v_prefix
      when 'AST' then 'asset'
      when 'EQP' then 'equipment'
      when 'TOL' then 'tool'
      when 'SPR' then 'spare'
      when 'CON' then 'consumable'
      else 'generic_item'
    end;
    insert into vyndi_identity_registry
      (visible_id,identity_kind,traceability_class,family_code,variant_code,part_sku,engineering_revision,
       source_entity_type,source_entity_id,manufacturer,brand,oem_model_number,oem_part_number,oem_serial_number,
       supplier_sku,supplier_lot,invoice_reference,grn_reference,warranty_reference,calibration_reference,
       legacy_format,source_ref,created_by)
    values
      (v_ref,v_kind,v_class,item.identity_family_code,item.identity_variant_code,
       coalesce(nullif(item.controlled_part_number,''),item.sku),item.engineering_revision,
       'inventory_receipt',p_movement_id,trim(coalesce(p_manufacturer,'')),trim(coalesce(p_brand,'')),
       trim(coalesce(p_oem_model_number,'')),trim(coalesce(p_oem_part_number,'')),trim(coalesce(p_oem_serial_number,'')),
       trim(coalesce(p_supplier_sku,'')),trim(coalesce(p_supplier_lot,'')),trim(coalesce(p_invoice_reference,'')),
       trim(coalesce(p_grn_reference,'')),trim(coalesce(p_warranty_reference,'')),trim(coalesce(p_calibration_reference,'')),
       false,'DOC04-REV1.2',coalesce(nullif(trim(p_actor),''),'system'))
    returning vyndi_identity_registry.identity_uid into v_uid;
  end if;

  update vyndi_identity_registry r set
    traceability_class=v_class,
    manufacturer=trim(coalesce(p_manufacturer,'')),
    brand=trim(coalesce(p_brand,'')),
    oem_model_number=trim(coalesce(p_oem_model_number,'')),
    oem_part_number=trim(coalesce(p_oem_part_number,'')),
    oem_serial_number=trim(coalesce(p_oem_serial_number,'')),
    supplier_sku=trim(coalesce(p_supplier_sku,'')),
    supplier_lot=trim(coalesce(p_supplier_lot,'')),
    invoice_reference=trim(coalesce(p_invoice_reference,'')),
    grn_reference=trim(coalesce(p_grn_reference,'')),
    warranty_reference=trim(coalesce(p_warranty_reference,'')),
    calibration_reference=trim(coalesce(p_calibration_reference,'')),
    updated_at=now()
  where r.identity_uid=v_uid;

  update vyndi_inventory_receipt_metadata m set
    identity_uid=v_uid,
    vyndi_internal_reference=v_ref,
    traceability_class=v_class,
    manufacturer=trim(coalesce(p_manufacturer,'')),
    brand=trim(coalesce(p_brand,'')),
    oem_model_number=trim(coalesce(p_oem_model_number,'')),
    oem_part_number=trim(coalesce(p_oem_part_number,'')),
    oem_serial_number=trim(coalesce(p_oem_serial_number,'')),
    supplier_sku=trim(coalesce(p_supplier_sku,'')),
    supplier_lot=trim(coalesce(p_supplier_lot,'')),
    invoice_reference=trim(coalesce(p_invoice_reference,'')),
    grn_reference=trim(coalesce(p_grn_reference,'')),
    warranty_reference=trim(coalesce(p_warranty_reference,'')),
    calibration_reference=trim(coalesce(p_calibration_reference,''))
  where m.movement_id=p_movement_id;

  return query select v_uid,v_ref;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Register all historical traveller serials without changing them. Old
--    VAYU-/VYNDI-hash/manual identities remain valid audit evidence.
-- ---------------------------------------------------------------------------
alter table epr_travellers add column if not exists identity_uid uuid references vyndi_identity_registry(identity_uid) on delete restrict;

insert into vyndi_identity_registry
  (visible_id,identity_kind,traceability_class,family_code,variant_code,part_sku,engineering_revision,
   source_entity_type,source_entity_id,legacy_format,source_ref,created_by,created_at)
select
  tr.serial_number,
  'finished_product',
  'A',
  case tr.model_id when 'core' then 'longitude' when 'pro' then 'latitude' when 'apex' then 'altitude' else lower(tr.model_id) end,
  tr.sku,
  tr.sku,
  tr.engineering_revision,
  'epr_traveller',
  tr.id,
  case when tr.serial_number~'^(LON|LAT|ALT)-[0-9]{4}-[0-9]{4}$' then false else true end,
  'LEGACY-RECONCILIATION:DOC04-REV1.2',
  tr.created_by,
  tr.created_at
from epr_travellers tr
on conflict (visible_id) do nothing;

update epr_travellers tr set identity_uid=r.identity_uid
from vyndi_identity_registry r
where r.source_entity_type='epr_traveller' and r.source_entity_id=tr.id and tr.identity_uid is null;

insert into vyndi_identity_aliases(alias,identity_uid,alias_type,source_ref)
select
  r.visible_id,
  r.identity_uid,
  case when r.visible_id like 'VYNDI-%' then 'legacy_hash_serial' else 'legacy_serial' end,
  'LEGACY-RECONCILIATION:DOC04-REV1.2'
from vyndi_identity_registry r
where r.identity_kind='finished_product' and r.legacy_format=true
on conflict (alias) do nothing;

create unique index if not exists epr_travellers_identity_uidx
  on epr_travellers(identity_uid) where identity_uid is not null;

create or replace function bind_epr_traveller_identity()
returns trigger
language plpgsql
as $$
declare
  v_uid uuid;
  v_family text;
begin
  if TG_OP='UPDATE' and OLD.serial_number is distinct from NEW.serial_number then
    raise exception 'Traveller serial number is immutable. Use the controlled identity correction workflow.';
  end if;

  if NEW.identity_uid is not null then return NEW; end if;
  v_family:=case NEW.model_id when 'core' then 'longitude' when 'pro' then 'latitude' when 'apex' then 'altitude' else lower(NEW.model_id) end;

  select r.identity_uid into v_uid from vyndi_identity_registry r where r.visible_id=NEW.serial_number for update;
  if found then
    update vyndi_identity_registry r set
      source_entity_type='epr_traveller',
      source_entity_id=NEW.id,
      family_code=coalesce(nullif(r.family_code,''),v_family),
      variant_code=coalesce(nullif(r.variant_code,''),NEW.sku),
      part_sku=coalesce(nullif(r.part_sku,''),NEW.sku),
      engineering_revision=coalesce(nullif(r.engineering_revision,''),NEW.engineering_revision),
      updated_at=now()
    where r.identity_uid=v_uid
      and (r.source_entity_id is null or r.source_entity_id=NEW.id);
    if not found then raise exception 'Identity % is already bound to another controlled entity.',NEW.serial_number; end if;
  else
    insert into vyndi_identity_registry
      (visible_id,identity_kind,traceability_class,family_code,variant_code,part_sku,engineering_revision,
       source_entity_type,source_entity_id,legacy_format,source_ref,created_by)
    values
      (NEW.serial_number,'finished_product','A',v_family,NEW.sku,NEW.sku,NEW.engineering_revision,
       'epr_traveller',NEW.id,
       case when NEW.serial_number~'^(LON|LAT|ALT)-[0-9]{4}-[0-9]{4}$' then false else true end,
       'TRAVELLER-IMPORT:DOC04-REV1.2',NEW.created_by)
    returning identity_uid into v_uid;
  end if;
  NEW.identity_uid:=v_uid;
  return NEW;
end;
$$;

drop trigger if exists epr_traveller_identity_bind on epr_travellers;
create trigger epr_traveller_identity_bind
before insert or update of serial_number on epr_travellers
for each row execute function bind_epr_traveller_identity();

-- ---------------------------------------------------------------------------
-- 6. Traveller creation: blank serial means VYNDI must generate it. Existing
--    explicit serial input remains supported only as a compatibility/import
--    path so historical tests/imports are not destroyed.
-- ---------------------------------------------------------------------------
create or replace function raise_epr_traveller_for_job_card(
  p_traveller_id text,
  p_job_card_id text,
  p_serial_number text,
  p_engineering_revision text,
  p_supplier text,
  p_actor_user_id text,
  p_actor_role text
) returns table (
  traveller_id text,
  traveller_status text,
  model_name text,
  bom_revision text,
  sales_order_id text,
  job_card_id text
)
language plpgsql
as $$
declare
  c record;
  v_active_count integer:=0;
  v_model_name text;
  v_venture text;
  v_serial text:=trim(coalesce(p_serial_number,''));
  v_serial_source text:='provided_compatibility';
  v_engineering_revision text:=trim(coalesce(p_engineering_revision,''));
  v_supplier text:=trim(coalesce(p_supplier,''));
begin
  select
      jc.id as job_card_id_value,
      jc.sales_order_id as sales_order_id_value,
      jc.sales_order_revision,
      jc.status,
      jc.units,
      jc.model_tier,
      jc.variant_id,
      jc.bom_revision
    into c
    from epr_production_job_cards jc
   where jc.id=p_job_card_id
   for update;
  if not found then raise exception 'Production job card not found.'; end if;
  if c.status not in ('released','in_progress') then
    raise exception 'Traveller can only be raised for a released or in-progress job card; current status is %.',c.status;
  end if;
  if c.model_tier is null or c.model_tier not in ('core','pro','apex') then
    raise exception 'Job card has no controlled VINDY model tier.';
  end if;
  if c.variant_id is null or trim(c.variant_id)='' then
    raise exception 'Job card has no exact released VINDY variant.';
  end if;
  if c.bom_revision is null or trim(c.bom_revision)='' then
    raise exception 'Job card has no released BOM revision.';
  end if;
  if v_engineering_revision='' then raise exception 'Engineering revision is required.'; end if;

  if v_serial='' then
    v_serial:=generate_vyndi_finished_product_serial(c.model_tier);
    v_serial_source:='governed_generator';
  end if;

  if exists(select 1 from epr_travellers tr where tr.serial_number=v_serial) then
    raise exception 'Serial number % already exists.',v_serial;
  end if;

  select count(*)::integer
    into v_active_count
    from epr_travellers tr
   where tr.job_card_id=c.job_card_id_value and tr.status<>'rejected';
  if v_active_count >= ceil(c.units)::integer then
    raise exception 'Job card % already has % active/completed traveller(s) for % unit(s).',c.job_card_id_value,v_active_count,c.units;
  end if;

  v_model_name:=case c.model_tier
    when 'core' then 'Longitude'
    when 'pro' then 'Latitude'
    when 'apex' then 'Altitude'
  end;
  v_venture:=case when c.model_tier='core' then 'aluminium' else 'carbon' end;

  insert into epr_travellers
    (id,venture,model_id,model_name,sku,bom_revision,engineering_revision,serial_number,supplier,status,created_by,
     job_card_id,job_card_revision)
  values
    (p_traveller_id,v_venture,c.model_tier,v_model_name,c.variant_id,c.bom_revision,v_engineering_revision,v_serial,v_supplier,
     'draft',p_actor_user_id,c.job_card_id_value,c.sales_order_revision);

  insert into epr_gate_events (id,traveller_id,gate_id,status,actor)
  values ('GATE-' || p_traveller_id || '-EPR04',p_traveller_id,'EPR-04','planned',p_actor_user_id);

  insert into epr_audit_events
    (id,venture,entity_type,entity_id,action,actor,payload_json)
  values
    ('AUD-' || p_traveller_id || '-CREATE',v_venture,'traveller',p_traveller_id,'raised_from_production_job_card',p_actor_user_id,
     json_build_object('jobCardId',c.job_card_id_value,'salesOrderId',c.sales_order_id_value,'salesOrderRevision',c.sales_order_revision,
       'variantId',c.variant_id,'bomRevision',c.bom_revision,'serialNumber',v_serial,'serialSource',v_serial_source)::text);

  insert into vyndi_audit_events
    (id,entity_type,entity_id,entity_revision,action,actor_user_id,actor_role,source_reference,payload_json)
  values
    ('AUD-' || p_traveller_id || '-PROD','production_traveller',p_traveller_id,c.sales_order_revision,
     'raised_from_job_card',p_actor_user_id,p_actor_role,c.job_card_id_value,
     jsonb_build_object('jobCardId',c.job_card_id_value,'salesOrderId',c.sales_order_id_value,'variantId',c.variant_id,
       'bomRevision',c.bom_revision,'serialNumber',v_serial,'serialSource',v_serial_source,'engineeringRevision',v_engineering_revision));

  return query select p_traveller_id,'draft'::text,v_model_name,c.bom_revision,c.sales_order_id_value,c.job_card_id_value;
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. Production batch release now asks the traveller primitive to generate the
--    serial. The previous VYNDI-<tier>-<hash>-<NNN> namespace is no longer used
--    for newly generated production travellers.
-- ---------------------------------------------------------------------------
create or replace function approve_vyndi_production_batch(
  p_job_card_id text,
  p_actor_user_id text,
  p_actor_role text
) returns table (
  job_card_id text,
  batch_code text,
  travellers_created integer,
  po_drafts_created integer,
  shortage_sku_count integer
)
language plpgsql
as $$
declare
  c record;
  r record;
  t record;
  v_batch text;
  v_existing integer:=0;
  v_target integer:=0;
  v_travellers integer:=0;
  v_po_drafts integer:=0;
  v_shortage_skus integer:=0;
  v_seq integer;
  v_traveller_id text;
  v_action_id text;
  v_po_id text;
  v_price numeric:=0;
  v_cost_authority text:='MISSING';
begin
  select jc.*,o.status as sales_status
    into c
    from epr_production_job_cards jc
    join vyndi_sales_orders o on o.id=jc.sales_order_id
   where jc.id=p_job_card_id
   for update of jc;
  if not found then raise exception 'Production job card not found.'; end if;
  if c.sales_status<>'confirmed' then raise exception 'Production release requires a confirmed Commercial order.'; end if;
  if c.status not in ('released','in_progress') then
    raise exception 'Production release requires a synchronized released job card; current status is %.',c.status;
  end if;
  if c.variant_id is null or trim(c.variant_id)='' then raise exception 'Job card has no exact VINDY variant.'; end if;
  if c.bom_revision is null or trim(c.bom_revision)='' then raise exception 'Job card has no released BOM revision.'; end if;
  if jsonb_array_length(coalesce(c.released_mapping_set,'[]'::jsonb))=0 then raise exception 'Job card has no released BOM mapping snapshot.'; end if;

  v_batch:=coalesce(c.batch_code,'BATCH-'||upper(substr(md5(c.id),1,12)));
  update epr_production_job_cards jc
     set batch_code=v_batch,
         approved_by=coalesce(jc.approved_by,p_actor_user_id),
         approved_at=coalesce(jc.approved_at,now()),
         updated_by=p_actor_user_id,
         updated_at=now()
   where jc.id=c.id;

  v_target:=ceil(c.units)::integer;
  select count(*)::integer into v_existing
    from epr_travellers tr where tr.job_card_id=c.id and tr.status<>'rejected';

  if v_existing<v_target then
    for v_seq in (v_existing+1)..v_target loop
      v_traveller_id:='TRV-'||gen_random_uuid()::text;
      perform raise_epr_traveller_for_job_card(
        v_traveller_id,c.id,'',c.bom_revision,'',p_actor_user_id,p_actor_role
      );
      v_travellers:=v_travellers+1;
    end loop;
  end if;

  for t in
    select tr.id,tr.venture,tr.status from epr_travellers tr
     where tr.job_card_id=c.id and tr.status='draft'
     order by tr.created_at,tr.id
  loop
    if not exists(select 1 from epr_evidence ev where ev.traveller_id=t.id and ev.gate_id='EPR-04' and ev.disposition='accepted') then
      insert into epr_evidence
        (id,traveller_id,gate_id,evidence_type,title,reference,disposition,notes,recorded_by)
      values
        ('EVD-'||gen_random_uuid()::text,t.id,'EPR-04','production_release','Single bike / batch production approval',
         v_batch,'accepted','Model, released BOM, job-card quantity and genealogy approved as one controlled build release.',p_actor_user_id);
    end if;
    if not exists(select 1 from epr_gate_events ge where ge.traveller_id=t.id and ge.gate_id='EPR-04' and ge.status='passed') then
      insert into epr_gate_events(id,traveller_id,gate_id,status,reason,actor)
      values('GATE-'||gen_random_uuid()::text,t.id,'EPR-04','passed','Approved production batch '||v_batch,p_actor_user_id);
    end if;
    update epr_travellers tr set status='released',updated_at=now() where tr.id=t.id;
    insert into epr_audit_events(id,venture,entity_type,entity_id,action,actor,payload_json)
    values('AUD-'||gen_random_uuid()::text,t.venture,'traveller',t.id,'auto_released_from_batch_approval',p_actor_user_id,
      json_build_object('jobCardId',c.id,'batchCode',v_batch,'bomRevision',c.bom_revision)::text);
  end loop;

  select count(*)::integer into v_shortage_skus
    from (
      select req.sku,vyndi_canonical_unit(req.unit)
        from vyndi_live_job_card_requirements req
       where req.job_card_id=c.id and req.sku is not null and req.shortage_quantity>0
       group by req.sku,vyndi_canonical_unit(req.unit)
    ) s;

  for r in
    select req.sku,vyndi_canonical_unit(req.unit) as unit,sum(req.shortage_quantity) as shortage_quantity,min(req.job_card_line_id) as source_line
      from vyndi_live_job_card_requirements req
     where req.job_card_id=c.id and req.sku is not null and req.shortage_quantity>0
     group by req.sku,vyndi_canonical_unit(req.unit)
     order by req.sku
  loop
    v_action_id:='JBREQ-'||upper(substr(md5(c.id||'|'||r.sku||'|'||r.unit),1,24));
    insert into epr_procurement_sku_actions
      (id,scenario,requirement_month,sku,unit,action_type,quantity,status,demand_basis,note,updated_by)
    values
      (v_action_id,'base',c.due_month,upper(r.sku),r.unit,'po',r.shortage_quantity,'planned','committed',
       'Auto-generated from approved Production job card '||c.id||' / batch '||v_batch,p_actor_user_id)
    on conflict (id) do update set
      quantity=excluded.quantity,
      status=case when epr_procurement_sku_actions.status in ('complete','cancelled') then epr_procurement_sku_actions.status else 'planned' end,
      note=excluded.note,updated_by=excluded.updated_by,updated_at=now();

    select coalesce(max(a.governed_cost_inr),0),
           coalesce(max(a.cost_authority) filter (where a.governed_cost_inr is not null),'MISSING')
      into v_price,v_cost_authority
      from vyndi_procurement_cost_authority a
     where upper(a.sku)=upper(r.sku);

    v_po_id:='AUTOPO-'||upper(substr(md5(c.id||'|'||r.sku||'|'||r.unit),1,20));
    if not exists(
      select 1 from vyndi_purchase_orders po
       where po.id=v_po_id and po.status<>'cancelled'
    ) then
      insert into vyndi_purchase_orders
        (id,supplier_id,source_action_id,job_card_id,auto_generated,requirement_month,sku,unit,quantity,
         unit_price_inr,order_date,expected_receipt_on,payment_terms_days,status,source_reference,notes,created_by,updated_by)
      values
        (v_po_id,null,v_action_id,c.id,true,c.due_month,upper(r.sku),r.unit,r.shortage_quantity,
         v_price,current_date,current_date,0,'draft','AUTO:'||c.id,
         case when v_price>0 then
           'Automatically generated from committed job-card shortage using governed cost authority '||v_cost_authority||'. Assign an approved supplier, confirm supplier price/lead time, then submit for independent approval.'
         else
           'Automatically generated from committed job-card shortage. Governed procurement cost is MISSING; unit price remains a zero-value draft placeholder only. Assign an approved supplier and positive controlled price before submission.'
         end,
         p_actor_user_id,p_actor_user_id);
      v_po_drafts:=v_po_drafts+1;
      insert into vyndi_audit_events
        (id,entity_type,entity_id,entity_revision,action,actor_user_id,actor_role,source_reference,payload_json)
      values
        ('AUD-'||v_po_id,'purchase_order',v_po_id,c.sales_order_revision,'auto_draft_created_from_job_shortage',
         p_actor_user_id,p_actor_role,c.id,
         jsonb_build_object('jobCardId',c.id,'batchCode',v_batch,'sku',upper(r.sku),'quantity',r.shortage_quantity,
           'governedCostInr',v_price,'costAuthority',v_cost_authority,'supplierAssigned',false));
    end if;
  end loop;

  insert into vyndi_audit_events
    (id,entity_type,entity_id,entity_revision,action,actor_user_id,actor_role,source_reference,payload_json)
  values
    ('AUD-'||c.id||'-APPROVE-'||substr(md5(clock_timestamp()::text),1,8),'production_job_card',c.id,c.sales_order_revision,
     'bike_batch_approved',p_actor_user_id,p_actor_role,c.sales_order_id,
     jsonb_build_object('batchCode',v_batch,'units',c.units,'variantId',c.variant_id,'bomRevision',c.bom_revision,
       'travellersCreated',v_travellers,'shortageSkus',v_shortage_skus,'poDraftsCreated',v_po_drafts,'serialAuthority','DOC04-REV1.2'));

  return query select c.id,v_batch,v_travellers,v_po_drafts,v_shortage_skus;
end;
$$;

comment on function approve_vyndi_production_batch(text,text,text) is
  'Governed bike/batch release. New Production travellers use DOC 04 Rev 1.2 model serial authority; procurement behavior remains unchanged from migration 0042.';

-- ---------------------------------------------------------------------------
-- 8. Reconciliation / audit views.
-- ---------------------------------------------------------------------------
create or replace view vyndi_identity_reconciliation_report as
select
  tr.id as traveller_id,
  tr.serial_number,
  tr.model_name,
  tr.sku as variant_id,
  tr.identity_uid,
  r.visible_id as registered_identity,
  r.legacy_format,
  case
    when r.identity_uid is null then 'UNREGISTERED'
    when r.visible_id<>tr.serial_number then 'MISMATCH'
    when r.legacy_format then 'LEGACY_RETAINED'
    else 'CANONICAL'
  end as reconciliation_status,
  r.source_ref
from epr_travellers tr
left join vyndi_identity_registry r on r.identity_uid=tr.identity_uid;

create or replace view vyndi_inventory_identity_register as
select
  i.ledger_id,
  i.sku,
  i.name,
  i.category,
  i.traceability_class as item_traceability_class,
  m.movement_id,
  m.vyndi_internal_reference,
  m.traceability_class,
  m.manufacturer,
  m.brand,
  m.oem_model_number,
  m.oem_part_number,
  m.oem_serial_number,
  m.supplier_sku,
  m.supplier_lot,
  m.invoice_reference,
  m.grn_reference,
  m.warranty_reference,
  m.calibration_reference,
  m.identity_uid
from vyndi_inventory_receipt_metadata m
join master_inventory_items i on i.id=m.master_inventory_item_id;

comment on table vyndi_identity_registry is
  'Canonical VYNDI identity registry. Visible business references are separated from immutable internal UUIDs and preserved OEM identities.';
comment on table vyndi_identity_aliases is
  'Historical/alternate references mapped to the immutable VYNDI identity UID. Legacy serials are never silently renumbered.';
comment on table vyndi_identity_genealogy is
  'Effective-dated parent-child genealogy supporting as-built and as-maintained product configuration.';
comment on function register_vyndi_inventory_receipt_identity(text,text,text,text,text,text,text,text,text,text,text,text,text,text,text) is
  'Registers purchased equipment/spares/tools/assets without replacing OEM/manufacturer/supplier identities; adds a VYNDI internal reference for cross-ledger control.';
