-- VYNDI V1 stocktake + statutory close hardening.
-- Physical counts never overwrite stock. Approved variances post through the canonical
-- append-only quantity ledger, FIFO layers/allocations and inventory cost ledger.

create table if not exists epr_inventory_stocktakes (
  id text primary key,
  period text not null check (period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  effective_on date not null,
  scope_reference text not null check (trim(scope_reference) <> ''),
  evidence_reference text not null check (trim(evidence_reference) <> ''),
  book_snapshot_at timestamptz not null default now(),
  status text not null default 'draft'
    check (status in ('draft','submitted','approved','posted','void')),
  prepared_by text not null,
  prepared_at timestamptz not null default now(),
  submitted_by text,
  submitted_at timestamptz,
  approved_by text,
  approved_at timestamptz,
  posted_by text,
  posted_at timestamptz,
  variance_line_count integer not null default 0 check (variance_line_count >= 0),
  gain_value_inr numeric(18,2) not null default 0 check (gain_value_inr >= 0),
  loss_value_inr numeric(18,2) not null default 0 check (loss_value_inr >= 0),
  finance_journal_id text
);

create unique index if not exists epr_inventory_stocktakes_active_period_uidx
  on epr_inventory_stocktakes(period)
  where status in ('draft','submitted','approved');
create unique index if not exists epr_inventory_stocktakes_posted_period_uidx
  on epr_inventory_stocktakes(period)
  where status='posted';
create index if not exists epr_inventory_stocktakes_status_idx
  on epr_inventory_stocktakes(status,period desc,prepared_at desc);

create table if not exists epr_inventory_stocktake_lines (
  stocktake_id text not null references epr_inventory_stocktakes(id) on delete restrict,
  sku text not null,
  unit text not null,
  expected_quantity numeric(14,4) not null check (expected_quantity >= 0),
  book_unit_cost_inr numeric(18,4) not null default 0 check (book_unit_cost_inr >= 0),
  book_inventory_value_inr numeric(18,4) not null default 0,
  snapshot_last_movement_at timestamptz,
  counted_quantity numeric(14,4) check (counted_quantity >= 0),
  counted_unit_cost_inr numeric(18,4) check (counted_unit_cost_inr >= 0),
  count_reference text,
  evidence_reference text,
  counted_by text,
  counted_at timestamptz,
  primary key(stocktake_id,sku,unit)
);

create index if not exists epr_inventory_stocktake_lines_sku_idx
  on epr_inventory_stocktake_lines(sku,unit,stocktake_id);

create table if not exists epr_inventory_stocktake_events (
  id text primary key,
  stocktake_id text not null references epr_inventory_stocktakes(id) on delete restrict,
  event_type text not null
    check (event_type in ('started','count_recorded','submitted','approved','posted','voided')),
  actor_user_id text not null,
  actor_role text not null,
  evidence_reference text not null default '',
  payload_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists epr_inventory_stocktake_events_idx
  on epr_inventory_stocktake_events(stocktake_id,created_at,id);

create or replace function reject_vyndi_stocktake_event_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'Inventory stocktake events are append-only.';
end;
$$;

drop trigger if exists trg_reject_vyndi_stocktake_event_mutation on epr_inventory_stocktake_events;
create trigger trg_reject_vyndi_stocktake_event_mutation
before update or delete on epr_inventory_stocktake_events
for each row execute function reject_vyndi_stocktake_event_mutation();

create or replace function guard_vyndi_stocktake_line_mutation()
returns trigger language plpgsql as $$
declare v_stocktake_id text; v_status text;
begin
  v_stocktake_id:=case when tg_op='DELETE' then old.stocktake_id else new.stocktake_id end;
  select status into v_status from epr_inventory_stocktakes where id=v_stocktake_id;
  if v_status is null then raise exception 'Inventory stocktake session not found.'; end if;
  if v_status<>'draft' then
    raise exception 'Inventory stocktake lines are locked after submission.';
  end if;
  return case when tg_op='DELETE' then old else new end;
end;
$$;

drop trigger if exists trg_guard_vyndi_stocktake_line_mutation on epr_inventory_stocktake_lines;
create trigger trg_guard_vyndi_stocktake_line_mutation
before insert or update or delete on epr_inventory_stocktake_lines
for each row execute function guard_vyndi_stocktake_line_mutation();

create or replace function guard_vyndi_stocktake_session_mutation()
returns trigger language plpgsql as $$
begin
  if tg_op='DELETE' then raise exception 'Inventory stocktake sessions cannot be deleted.'; end if;
  if old.status='posted' then raise exception 'Posted inventory stocktake sessions are immutable.'; end if;
  if new.period<>old.period or new.effective_on<>old.effective_on or
     new.scope_reference<>old.scope_reference or new.book_snapshot_at<>old.book_snapshot_at or
     new.prepared_by<>old.prepared_by or new.prepared_at<>old.prepared_at then
    raise exception 'Inventory stocktake snapshot identity is immutable.';
  end if;
  if old.status<>new.status and not (
       (old.status='draft' and new.status in ('submitted','void')) or
       (old.status='submitted' and new.status in ('approved','void')) or
       (old.status='approved' and new.status in ('posted','void'))
     ) then
    raise exception 'Invalid inventory stocktake status transition from % to %.',old.status,new.status;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_vyndi_stocktake_session_mutation on epr_inventory_stocktakes;
create trigger trg_guard_vyndi_stocktake_session_mutation
before update or delete on epr_inventory_stocktakes
for each row execute function guard_vyndi_stocktake_session_mutation();

create or replace function append_vyndi_stocktake_event(
  p_stocktake_id text,
  p_event_type text,
  p_actor_user_id text,
  p_actor_role text,
  p_evidence_reference text,
  p_payload_json jsonb
) returns text
language plpgsql as $$
declare v_id text;
begin
  v_id:='STKE-'||md5(p_stocktake_id||'|'||p_event_type||'|'||p_actor_user_id||'|'||clock_timestamp()::text||'|'||random()::text);
  insert into epr_inventory_stocktake_events
    (id,stocktake_id,event_type,actor_user_id,actor_role,evidence_reference,payload_json)
  values
    (v_id,p_stocktake_id,p_event_type,p_actor_user_id,p_actor_role,coalesce(p_evidence_reference,''),coalesce(p_payload_json,'{}'::jsonb));

  insert into vyndi_audit_events
    (id,entity_type,entity_id,action,actor_user_id,actor_role,source_reference,payload_json)
  values
    ('AUD-'||v_id,'inventory_stocktake',p_stocktake_id,p_event_type,p_actor_user_id,p_actor_role,
     coalesce(p_evidence_reference,''),coalesce(p_payload_json,'{}'::jsonb));
  return v_id;
end;
$$;

create or replace function vyndi_inventory_stocktake_stale_count(p_stocktake_id text)
returns integer
language sql stable as $$
  select count(*)::integer
    from epr_inventory_stocktake_lines l
    left join vyndi_inventory_balance b
      on b.sku=l.sku and b.unit=vyndi_canonical_unit(l.unit)
   where l.stocktake_id=p_stocktake_id
     and (
       abs(l.expected_quantity-coalesce(b.quantity_balance,0))>0.0001
       or coalesce(l.snapshot_last_movement_at,'epoch'::timestamptz)
          <> coalesce(b.last_movement_at,'epoch'::timestamptz)
     );
$$;

create or replace function start_vyndi_inventory_stocktake(
  p_id text,
  p_period text,
  p_effective_on date,
  p_scope_reference text,
  p_evidence_reference text,
  p_actor_user_id text,
  p_actor_role text
) returns table(stocktake_id text,line_count integer)
language plpgsql as $$
declare v_count integer;
begin
  if p_period !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then raise exception 'Stocktake period must be YYYY-MM.'; end if;
  if to_char(p_effective_on,'YYYY-MM')<>p_period then raise exception 'Stocktake effective date must fall inside the stocktake period.'; end if;
  if trim(coalesce(p_scope_reference,''))='' then raise exception 'Stocktake scope reference is required.'; end if;
  if trim(coalesce(p_evidence_reference,''))='' then raise exception 'Stocktake evidence reference is required.'; end if;
  if exists(select 1 from epr_inventory_stocktakes where period=p_period and status in ('draft','submitted','approved','posted')) then
    raise exception 'A controlled stocktake already exists for period %.',p_period;
  end if;

  insert into epr_inventory_stocktakes
    (id,period,effective_on,scope_reference,evidence_reference,prepared_by)
  values
    (p_id,p_period,p_effective_on,trim(p_scope_reference),trim(p_evidence_reference),p_actor_user_id);

  insert into epr_inventory_stocktake_lines
    (stocktake_id,sku,unit,expected_quantity,book_unit_cost_inr,book_inventory_value_inr,snapshot_last_movement_at)
  with stock_keys as (
    select upper(trim(i.sku)) as sku,vyndi_canonical_unit(i.unit) as unit
      from master_inventory_items i where i.active=true
    union
    select b.sku,vyndi_canonical_unit(b.unit) as unit from vyndi_inventory_balance b
  )
  select p_id,k.sku,k.unit,
         greatest(coalesce(b.quantity_balance,0),0),
         greatest(coalesce(b.weighted_average_cost_inr,0),0),
         coalesce(b.inventory_value_inr,0),
         b.last_movement_at
    from stock_keys k
    left join vyndi_inventory_balance b on b.sku=k.sku and b.unit=k.unit
   order by k.sku,k.unit;
  get diagnostics v_count=row_count;

  perform append_vyndi_stocktake_event(
    p_id,'started',p_actor_user_id,p_actor_role,p_evidence_reference,
    jsonb_build_object('period',p_period,'effectiveOn',p_effective_on,'scopeReference',p_scope_reference,'lineCount',v_count)
  );
  return query select p_id,v_count;
end;
$$;

create or replace function record_vyndi_inventory_stocktake_count(
  p_stocktake_id text,
  p_sku text,
  p_unit text,
  p_counted_quantity numeric,
  p_counted_unit_cost_inr numeric,
  p_count_reference text,
  p_evidence_reference text,
  p_actor_user_id text,
  p_actor_role text
) returns text
language plpgsql as $$
declare v_status text; v_sku text:=upper(trim(p_sku)); v_unit text:=vyndi_canonical_unit(p_unit);
begin
  select status into v_status from epr_inventory_stocktakes where id=p_stocktake_id;
  if v_status is null then raise exception 'Inventory stocktake session not found.'; end if;
  if v_status<>'draft' then raise exception 'Counts can only be recorded while the stocktake is draft.'; end if;
  if p_counted_quantity<0 then raise exception 'Counted quantity cannot be negative.'; end if;
  if p_counted_unit_cost_inr is not null and p_counted_unit_cost_inr<0 then raise exception 'Counted unit cost cannot be negative.'; end if;
  if trim(coalesce(p_count_reference,''))='' then raise exception 'Physical count reference is required.'; end if;
  if trim(coalesce(p_evidence_reference,''))='' then raise exception 'Count evidence reference is required.'; end if;

  update epr_inventory_stocktake_lines
     set counted_quantity=p_counted_quantity,
         counted_unit_cost_inr=p_counted_unit_cost_inr,
         count_reference=trim(p_count_reference),
         evidence_reference=trim(p_evidence_reference),
         counted_by=p_actor_user_id,
         counted_at=now()
   where stocktake_id=p_stocktake_id and sku=v_sku and unit=v_unit;
  if not found then raise exception 'Stocktake line not found for % / %.',v_sku,v_unit; end if;

  perform append_vyndi_stocktake_event(
    p_stocktake_id,'count_recorded',p_actor_user_id,p_actor_role,p_evidence_reference,
    jsonb_build_object('sku',v_sku,'unit',v_unit,'countedQuantity',p_counted_quantity,'countReference',p_count_reference)
  );
  return p_stocktake_id;
end;
$$;

create or replace function submit_vyndi_inventory_stocktake(
  p_stocktake_id text,
  p_evidence_reference text,
  p_actor_user_id text,
  p_actor_role text
) returns text
language plpgsql as $$
declare s record; v_missing integer; v_unvalued integer; v_stale integer;
begin
  select * into s from epr_inventory_stocktakes where id=p_stocktake_id for update;
  if not found then raise exception 'Inventory stocktake session not found.'; end if;
  if s.status<>'draft' then raise exception 'Only a draft stocktake can be submitted.'; end if;
  if trim(coalesce(p_evidence_reference,''))='' then raise exception 'Submission evidence reference is required.'; end if;

  select count(*)::integer into v_missing
    from epr_inventory_stocktake_lines
   where stocktake_id=p_stocktake_id and (
     counted_quantity is null or trim(coalesce(count_reference,''))='' or trim(coalesce(evidence_reference,''))=''
   );
  if v_missing>0 then raise exception '% stocktake line(s) are missing physical-count evidence.',v_missing; end if;

  select count(*)::integer into v_unvalued
    from epr_inventory_stocktake_lines
   where stocktake_id=p_stocktake_id
     and counted_quantity>expected_quantity
     and coalesce(nullif(counted_unit_cost_inr,0),nullif(book_unit_cost_inr,0),0)<=0;
  if v_unvalued>0 then raise exception '% positive stock variance line(s) require an approved unit-cost basis.',v_unvalued; end if;

  v_stale:=vyndi_inventory_stocktake_stale_count(p_stocktake_id);
  if v_stale>0 then raise exception 'Stock moved after the snapshot on % line(s); restart the stocktake from a fresh book snapshot.',v_stale; end if;

  update epr_inventory_stocktakes
     set status='submitted',submitted_by=p_actor_user_id,submitted_at=now(),evidence_reference=trim(p_evidence_reference)
   where id=p_stocktake_id;

  perform append_vyndi_stocktake_event(
    p_stocktake_id,'submitted',p_actor_user_id,p_actor_role,p_evidence_reference,
    jsonb_build_object('period',s.period,'lineCount',(select count(*) from epr_inventory_stocktake_lines where stocktake_id=p_stocktake_id))
  );
  return 'submitted';
end;
$$;

create or replace function approve_vyndi_inventory_stocktake(
  p_stocktake_id text,
  p_evidence_reference text,
  p_actor_user_id text,
  p_actor_role text
) returns text
language plpgsql as $$
declare s record; v_stale integer;
begin
  select * into s from epr_inventory_stocktakes where id=p_stocktake_id for update;
  if not found then raise exception 'Inventory stocktake session not found.'; end if;
  if s.status<>'submitted' then raise exception 'Only a submitted stocktake can be approved.'; end if;
  if p_actor_user_id=s.prepared_by then raise exception 'A different user must approve the stocktake; maker/checker self-approval is not permitted.'; end if;
  if trim(coalesce(p_evidence_reference,''))='' then raise exception 'Approval evidence reference is required.'; end if;
  v_stale:=vyndi_inventory_stocktake_stale_count(p_stocktake_id);
  if v_stale>0 then raise exception 'Stock moved after the snapshot on % line(s); approval is blocked.',v_stale; end if;

  update epr_inventory_stocktakes
     set status='approved',approved_by=p_actor_user_id,approved_at=now(),evidence_reference=trim(p_evidence_reference)
   where id=p_stocktake_id;

  perform append_vyndi_stocktake_event(
    p_stocktake_id,'approved',p_actor_user_id,p_actor_role,p_evidence_reference,
    jsonb_build_object('preparedBy',s.prepared_by,'approvedBy',p_actor_user_id)
  );
  return 'approved';
end;
$$;

create or replace function post_vyndi_inventory_stocktake(
  p_stocktake_id text,
  p_evidence_reference text,
  p_actor_user_id text,
  p_actor_role text
) returns table(
  stocktake_id text,status text,variance_line_count integer,
  gain_value_inr numeric,loss_value_inr numeric,finance_journal_id text
)
language plpgsql as $$
declare
  s record;
  l record;
  v_delta numeric;
  v_cost numeric;
  v_fifo numeric;
  v_movement_id text;
  v_ledger_id text;
  v_variance_lines integer:=0;
  v_gain numeric:=0;
  v_loss numeric:=0;
  v_journal text:=null;
  v_lines jsonb:='[]'::jsonb;
  v_stale integer;
begin
  select * into s from epr_inventory_stocktakes where id=p_stocktake_id for update;
  if not found then raise exception 'Inventory stocktake session not found.'; end if;
  if s.status<>'approved' then raise exception 'Only an approved stocktake can be posted.'; end if;
  if p_actor_user_id=s.prepared_by then raise exception 'The stocktake preparer cannot post the approved adjustment.'; end if;
  if trim(coalesce(p_evidence_reference,''))='' then raise exception 'Posting evidence reference is required.'; end if;

  -- Use the same SKU/unit transaction locks as canonical receipts/issues.
  for l in
    select sku,unit from epr_inventory_stocktake_lines where stocktake_id=p_stocktake_id order by sku,unit
  loop
    perform pg_advisory_xact_lock(hashtext(l.sku||'|'||vyndi_canonical_unit(l.unit))::bigint);
  end loop;

  v_stale:=vyndi_inventory_stocktake_stale_count(p_stocktake_id);
  if v_stale>0 then raise exception 'Stock moved after the snapshot on % line(s); posting is blocked.',v_stale; end if;

  for l in
    select * from epr_inventory_stocktake_lines where stocktake_id=p_stocktake_id order by sku,unit
  loop
    v_delta:=round(coalesce(l.counted_quantity,0)-l.expected_quantity,4);
    if abs(v_delta)<=0.0001 then continue; end if;
    v_variance_lines:=v_variance_lines+1;
    v_movement_id:='STK-MOV-'||md5(p_stocktake_id||'|'||l.sku||'|'||l.unit);
    v_ledger_id:='STK-LED-'||md5(p_stocktake_id||'|'||l.sku||'|'||l.unit);

    if v_delta>0 then
      v_cost:=coalesce(nullif(l.counted_unit_cost_inr,0),nullif(l.book_unit_cost_inr,0),0);
      if v_cost<=0 then raise exception 'Positive stock variance for % / % has no approved valuation basis.',l.sku,l.unit; end if;

      insert into epr_inventory_movements
        (id,traveller_id,venture,sku,movement_type,quantity,unit,reference,notes,recorded_by,effective_on)
      values
        (v_movement_id,null,'shared',l.sku,'adjust',v_delta,l.unit,p_stocktake_id,
         'Approved stocktake gain; evidence '||p_evidence_reference,p_actor_user_id,s.effective_on);

      insert into epr_inventory_ledger
        (id,venture,sku,unit,quantity_delta,movement_id,traveller_id,serial_number,reference,notes,recorded_by,unit_cost_inr,effective_on)
      values
        (v_ledger_id,'shared',l.sku,l.unit,v_delta,v_movement_id,null,null,p_stocktake_id,
         'Approved stocktake gain',p_actor_user_id,v_cost,s.effective_on);

      insert into epr_inventory_cost_ledger
        (id,venture,sku,unit,quantity_delta,value_delta_inr,movement_id,traveller_id,unit_cost_inr,reference,recorded_by)
      values
        (v_ledger_id||'-COST','shared',l.sku,l.unit,v_delta,round(v_delta*v_cost,2),v_movement_id,null,v_cost,p_stocktake_id,p_actor_user_id);
      v_gain:=v_gain+round(v_delta*v_cost,2);
    else
      insert into epr_inventory_movements
        (id,traveller_id,venture,sku,movement_type,quantity,unit,reference,notes,recorded_by,effective_on)
      values
        (v_movement_id,null,'shared',l.sku,'adjust',abs(v_delta),l.unit,p_stocktake_id,
         'Approved stocktake loss; evidence '||p_evidence_reference,p_actor_user_id,s.effective_on);

      insert into epr_inventory_ledger
        (id,venture,sku,unit,quantity_delta,movement_id,traveller_id,serial_number,reference,notes,recorded_by,unit_cost_inr,effective_on)
      values
        (v_ledger_id,'shared',l.sku,l.unit,v_delta,v_movement_id,null,null,p_stocktake_id,
         'Approved stocktake loss',p_actor_user_id,l.book_unit_cost_inr,s.effective_on);

      select coalesce(sum(extended_cost_inr),0) into v_fifo
        from epr_inventory_fifo_allocations where issue_ledger_id=v_ledger_id;
      v_cost:=case when abs(v_delta)>0 then v_fifo/abs(v_delta) else 0 end;

      insert into epr_inventory_cost_ledger
        (id,venture,sku,unit,quantity_delta,value_delta_inr,movement_id,traveller_id,unit_cost_inr,reference,recorded_by)
      values
        (v_ledger_id||'-COST','shared',l.sku,l.unit,v_delta,-v_fifo,v_movement_id,null,v_cost,p_stocktake_id,p_actor_user_id);
      v_loss:=v_loss+v_fifo;
    end if;
  end loop;

  v_gain:=round(v_gain,2);
  v_loss:=round(v_loss,2);

  if v_loss>0 then
    v_lines:=v_lines||jsonb_build_array(
      jsonb_build_object('accountCode','5200','debitInr',v_loss,'memo','Physical stocktake shortage / inventory variance'),
      jsonb_build_object('accountCode','1200','creditInr',v_loss,'memo','Reduce inventory to approved physical count')
    );
  end if;
  if v_gain>0 then
    v_lines:=v_lines||jsonb_build_array(
      jsonb_build_object('accountCode','1200','debitInr',v_gain,'memo','Increase inventory to approved physical count'),
      jsonb_build_object('accountCode','5200','creditInr',v_gain,'memo','Physical stocktake gain / inventory variance')
    );
  end if;

  if jsonb_array_length(v_lines)>0 then
    v_journal:=post_vyndi_finance_journal(
      'FIN-STOCKTAKE-'||p_stocktake_id,s.effective_on,'inventory_stocktake',p_stocktake_id,
      'Approved physical inventory stocktake '||p_stocktake_id,v_lines
    );
  end if;

  update epr_inventory_stocktakes
     set status='posted',posted_by=p_actor_user_id,posted_at=now(),evidence_reference=trim(p_evidence_reference),
         variance_line_count=v_variance_lines,gain_value_inr=v_gain,loss_value_inr=v_loss,finance_journal_id=v_journal
   where id=p_stocktake_id;

  perform append_vyndi_stocktake_event(
    p_stocktake_id,'posted',p_actor_user_id,p_actor_role,p_evidence_reference,
    jsonb_build_object('varianceLineCount',v_variance_lines,'gainValueInr',v_gain,'lossValueInr',v_loss,'financeJournalId',v_journal)
  );

  return query select p_stocktake_id,'posted'::text,v_variance_lines,v_gain,v_loss,v_journal;
end;
$$;

create or replace view vyndi_inventory_stocktake_period_readiness as
select p.period,
       count(*) filter(where p.status='posted')::integer as posted_stocktake_count,
       count(*) filter(where p.status in ('draft','submitted','approved'))::integer as open_stocktake_count,
       max(p.posted_at) filter(where p.status='posted') as latest_posted_at,
       max(p.finance_journal_id) filter(where p.status='posted') as latest_finance_journal_id,
       coalesce(sum(p.gain_value_inr) filter(where p.status='posted'),0)::numeric(18,2) as gain_value_inr,
       coalesce(sum(p.loss_value_inr) filter(where p.status='posted'),0)::numeric(18,2) as loss_value_inr
  from epr_inventory_stocktakes p
 group by p.period
 order by p.period desc;

comment on table epr_inventory_stocktakes is
  'Controlled physical-inventory stocktake sessions. Book snapshots are immutable; only independently approved variances can post.';
comment on table epr_inventory_stocktake_lines is
  'Full-scope physical-count evidence over active Master Inventory plus any authoritative ledger SKU/unit.';
comment on table epr_inventory_stocktake_events is
  'Append-only stocktake governance evidence for count, submission, maker/checker approval and posting.';
comment on view vyndi_inventory_stocktake_period_readiness is
  'Period-close stocktake readiness. Statutory finance hard close requires one posted stocktake and no open stocktake for the period.';
