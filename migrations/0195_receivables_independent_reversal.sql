-- Preserve existing audit/cash/reversal paths; require an independent finance approver.
create or replace function void_vyndi_invoice(
  p_id text,p_reason text,p_actor_user_id text,p_actor_role text
) returns integer
language plpgsql
as $$
declare v_revision integer; v_maker text;
begin
  if trim(coalesce(p_actor_user_id,''))='' or coalesce(p_actor_role,'') not in ('admin','finance') then raise exception 'Independent finance approval authority is required.'; end if;
  if trim(coalesce(p_reason,''))='' then raise exception 'Invoice void reason is required.'; end if;
  perform pg_advisory_xact_lock(hashtext('invoice|' || p_id)::bigint);
  if exists(select 1 from vyndi_collections where invoice_id=p_id and status='posted') then raise exception 'Reverse posted collections before voiding invoice.'; end if;
  select issued_by into v_maker from vyndi_invoices where id=p_id for update;
  if v_maker=p_actor_user_id then raise exception 'Invoice void requires a different authorised user.'; end if;
  if exists(select 1 from vyndi_customer_credit_notes where invoice_id=p_id and status='active') then raise exception 'Resolve customer credit notes before voiding invoice.'; end if;
  update vyndi_invoices set status='void',revision=revision+1,voided_by=p_actor_user_id,voided_at=now(),void_reason=p_reason
   where id=p_id and status='issued' returning revision into v_revision;
  if not found then
    select revision into v_revision from vyndi_invoices where id=p_id and status='void';
    if not found then raise exception 'Issued invoice not found.'; end if;
    return v_revision;
  end if;
  insert into vyndi_audit_events(id,entity_type,entity_id,entity_revision,action,actor_user_id,actor_role,payload_json)
  values('AUD-INV-'||p_id||'-R'||v_revision,'invoice',p_id,v_revision,'voided',p_actor_user_id,p_actor_role,jsonb_build_object('reason',p_reason));
  return v_revision;
end;
$$;

create or replace function reverse_vyndi_collection(
  p_id text,p_reason text,p_actor_user_id text,p_actor_role text
) returns integer
language plpgsql
as $$
declare
  v_row vyndi_collections%rowtype;
  v_revision integer;
  v_cash numeric;
  v_cash_revision integer;
begin
  if trim(coalesce(p_actor_user_id,''))='' or coalesce(p_actor_role,'') not in ('admin','finance') then raise exception 'Independent finance approval authority is required.'; end if;
  if trim(coalesce(p_reason,''))='' then raise exception 'Collection reversal reason is required.'; end if;
  perform pg_advisory_xact_lock(hashtext('collection|'||p_id)::bigint);
  select * into v_row from vyndi_collections where id=p_id for update;
  if not found then raise exception 'Posted collection not found.'; end if;
  if v_row.status='reversed' then return v_row.revision; end if;
  if v_row.posted_by=p_actor_user_id then raise exception 'Collection reversal requires a different authorised user.'; end if;
  if exists(
    select 1 from vyndi_customer_refunds r
    join vyndi_customer_credit_notes c on c.id=r.credit_note_id
    where c.invoice_id=v_row.invoice_id and r.status='posted'
  ) then
    raise exception 'Reverse posted customer refunds before reversing a collection on the credited invoice.';
  end if;

  update vyndi_collections
     set status='reversed',revision=revision+1,reversed_by=p_actor_user_id,reversed_at=now(),reversal_reason=p_reason
   where id=p_id and status='posted'
   returning revision into v_revision;

  if v_row.cash_actual_revision is not null then
    select x.new_closing_cash_lakh,x.actual_revision into v_cash,v_cash_revision
      from apply_vyndi_verified_cash_movement(
        v_row.plan_month,-v_row.amount_lakh,
        'customer-collection-reversal:'||p_id||'; '||trim(p_reason),p_actor_user_id,p_actor_role
      ) x;
    update vyndi_collections
       set cash_reversal_revision=v_cash_revision,reversed_closing_cash_lakh=v_cash
     where id=p_id;
  end if;

  insert into vyndi_audit_events(id,entity_type,entity_id,entity_revision,action,actor_user_id,actor_role,source_reference,payload_json)
  values(
    'AUD-COL-'||p_id||'-R'||v_revision,'collection',p_id,v_revision,'reversed',p_actor_user_id,p_actor_role,
    trim(p_reason),jsonb_build_object('reason',p_reason,'cashPlanMonth',v_row.plan_month,
      'cashReversed',v_row.cash_actual_revision is not null,'newClosingCashLakh',v_cash,'actualRevision',v_cash_revision)
  );
  return v_revision;
end;
$$;
