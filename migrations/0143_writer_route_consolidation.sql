-- Canonical writer / route consolidation.
-- 1) New ERP SKU identity must originate in approved Inventory Master.
-- 2) Funding lifecycle inserts emit the shared enterprise audit event shape.

create or replace function guard_vyndi_master_inventory_identity()
returns trigger
language plpgsql
as $$
declare
  v_master record;
  v_category text;
  v_unit text;
begin
  select m.name,m.attributes
    into v_master
    from master_data_records m
   where m.domain='inventory'
     and upper(trim(m.code))=upper(trim(new.sku))
     and m.status='approved'
   order by m.revision desc,m.updated_at desc
   limit 1;

  if not found then
    raise exception 'New ERP SKU identity requires an approved Inventory Master record for SKU %.',new.sku;
  end if;

  v_category:=nullif(trim(coalesce(v_master.attributes->>'category','')),'');
  v_unit:=nullif(trim(coalesce(v_master.attributes->>'unit','')),'');
  if trim(new.name)<>trim(v_master.name)
     or (v_category is not null and trim(new.category)<>v_category)
     or (v_unit is not null and vyndi_canonical_unit(new.unit)<>vyndi_canonical_unit(v_unit)) then
    raise exception 'New ERP SKU identity metadata must match the approved Inventory Master record for SKU %.',new.sku;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_vyndi_master_inventory_identity on master_inventory_items;
create trigger trg_vyndi_master_inventory_identity
after insert on master_inventory_items
for each row execute function guard_vyndi_master_inventory_identity();

create or replace function audit_vyndi_funding_lifecycle_insert()
returns trigger
language plpgsql
as $$
declare
  v_row jsonb:=to_jsonb(new);
  v_actor text;
  v_role text;
  v_source text;
  v_entity_type text;
  v_entity_id text;
  v_action text;
  v_event_type text;
begin
  v_actor:=coalesce(v_row->>'recorded_by',v_row->>'created_by','system');
  v_role:=coalesce(v_row->>'recorded_role',v_row->>'created_role','system');
  v_source:=coalesce(v_row->>'evidence_reference',v_row->>'source_reference','FUNDING_LIFECYCLE');
  v_event_type:=coalesce(v_row->>'event_type','');

  if tg_table_name='vyndi_funding_loan_ledger' then
    v_entity_type:='funding_loan';
    v_entity_id:=coalesce(v_row->>'loan_id',v_row->>'id');
    v_action:=case v_event_type
      when 'drawdown' then 'FUNDING_LOAN_DRAWDOWN_RECORDED'
      when 'interest_accrual' then 'FUNDING_LOAN_INTEREST_ACCRUED'
      when 'principal_repayment' then 'FUNDING_LOAN_PRINCIPAL_REPAID'
      when 'interest_repayment' then 'FUNDING_LOAN_INTEREST_REPAID'
      else 'FUNDING_LOAN_LEDGER_EVENT_RECORDED'
    end;
  elsif tg_table_name='vyndi_funding_grants' then
    v_entity_type:='funding_grant';
    v_entity_id:=v_row->>'id';
    v_action:='FUNDING_GRANT_CREATED';
  elsif tg_table_name='vyndi_funding_grant_receipts' then
    v_entity_type:='funding_grant';
    v_entity_id:=coalesce(v_row->>'grant_id',v_row->>'id');
    v_action:='FUNDING_GRANT_RECEIPT_LINKED';
  elsif tg_table_name='vyndi_funding_grant_utilisation' then
    v_entity_type:='funding_grant';
    v_entity_id:=coalesce(v_row->>'grant_id',v_row->>'id');
    v_action:='FUNDING_GRANT_UTILISATION_POSTED';
  elsif tg_table_name='vyndi_funding_grant_conditions' then
    v_entity_type:='funding_grant';
    v_entity_id:=coalesce(v_row->>'grant_id',v_row->>'id');
    v_action:='FUNDING_GRANT_CONDITION_RECORDED';
  else
    return new;
  end if;

  insert into vyndi_audit_events(
    id,entity_type,entity_id,action,actor_user_id,actor_role,source_reference,
    payload_json,correlation_id
  ) values (
    'AUD-FUND-'||md5(tg_table_name||'|'||coalesce(v_row->>'id','')||'|'||clock_timestamp()::text),
    v_entity_type,v_entity_id,v_action,v_actor,v_role,v_source,
    v_row,'FUNDING|'||v_entity_type||'|'||v_entity_id
  );
  return new;
end;
$$;

drop trigger if exists trg_vyndi_funding_loan_ledger_audit on vyndi_funding_loan_ledger;
create trigger trg_vyndi_funding_loan_ledger_audit
after insert on vyndi_funding_loan_ledger
for each row execute function audit_vyndi_funding_lifecycle_insert();

drop trigger if exists trg_vyndi_funding_grants_audit on vyndi_funding_grants;
create trigger trg_vyndi_funding_grants_audit
after insert on vyndi_funding_grants
for each row execute function audit_vyndi_funding_lifecycle_insert();

drop trigger if exists trg_vyndi_funding_grant_receipts_audit on vyndi_funding_grant_receipts;
create trigger trg_vyndi_funding_grant_receipts_audit
after insert on vyndi_funding_grant_receipts
for each row execute function audit_vyndi_funding_lifecycle_insert();

drop trigger if exists trg_vyndi_funding_grant_utilisation_audit on vyndi_funding_grant_utilisation;
create trigger trg_vyndi_funding_grant_utilisation_audit
after insert on vyndi_funding_grant_utilisation
for each row execute function audit_vyndi_funding_lifecycle_insert();

drop trigger if exists trg_vyndi_funding_grant_conditions_audit on vyndi_funding_grant_conditions;
create trigger trg_vyndi_funding_grant_conditions_audit
after insert on vyndi_funding_grant_conditions
for each row execute function audit_vyndi_funding_lifecycle_insert();

comment on function guard_vyndi_master_inventory_identity() is
  'Prevents a second ERP SKU identity authority. New master_inventory_items rows require an approved Inventory Master record.';
comment on function audit_vyndi_funding_lifecycle_insert() is
  'Normalizes Funding lifecycle ledger inserts into the shared vyndi_audit_events enterprise trail.';
