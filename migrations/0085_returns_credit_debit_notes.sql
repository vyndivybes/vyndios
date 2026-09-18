-- Governed customer RMA / credit-note / refund and supplier return / debit-note / refund authority.
-- Original invoices, dispatches, GRNs and payments remain immutable audit history. Returns are
-- separate controlled transactions. Calendar dates are never inferred into VIBPE M1..M36.

-- ---------------------------------------------------------------------------
-- Customer returns / credit notes / refunds
-- ---------------------------------------------------------------------------
create table if not exists vyndi_customer_returns (
  id text primary key,
  invoice_id text not null references vyndi_invoices(id) on delete restrict,
  plan_month integer not null check (plan_month between 1 and 36),
  returned_on date not null,
  quantity numeric(14,4) not null check (quantity>0),
  disposition text not null check (disposition in ('restock','quarantine','scrap')),
  reason text not null,
  source_reference text not null unique,
  sale_type text not null check (sale_type in ('bicycle','spare_component')),
  identity_uid uuid references vyndi_identity_registry(identity_uid) on delete restrict,
  inventory_movement_id text unique references epr_inventory_movements(id) on delete restrict,
  inventory_ledger_id text unique references epr_inventory_ledger(id) on delete restrict,
  restored_cogs_inr numeric(18,2) not null default 0 check (restored_cogs_inr>=0),
  status text not null default 'received' check (status in ('received')),
  created_by text not null,
  created_at timestamptz not null default now()
);
create index if not exists vyndi_customer_returns_invoice_idx
  on vyndi_customer_returns(invoice_id,plan_month,returned_on);

create table if not exists vyndi_customer_credit_notes (
  id text primary key,
  customer_return_id text not null unique references vyndi_customer_returns(id) on delete restrict,
  invoice_id text not null references vyndi_invoices(id) on delete restrict,
  plan_month integer not null check (plan_month between 1 and 36),
  credit_on date not null,
  quantity numeric(14,4) not null check (quantity>0),
  taxable_value_inr numeric(18,2) not null check (taxable_value_inr>=0),
  gst_inr numeric(18,2) not null check (gst_inr>=0),
  gross_amount_inr numeric(18,2) not null check (gross_amount_inr>0),
  source_reference text not null unique,
  journal_id text not null unique references epr_finance_journals(id) on delete restrict,
  status text not null default 'active' check (status in ('active')),
  created_by text not null,
  created_at timestamptz not null default now()
);
create index if not exists vyndi_customer_credit_note_invoice_idx
  on vyndi_customer_credit_notes(invoice_id,plan_month,credit_on);

create table if not exists vyndi_customer_refunds (
  id text primary key,
  credit_note_id text not null references vyndi_customer_credit_notes(id) on delete restrict,
  plan_month integer not null check (plan_month between 1 and 36),
  refunded_on date not null,
  amount_inr numeric(18,2) not null check (amount_inr>0),
  evidence_reference text not null unique,
  journal_id text not null unique references epr_finance_journals(id) on delete restrict,
  cash_actual_revision integer not null check (cash_actual_revision>0),
  new_closing_cash_lakh numeric(18,4) not null,
  status text not null default 'posted' check (status in ('posted','reversed')),
  revision integer not null default 1 check (revision>0),
  created_by text not null,
  created_at timestamptz not null default now(),
  reversed_by text,
  reversed_at timestamptz,
  reversal_reason text,
  cash_reversal_revision integer,
  reversed_closing_cash_lakh numeric(18,4)
);
create index if not exists vyndi_customer_refunds_note_idx
  on vyndi_customer_refunds(credit_note_id,status,plan_month,refunded_on);

create or replace function post_vyndi_customer_return(
  p_id text,
  p_invoice_id text,
  p_plan_month integer,
  p_returned_on date,
  p_quantity numeric,
  p_disposition text,
  p_identity_uid uuid,
  p_reason text,
  p_source_reference text,
  p_actor_user_id text,
  p_actor_role text
) returns table(return_id text,restored_cogs_inr numeric)
language plpgsql
as $$
declare
  i vyndi_invoices%rowtype;
  s vyndi_spare_sales%rowtype;
  v_returned numeric;
  v_identity uuid:=p_identity_uid;
  v_unit_cost numeric:=0;
  v_restored numeric:=0;
  v_movement text;
  v_ledger text;
  v_old_meta record;
  v_identity_row vyndi_identity_registry%rowtype;
  v_job_cost numeric:=0;
begin
  if p_plan_month not between 1 and 36 then raise exception 'Customer return plan month must be between 1 and 36.'; end if;
  if coalesce(p_quantity,0)<=0 then raise exception 'Customer return quantity must be positive.'; end if;
  if p_disposition not in ('restock','quarantine','scrap') then raise exception 'Controlled customer return disposition is required.'; end if;
  if trim(coalesce(p_reason,''))='' then raise exception 'Customer return / RMA reason is required.'; end if;
  if trim(coalesce(p_source_reference,''))='' then raise exception 'Customer return / RMA evidence reference is required.'; end if;

  perform pg_advisory_xact_lock(hashtext('customer-return|'||p_invoice_id)::bigint);
  if exists(select 1 from vyndi_customer_returns where id=upper(trim(p_id))) then
    return query select r.id,r.restored_cogs_inr from vyndi_customer_returns r where r.id=upper(trim(p_id));
    return;
  end if;
  if exists(select 1 from vyndi_customer_returns where source_reference=trim(p_source_reference)) then
    raise exception 'Customer return / RMA evidence reference has already been used.';
  end if;

  select * into i from vyndi_invoices where id=p_invoice_id and status='issued' for update;
  if not found then raise exception 'Issued customer invoice not found.'; end if;

  select coalesce(sum(quantity),0) into v_returned
    from vyndi_customer_returns where invoice_id=i.id;
  if v_returned+p_quantity>i.units+0.0001 then
    raise exception 'Customer return quantity exceeds the invoiced quantity remaining for return.';
  end if;

  if i.sale_type='bicycle' then
    if p_quantity<>1 then raise exception 'Serialized bicycle RMAs must be returned one controlled identity at a time.'; end if;
    if v_identity is null then raise exception 'Bicycle RMA requires the controlled finished-product identity.'; end if;
    if not exists(
      select 1
        from vyndi_identity_registry ir
        join epr_travellers t on ir.source_entity_type='epr_traveller' and ir.source_entity_id=t.id
        join epr_production_job_cards c on c.id=t.job_card_id
       where ir.identity_uid=v_identity and ir.identity_kind='finished_product'
         and c.sales_order_id=i.sales_order_id
    ) then
      raise exception 'Returned bicycle identity does not belong to the invoiced sales order.';
    end if;
  else
    select * into s from vyndi_spare_sales where id=i.spare_sale_id and status='dispatched';
    if not found then raise exception 'Controlled spare/component dispatch not found for return.'; end if;
    if s.traceability_class='A' then
      if p_quantity<>1 then raise exception 'Class A spare/component returns must be processed one controlled identity at a time.'; end if;
      v_identity:=coalesce(v_identity,s.selected_identity_uid);
      if v_identity is null or v_identity is distinct from s.selected_identity_uid then
        raise exception 'Class A spare/component return must use the identity dispatched on the original sale.';
      end if;
    elsif v_identity is not null and v_identity is distinct from s.selected_identity_uid then
      raise exception 'Returned spare identity does not match the original controlled dispatch.';
    end if;
  end if;

  if v_identity is not null and exists(
    select 1 from vyndi_customer_returns r where r.identity_uid=v_identity
  ) then
    raise exception 'Controlled identity already has a customer return / RMA record.';
  end if;

  if p_disposition='restock' then
    if i.sale_type='spare_component' then
      v_unit_cost:=case when s.quantity>0 then round(s.fifo_cost_inr/s.quantity,2) else 0 end;
      v_restored:=round(v_unit_cost*p_quantity,2);
      v_movement:='CUST-RET-REC-'||upper(trim(p_id));
      v_ledger:='CUST-RET-LED-'||upper(trim(p_id));

      perform post_vyndi_inventory_receipt(
        v_movement,v_ledger,s.sku,p_quantity,s.unit,v_unit_cost,p_returned_on,
        trim(p_source_reference),'Customer return / RMA '||upper(trim(p_id)),p_actor_user_id,p_actor_role
      );

      -- Rebind the immutable controlled identity to the new physical receipt layer. The old
      -- receipt retains all OEM/lot text evidence; only the current custody binding moves.
      if v_identity is not null then
        select * into v_identity_row from vyndi_identity_registry where identity_uid=v_identity;
        update vyndi_inventory_receipt_metadata set identity_uid=null where identity_uid=v_identity;
        insert into vyndi_inventory_receipt_metadata(
          movement_id,master_inventory_item_id,recorded_by,identity_uid,vyndi_internal_reference,traceability_class,
          manufacturer,brand,oem_model_number,oem_part_number,oem_serial_number,supplier_sku,supplier_lot,
          invoice_reference,grn_reference,warranty_reference,calibration_reference)
        values(
          v_movement,s.inventory_item_id,p_actor_user_id,v_identity,v_identity_row.visible_id,s.traceability_class,
          v_identity_row.manufacturer,v_identity_row.brand,v_identity_row.oem_model_number,v_identity_row.oem_part_number,
          v_identity_row.oem_serial_number,v_identity_row.supplier_sku,v_identity_row.supplier_lot,
          v_identity_row.invoice_reference,v_identity_row.grn_reference,v_identity_row.warranty_reference,
          v_identity_row.calibration_reference
        );
      else
        insert into vyndi_inventory_receipt_metadata(
          movement_id,master_inventory_item_id,recorded_by,traceability_class)
        values(v_movement,s.inventory_item_id,p_actor_user_id,s.traceability_class);
      end if;

      if v_restored>0 then
        perform post_vyndi_finance_journal(
          'FIN-CUST-RET-COGS-'||upper(trim(p_id)),p_returned_on,'customer_return_cogs',upper(trim(p_id)),
          'Restock COGS reversal for customer return '||upper(trim(p_id)),
          jsonb_build_array(
            jsonb_build_object('accountCode','1200','debitInr',v_restored,'memo','Returned component inventory restored'),
            jsonb_build_object('accountCode','5000','creditInr',v_restored,'memo','Reverse returned component COGS')
          )
        );
      end if;
    else
      select coalesce(sum(l.debit_inr),0) into v_job_cost
        from epr_finance_journals j
        join epr_finance_journal_lines l on l.journal_id=j.id
       where j.source_type='dispatch_cogs' and j.source_id=i.shipment_id and j.status='posted'
         and l.account_code='5000';
      v_unit_cost:=case when i.units>0 then round(v_job_cost/i.units,2) else 0 end;
      v_restored:=round(v_unit_cost*p_quantity,2);
      if v_restored<=0 then
        raise exception 'Bicycle return cannot be restocked without governed dispatch COGS evidence.';
      end if;
      perform post_vyndi_finance_journal(
        'FIN-CUST-RET-COGS-'||upper(trim(p_id)),p_returned_on,'customer_return_cogs',upper(trim(p_id)),
        'Finished-goods COGS reversal for customer return '||upper(trim(p_id)),
        jsonb_build_array(
          jsonb_build_object('accountCode','1220','debitInr',v_restored,'memo','Returned finished product restored'),
          jsonb_build_object('accountCode','5000','creditInr',v_restored,'memo','Reverse returned finished-product COGS')
        )
      );
    end if;
  end if;

  insert into vyndi_customer_returns(
    id,invoice_id,plan_month,returned_on,quantity,disposition,reason,source_reference,sale_type,
    identity_uid,inventory_movement_id,inventory_ledger_id,restored_cogs_inr,created_by)
  values(
    upper(trim(p_id)),i.id,p_plan_month,p_returned_on,p_quantity,p_disposition,trim(p_reason),
    trim(p_source_reference),i.sale_type,v_identity,v_movement,v_ledger,v_restored,p_actor_user_id
  );

  insert into vyndi_audit_events(
    id,entity_type,entity_id,action,actor_user_id,actor_role,source_reference,payload_json)
  values(
    'AUD-CUST-RET-'||upper(trim(p_id)),'customer_return',upper(trim(p_id)),'received',
    p_actor_user_id,p_actor_role,trim(p_source_reference),
    jsonb_build_object('invoiceId',i.id,'saleType',i.sale_type,'returnPlanMonth',p_plan_month,
      'quantity',p_quantity,'disposition',p_disposition,'identityUid',v_identity,
      'inventoryMovementId',v_movement,'restoredCogsInr',v_restored,'reason',trim(p_reason))
  );

  return query select upper(trim(p_id)),v_restored;
end;
$$;

create or replace function issue_vyndi_customer_credit_note(
  p_id text,
  p_customer_return_id text,
  p_credit_on date,
  p_source_reference text,
  p_actor_user_id text,
  p_actor_role text
) returns table(credit_note_id text,gross_amount_inr numeric,refund_due_inr numeric)
language plpgsql
as $$
declare
  r vyndi_customer_returns%rowtype;
  i vyndi_invoices%rowtype;
  v_ratio numeric;
  v_taxable numeric;
  v_gst numeric;
  v_gross numeric;
  v_cgst numeric;
  v_sgst numeric;
  v_igst numeric;
  v_cess numeric;
  v_prior_taxable numeric;
  v_prior_gst numeric;
  v_prior_gross numeric;
  v_journal text;
  v_collected numeric;
  v_refunded numeric;
  v_total_credits numeric;
  v_invoice_gross numeric;
  v_refund_due numeric;
begin
  if trim(coalesce(p_source_reference,''))='' then raise exception 'Customer credit-note evidence reference is required.'; end if;
  perform pg_advisory_xact_lock(hashtext('customer-credit-note|'||p_customer_return_id)::bigint);

  if exists(select 1 from vyndi_customer_credit_notes where id=upper(trim(p_id))) then
    return query
      select c.id,c.gross_amount_inr,
        greatest(coalesce((select sum(x.amount_lakh)*100000 from vyndi_collections x where x.invoice_id=c.invoice_id and x.status='posted'),0)
          -coalesce((select sum(f.amount_inr) from vyndi_customer_refunds f join vyndi_customer_credit_notes cn on cn.id=f.credit_note_id where cn.invoice_id=c.invoice_id and f.status='posted'),0)
          -(coalesce((select gross_amount_inr from vyndi_invoices where id=c.invoice_id),0)
            -coalesce((select sum(c2.gross_amount_inr) from vyndi_customer_credit_notes c2 where c2.invoice_id=c.invoice_id and c2.status='active'),0)),0)
      from vyndi_customer_credit_notes c where c.id=upper(trim(p_id));
    return;
  end if;
  if exists(select 1 from vyndi_customer_credit_notes where source_reference=trim(p_source_reference)) then
    raise exception 'Customer credit-note evidence reference has already been used.';
  end if;

  select * into r from vyndi_customer_returns where id=p_customer_return_id for update;
  if not found then raise exception 'Customer return / RMA not found.'; end if;
  if exists(select 1 from vyndi_customer_credit_notes where customer_return_id=r.id) then
    raise exception 'Customer return / RMA already has a credit note.';
  end if;
  select * into i from vyndi_invoices where id=r.invoice_id and status='issued';
  if not found then raise exception 'Issued invoice not found for customer credit note.'; end if;

  v_ratio:=r.quantity/i.units;
  v_taxable:=round(i.taxable_value_inr*v_ratio,2);
  v_gst:=round(i.gst_inr*v_ratio,2);
  v_gross:=round(v_taxable+v_gst,2);
  v_cgst:=round(i.cgst_inr*v_ratio,2);
  v_sgst:=round(i.sgst_inr*v_ratio,2);
  v_igst:=round(i.igst_inr*v_ratio,2);
  v_cess:=round(i.cess_inr*v_ratio,2);

  select coalesce(sum(cn.taxable_value_inr),0),coalesce(sum(cn.gst_inr),0),coalesce(sum(cn.gross_amount_inr),0)
    into v_prior_taxable,v_prior_gst,v_prior_gross
    from vyndi_customer_credit_notes cn where cn.invoice_id=i.id and cn.status='active';
  if v_prior_taxable+v_taxable>i.taxable_value_inr+0.01
     or v_prior_gst+v_gst>i.gst_inr+0.01
     or v_prior_gross+v_gross>i.gross_amount_inr+0.01 then
    raise exception 'Customer credit notes cannot exceed the original controlled invoice values.';
  end if;

  v_journal:=post_vyndi_finance_journal(
    'FIN-CN-'||upper(trim(p_id)),p_credit_on,'customer_credit_note',upper(trim(p_id)),
    'Customer credit note '||upper(trim(p_id))||' for invoice '||i.id,
    case when v_gst>0 then
      jsonb_build_array(
        jsonb_build_object('accountCode','4000','debitInr',v_taxable,'memo','Sales return / credit note'),
        jsonb_build_object('accountCode','2100','debitInr',v_gst,'memo','Reverse output GST on credit note'),
        jsonb_build_object('accountCode','1100','creditInr',v_gross,'memo','Reduce customer receivable')
      )
    else
      jsonb_build_array(
        jsonb_build_object('accountCode','4000','debitInr',v_taxable,'memo','Sales return / credit note'),
        jsonb_build_object('accountCode','1100','creditInr',v_gross,'memo','Reduce customer receivable')
      )
    end
  );

  insert into vyndi_customer_credit_notes(
    id,customer_return_id,invoice_id,plan_month,credit_on,quantity,taxable_value_inr,gst_inr,
    gross_amount_inr,source_reference,journal_id,created_by)
  values(
    upper(trim(p_id)),r.id,i.id,r.plan_month,p_credit_on,r.quantity,v_taxable,v_gst,v_gross,
    trim(p_source_reference),v_journal,p_actor_user_id
  );

  -- Signed output document: the original invoice GST evidence remains intact; this note nets it.
  insert into epr_finance_gst_ledger(
    id,period,direction,source_type,source_id,taxable_value_inr,gst_inr,eligible_itc,evidence_reference,
    document_date,document_number,counterparty_gstin,place_of_supply_code,hsn_sac,tax_rate_pct,
    cgst_inr,sgst_inr,igst_inr,cess_inr,irn,status,tax_treatment)
  values(
    'GST-CN-'||upper(trim(p_id)),to_char(p_credit_on,'YYYY-MM'),'output','customer_credit_note',upper(trim(p_id)),
    -v_taxable,-v_gst,null,trim(p_source_reference),p_credit_on,upper(trim(p_id)),i.recipient_gstin,
    i.place_of_supply_code,i.hsn_sac,i.tax_rate_pct,-v_cgst,-v_sgst,-v_igst,-v_cess,null,'active',i.tax_mode
  );

  select coalesce(sum(amount_lakh)*100000,0) into v_collected
    from vyndi_collections where invoice_id=i.id and status='posted';
  select coalesce(sum(f.amount_inr),0) into v_refunded
    from vyndi_customer_refunds f
    join vyndi_customer_credit_notes c on c.id=f.credit_note_id
   where c.invoice_id=i.id and f.status='posted';
  select coalesce(sum(cn.gross_amount_inr),0) into v_total_credits
    from vyndi_customer_credit_notes cn where cn.invoice_id=i.id and cn.status='active';
  v_invoice_gross:=case when i.gross_amount_inr>0 then i.gross_amount_inr else i.amount_lakh*100000 end;
  v_refund_due:=greatest(v_collected-v_refunded-(v_invoice_gross-v_total_credits),0);

  insert into vyndi_audit_events(
    id,entity_type,entity_id,action,actor_user_id,actor_role,source_reference,payload_json)
  values(
    'AUD-CN-'||upper(trim(p_id)),'customer_credit_note',upper(trim(p_id)),'issued',
    p_actor_user_id,p_actor_role,trim(p_source_reference),
    jsonb_build_object('customerReturnId',r.id,'invoiceId',i.id,'creditPlanMonth',r.plan_month,
      'taxableValueInr',v_taxable,'gstInr',v_gst,'grossAmountInr',v_gross,'journalId',v_journal,
      'refundDueInr',v_refund_due)
  );

  return query select upper(trim(p_id)),v_gross,v_refund_due;
end;
$$;

create or replace function post_vyndi_customer_refund(
  p_id text,
  p_credit_note_id text,
  p_plan_month integer,
  p_refunded_on date,
  p_amount_inr numeric,
  p_evidence_reference text,
  p_actor_user_id text,
  p_actor_role text
) returns table(refund_id text,journal_id text,new_closing_cash_lakh numeric,actual_revision integer)
language plpgsql
as $$
declare
  c vyndi_customer_credit_notes%rowtype;
  i vyndi_invoices%rowtype;
  v_collected numeric;
  v_all_refunded numeric;
  v_note_refunded numeric;
  v_credits numeric;
  v_invoice_gross numeric;
  v_refundable numeric;
  v_note_open numeric;
  v_journal text;
  v_cash numeric;
  v_revision integer;
begin
  if p_plan_month not between 1 and 36 then raise exception 'Customer refund cash plan month must be between 1 and 36.'; end if;
  if coalesce(p_amount_inr,0)<=0 then raise exception 'Customer refund amount must be positive.'; end if;
  if trim(coalesce(p_evidence_reference,''))='' then raise exception 'Customer refund bank evidence reference is required.'; end if;

  perform pg_advisory_xact_lock(hashtext('customer-refund|'||p_credit_note_id)::bigint);
  if exists(select 1 from vyndi_customer_refunds where id=upper(trim(p_id))) then
    return query select r.id,r.journal_id,r.new_closing_cash_lakh,r.cash_actual_revision
      from vyndi_customer_refunds r where r.id=upper(trim(p_id)) and r.status='posted';
    if found then return; end if;
    raise exception 'Customer refund id already exists with different state.';
  end if;
  if exists(select 1 from vyndi_customer_refunds where evidence_reference=trim(p_evidence_reference)) then
    raise exception 'Customer refund bank evidence reference has already been used.';
  end if;

  select * into c from vyndi_customer_credit_notes where id=p_credit_note_id and status='active';
  if not found then raise exception 'Active customer credit note not found.'; end if;
  select * into i from vyndi_invoices where id=c.invoice_id and status='issued';
  if not found then raise exception 'Issued invoice not found for customer refund.'; end if;

  select coalesce(sum(amount_lakh)*100000,0) into v_collected
    from vyndi_collections where invoice_id=i.id and status='posted';
  select coalesce(sum(r.amount_inr),0) into v_all_refunded
    from vyndi_customer_refunds r
    join vyndi_customer_credit_notes cn on cn.id=r.credit_note_id
   where cn.invoice_id=i.id and r.status='posted';
  select coalesce(sum(amount_inr),0) into v_note_refunded
    from vyndi_customer_refunds where credit_note_id=c.id and status='posted';
  select coalesce(sum(gross_amount_inr),0) into v_credits
    from vyndi_customer_credit_notes where invoice_id=i.id and status='active';

  v_invoice_gross:=case when i.gross_amount_inr>0 then i.gross_amount_inr else i.amount_lakh*100000 end;
  v_refundable:=greatest(v_collected-v_all_refunded-(v_invoice_gross-v_credits),0);
  v_note_open:=greatest(c.gross_amount_inr-v_note_refunded,0);
  if round(p_amount_inr,2)>least(v_refundable,v_note_open)+0.01 then
    raise exception 'Customer refund exceeds the evidenced refundable amount. Invoice refundable %, credit-note open %.',v_refundable,v_note_open;
  end if;

  v_journal:=post_vyndi_finance_journal(
    'FIN-CUST-REFUND-'||upper(trim(p_id)),p_refunded_on,'customer_refund',upper(trim(p_id)),
    'Customer refund '||upper(trim(p_id))||' against credit note '||c.id,
    jsonb_build_array(
      jsonb_build_object('accountCode','1100','debitInr',round(p_amount_inr,2),'memo','Settle customer credit balance'),
      jsonb_build_object('accountCode','1000','creditInr',round(p_amount_inr,2),'memo','Bank refund · '||trim(p_evidence_reference))
    )
  );

  select x.new_closing_cash_lakh,x.actual_revision into v_cash,v_revision
    from apply_vyndi_verified_cash_movement(
      p_plan_month,-round(p_amount_inr,2)/100000.0,
      'customer-refund:'||upper(trim(p_id))||'; '||trim(p_evidence_reference),
      p_actor_user_id,p_actor_role
    ) x;

  insert into vyndi_customer_refunds(
    id,credit_note_id,plan_month,refunded_on,amount_inr,evidence_reference,journal_id,
    cash_actual_revision,new_closing_cash_lakh,created_by)
  values(
    upper(trim(p_id)),c.id,p_plan_month,p_refunded_on,round(p_amount_inr,2),trim(p_evidence_reference),
    v_journal,v_revision,v_cash,p_actor_user_id
  );

  insert into vyndi_audit_events(
    id,entity_type,entity_id,action,actor_user_id,actor_role,source_reference,payload_json)
  values(
    'AUD-CUST-REFUND-'||upper(trim(p_id)),'customer_refund',upper(trim(p_id)),'posted',
    p_actor_user_id,p_actor_role,trim(p_evidence_reference),
    jsonb_build_object('creditNoteId',c.id,'invoiceId',i.id,'paymentPlanMonth',p_plan_month,
      'amountInr',round(p_amount_inr,2),'journalId',v_journal,'newClosingCashLakh',v_cash,
      'actualRevision',v_revision)
  );

  return query select upper(trim(p_id)),v_journal,v_cash,v_revision;
end;
$$;

create or replace function reverse_vyndi_customer_refund(
  p_id text,
  p_reversed_on date,
  p_reason text,
  p_actor_user_id text,
  p_actor_role text
) returns integer
language plpgsql
as $$
declare
  r vyndi_customer_refunds%rowtype;
  v_revision integer;
  v_cash numeric;
  v_cash_revision integer;
begin
  if trim(coalesce(p_reason,''))='' then raise exception 'Customer refund reversal evidence / reason is required.'; end if;
  perform pg_advisory_xact_lock(hashtext('customer-refund|'||upper(trim(p_id)))::bigint);
  select * into r from vyndi_customer_refunds where id=upper(trim(p_id)) for update;
  if not found then raise exception 'Customer refund not found.'; end if;
  if r.status='reversed' then return r.revision; end if;
  if r.created_by=p_actor_user_id then raise exception 'Customer refund reversal requires a different authorised user.'; end if;

  perform reverse_vyndi_finance_journal(
    'customer_refund',r.id,'FIN-CUST-REFUND-REV-'||r.id,'customer_refund_reversal',
    p_reversed_on,'Customer refund reversal '||r.id||' · '||trim(p_reason)
  );

  select x.new_closing_cash_lakh,x.actual_revision into v_cash,v_cash_revision
    from apply_vyndi_verified_cash_movement(
      r.plan_month,r.amount_inr/100000.0,
      'customer-refund-reversal:'||r.id||'; '||trim(p_reason),
      p_actor_user_id,p_actor_role
    ) x;

  update vyndi_customer_refunds set
    status='reversed',revision=revision+1,reversed_by=p_actor_user_id,reversed_at=now(),
    reversal_reason=trim(p_reason),cash_reversal_revision=v_cash_revision,reversed_closing_cash_lakh=v_cash
  where id=r.id returning revision into v_revision;

  insert into vyndi_audit_events(
    id,entity_type,entity_id,action,actor_user_id,actor_role,source_reference,payload_json)
  values(
    'AUD-CUST-REFUND-'||r.id||'-R'||v_revision,'customer_refund',r.id,'reversed',
    p_actor_user_id,p_actor_role,trim(p_reason),
    jsonb_build_object('amountInr',r.amount_inr,'paymentPlanMonth',r.plan_month,
      'newClosingCashLakh',v_cash,'actualRevision',v_cash_revision)
  );
  return v_revision;
end;
$$;

-- Collection ceiling is the current gross receivable after active credit notes.
create or replace function post_vyndi_collection(
  p_id text,p_invoice_id text,p_plan_month integer,p_amount_lakh numeric,p_source_reference text,
  p_actor_user_id text,p_actor_role text
) returns text
language plpgsql
as $$
declare
  v_invoice_gross numeric;
  v_credit_lakh numeric;
  v_collected numeric;
  v_cash numeric;
  v_revision integer;
begin
  if p_plan_month not between 1 and 36 then raise exception 'Collection cash plan month must be between 1 and 36.'; end if;
  if trim(coalesce(p_source_reference,''))='' then raise exception 'Collection source reference is required.'; end if;
  perform pg_advisory_xact_lock(hashtext('collection|'||p_id)::bigint);
  if exists(select 1 from vyndi_collections where id=p_id) then
    if exists(select 1 from vyndi_collections where id=p_id and invoice_id=p_invoice_id and plan_month=p_plan_month and amount_lakh=p_amount_lakh and status='posted') then return p_id; end if;
    raise exception 'Collection id already exists with different state.';
  end if;
  if exists(select 1 from vyndi_collections where trim(source_reference)=trim(p_source_reference)) then
    raise exception 'Collection bank evidence/reference has already been used.';
  end if;

  select (case when gross_amount_inr>0 then gross_amount_inr else amount_lakh*100000 end)/100000.0
    into v_invoice_gross from vyndi_invoices where id=p_invoice_id and status='issued';
  if not found then raise exception 'Issued invoice not found.'; end if;
  select coalesce(sum(gross_amount_inr),0)/100000.0 into v_credit_lakh
    from vyndi_customer_credit_notes where invoice_id=p_invoice_id and status='active';
  select coalesce(sum(amount_lakh),0) into v_collected
    from vyndi_collections where invoice_id=p_invoice_id and status='posted';

  if p_amount_lakh<=0 or v_collected+p_amount_lakh>greatest(v_invoice_gross-v_credit_lakh,0)+0.000001 then
    raise exception 'Collection exceeds open gross invoice receivable after customer credit notes.';
  end if;

  insert into vyndi_collections(id,invoice_id,plan_month,amount_lakh,source_reference,posted_by)
  values(p_id,p_invoice_id,p_plan_month,p_amount_lakh,trim(p_source_reference),p_actor_user_id);

  select x.new_closing_cash_lakh,x.actual_revision into v_cash,v_revision
    from apply_vyndi_verified_cash_movement(
      p_plan_month,p_amount_lakh,'customer-collection:'||p_id||'; '||trim(p_source_reference),
      p_actor_user_id,p_actor_role
    ) x;
  update vyndi_collections set cash_actual_revision=v_revision,new_closing_cash_lakh=v_cash where id=p_id;

  insert into vyndi_audit_events(id,entity_type,entity_id,entity_revision,action,actor_user_id,actor_role,source_reference,payload_json)
  values(
    'AUD-COL-'||p_id||'-R1','collection',p_id,1,'posted',p_actor_user_id,p_actor_role,trim(p_source_reference),
    jsonb_build_object('collectionId',p_id,'invoiceId',p_invoice_id,'cashPlanMonth',p_plan_month,
      'amountLakh',p_amount_lakh,'newClosingCashLakh',v_cash,'actualRevision',v_revision)
  );
  return p_id;
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
  if trim(coalesce(p_reason,''))='' then raise exception 'Collection reversal reason is required.'; end if;
  perform pg_advisory_xact_lock(hashtext('collection|'||p_id)::bigint);
  select * into v_row from vyndi_collections where id=p_id for update;
  if not found then raise exception 'Posted collection not found.'; end if;
  if v_row.status='reversed' then return v_row.revision; end if;
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

-- ---------------------------------------------------------------------------
-- Supplier returns / debit notes / supplier refunds
-- ---------------------------------------------------------------------------
create table if not exists vyndi_supplier_returns (
  id text primary key,
  supplier_invoice_id text not null references vyndi_supplier_invoices(id) on delete restrict,
  goods_receipt_id text not null references vyndi_goods_receipts(id) on delete restrict,
  plan_month integer not null check (plan_month between 1 and 36),
  returned_on date not null,
  quantity numeric(14,4) not null check (quantity>0),
  sku text not null,
  unit text not null,
  fifo_cost_inr numeric(18,2) not null check (fifo_cost_inr>=0),
  taxable_value_inr numeric(18,2) not null check (taxable_value_inr>=0),
  gst_inr numeric(18,2) not null check (gst_inr>=0),
  gross_amount_inr numeric(18,2) not null check (gross_amount_inr>0),
  ap_offset_inr numeric(18,2) not null check (ap_offset_inr>=0),
  recoverable_inr numeric(18,2) not null check (recoverable_inr>=0),
  debit_note_reference text not null unique,
  source_reference text not null unique,
  inventory_movement_id text not null unique references epr_inventory_movements(id) on delete restrict,
  inventory_ledger_id text not null unique references epr_inventory_ledger(id) on delete restrict,
  journal_id text not null unique references epr_finance_journals(id) on delete restrict,
  status text not null default 'posted' check (status in ('posted')),
  created_by text not null,
  created_at timestamptz not null default now()
);
create index if not exists vyndi_supplier_returns_invoice_idx
  on vyndi_supplier_returns(supplier_invoice_id,goods_receipt_id,plan_month,returned_on);

create table if not exists vyndi_supplier_refunds (
  id text primary key,
  supplier_return_id text not null references vyndi_supplier_returns(id) on delete restrict,
  plan_month integer not null check (plan_month between 1 and 36),
  received_on date not null,
  amount_inr numeric(18,2) not null check (amount_inr>0),
  evidence_reference text not null unique,
  journal_id text not null unique references epr_finance_journals(id) on delete restrict,
  cash_actual_revision integer not null check (cash_actual_revision>0),
  new_closing_cash_lakh numeric(18,4) not null,
  status text not null default 'posted' check (status in ('posted','reversed')),
  revision integer not null default 1 check (revision>0),
  created_by text not null,
  created_at timestamptz not null default now(),
  reversed_by text,
  reversed_at timestamptz,
  reversal_reason text,
  cash_reversal_revision integer,
  reversed_closing_cash_lakh numeric(18,4)
);
create index if not exists vyndi_supplier_refunds_return_idx
  on vyndi_supplier_refunds(supplier_return_id,status,plan_month,received_on);

create or replace function post_vyndi_supplier_return_debit_note(
  p_id text,
  p_supplier_invoice_id text,
  p_goods_receipt_id text,
  p_plan_month integer,
  p_returned_on date,
  p_quantity numeric,
  p_debit_note_reference text,
  p_source_reference text,
  p_actor_user_id text,
  p_actor_role text
) returns table(
  supplier_return_id text,
  gross_amount_inr numeric,
  ap_offset_inr numeric,
  recoverable_inr numeric,
  fifo_cost_inr numeric
)
language plpgsql
as $$
declare
  i vyndi_supplier_invoices%rowtype;
  r vyndi_goods_receipts%rowtype;
  p vyndi_purchase_orders%rowtype;
  v_prior_qty numeric;
  v_prior_credit numeric;
  v_paid numeric;
  v_open_ap numeric;
  v_taxable numeric;
  v_gst numeric;
  v_gross numeric;
  v_ap numeric;
  v_recoverable numeric;
  v_movement text:='SUP-RET-ISS-'||upper(trim(p_id));
  v_ledger text:='SUP-RET-LED-'||upper(trim(p_id));
  v_fifo numeric;
  v_lines jsonb:='[]'::jsonb;
  v_journal text;
  v_eligible boolean;
  v_cgst numeric;
  v_sgst numeric;
  v_igst numeric;
  v_cess numeric;
  v_net_invoice numeric;
  v_status text;
begin
  if p_plan_month not between 1 and 36 then raise exception 'Supplier return plan month must be between 1 and 36.'; end if;
  if coalesce(p_quantity,0)<=0 then raise exception 'Supplier return quantity must be positive.'; end if;
  if trim(coalesce(p_debit_note_reference,''))='' then raise exception 'Supplier debit-note reference is required.'; end if;
  if trim(coalesce(p_source_reference,''))='' then raise exception 'Supplier return evidence reference is required.'; end if;

  perform pg_advisory_xact_lock(hashtext('supplier-return|'||p_supplier_invoice_id)::bigint);
  if exists(select 1 from vyndi_supplier_returns where id=upper(trim(p_id))) then
    return query select x.id,x.gross_amount_inr,x.ap_offset_inr,x.recoverable_inr,x.fifo_cost_inr
      from vyndi_supplier_returns x where x.id=upper(trim(p_id));
    return;
  end if;

  select * into i from vyndi_supplier_invoices where id=p_supplier_invoice_id for update;
  if not found or i.status not in ('approved','part_paid','paid') then
    raise exception 'Supplier return requires an approved/paid supplier invoice.';
  end if;
  select * into r from vyndi_goods_receipts where id=p_goods_receipt_id for update;
  if not found or r.purchase_order_id<>i.purchase_order_id or r.quantity_accepted<=0 then
    raise exception 'Supplier return GRN must be an accepted receipt on the same purchase order as the supplier invoice.';
  end if;
  if r.inventory_movement_id is null then raise exception 'Supplier return GRN has no accepted inventory movement.'; end if;
  select * into p from vyndi_purchase_orders where id=i.purchase_order_id;
  if not found then raise exception 'Supplier return purchase order not found.'; end if;

  select coalesce(sum(quantity),0) into v_prior_qty
    from vyndi_supplier_returns where goods_receipt_id=r.id and status='posted';
  if v_prior_qty+p_quantity>r.quantity_accepted+0.0001 then
    raise exception 'Supplier return quantity exceeds accepted GRN quantity remaining.';
  end if;
  if v_prior_qty+p_quantity>i.quantity_invoiced+0.0001 then
    raise exception 'Supplier return quantity exceeds quantity covered by the linked supplier invoice.';
  end if;

  select x.fifo_value_inr into v_fifo
    from post_vyndi_inventory_issue(
      v_movement,v_ledger,p.sku,p_quantity,p.unit,p_returned_on,
      trim(p_source_reference),'Return to supplier · debit note '||trim(p_debit_note_reference),
      p_actor_user_id,p_actor_role
    ) x;

  -- Fail closed if FIFO would return stock from any receipt other than the selected GRN.
  if exists(
    select 1
      from epr_inventory_fifo_allocations a
      join epr_inventory_fifo_layers fl on fl.id=a.layer_id
      join epr_inventory_ledger source_ledger on source_ledger.id=fl.source_ledger_id
     where a.issue_ledger_id=v_ledger and source_ledger.movement_id<>r.inventory_movement_id
  ) then
    raise exception 'Supplier return is blocked because FIFO allocation does not belong exclusively to the selected GRN.';
  end if;

  v_taxable:=round(p_quantity*p.unit_price_inr,2);
  if abs(v_fifo-v_taxable)>0.01 then
    raise exception 'Supplier return FIFO cost % does not reconcile to controlled PO/debit-note value %.',v_fifo,v_taxable;
  end if;
  v_gst:=case when i.quantity_invoiced>0 then round(i.gst_inr*(p_quantity/i.quantity_invoiced),2) else 0 end;
  v_gross:=round(v_taxable+v_gst,2);
  v_cgst:=case when i.quantity_invoiced>0 then round(i.cgst_inr*(p_quantity/i.quantity_invoiced),2) else 0 end;
  v_sgst:=case when i.quantity_invoiced>0 then round(i.sgst_inr*(p_quantity/i.quantity_invoiced),2) else 0 end;
  v_igst:=case when i.quantity_invoiced>0 then round(i.igst_inr*(p_quantity/i.quantity_invoiced),2) else 0 end;
  v_cess:=case when i.quantity_invoiced>0 then round(i.cess_inr*(p_quantity/i.quantity_invoiced),2) else 0 end;

  select coalesce(sum(sr.gross_amount_inr),0) into v_prior_credit
    from vyndi_supplier_returns sr where sr.supplier_invoice_id=i.id and sr.status='posted';
  if v_prior_credit+v_gross>i.amount_ex_gst_inr+i.gst_inr+0.01 then
    raise exception 'Supplier debit notes cannot exceed the original supplier invoice gross amount.';
  end if;
  select coalesce(sum(amount_inr),0) into v_paid
    from vyndi_supplier_payments where supplier_invoice_id=i.id and status='posted';
  v_open_ap:=greatest(round(i.amount_ex_gst_inr+i.gst_inr-v_prior_credit-v_paid,2),0);
  v_ap:=least(v_open_ap,v_gross);
  v_recoverable:=round(v_gross-v_ap,2);
  v_eligible:=i.gst_inr>0 and i.itc_control_status='verified' and i.itc_eligible is true;

  if v_ap>0 then
    v_lines:=v_lines||jsonb_build_array(jsonb_build_object('accountCode','2000','debitInr',v_ap,'memo','Reduce trade payable by supplier debit note'));
  end if;
  if v_recoverable>0 then
    v_lines:=v_lines||jsonb_build_array(jsonb_build_object('accountCode','1400','debitInr',v_recoverable,'memo','Supplier recoverable / refund due'));
  end if;
  if v_eligible then
    v_lines:=v_lines||jsonb_build_array(
      jsonb_build_object('accountCode','1200','creditInr',v_taxable,'memo','Inventory returned to supplier'),
      jsonb_build_object('accountCode','1300','creditInr',v_gst,'memo','Reverse eligible input GST / ITC')
    );
  else
    v_lines:=v_lines||jsonb_build_array(
      jsonb_build_object('accountCode','1200','creditInr',v_gross,'memo','Inventory return including non-creditable GST')
    );
  end if;

  v_journal:=post_vyndi_finance_journal(
    'FIN-SUP-RET-'||upper(trim(p_id)),p_returned_on,'supplier_return_debit_note',upper(trim(p_id)),
    'Supplier return / debit note '||trim(p_debit_note_reference),v_lines
  );

  insert into vyndi_supplier_returns(
    id,supplier_invoice_id,goods_receipt_id,plan_month,returned_on,quantity,sku,unit,fifo_cost_inr,
    taxable_value_inr,gst_inr,gross_amount_inr,ap_offset_inr,recoverable_inr,debit_note_reference,
    source_reference,inventory_movement_id,inventory_ledger_id,journal_id,created_by)
  values(
    upper(trim(p_id)),i.id,r.id,p_plan_month,p_returned_on,p_quantity,p.sku,vyndi_canonical_unit(p.unit),v_fifo,
    v_taxable,v_gst,v_gross,v_ap,v_recoverable,trim(p_debit_note_reference),trim(p_source_reference),
    v_movement,v_ledger,v_journal,p_actor_user_id
  );

  insert into epr_finance_gst_ledger(
    id,period,direction,source_type,source_id,taxable_value_inr,gst_inr,eligible_itc,evidence_reference,
    document_date,document_number,counterparty_gstin,hsn_sac,tax_rate_pct,cgst_inr,sgst_inr,igst_inr,cess_inr,status)
  values(
    'GST-SUP-RET-'||upper(trim(p_id)),to_char(p_returned_on,'YYYY-MM'),'input','supplier_debit_note',upper(trim(p_id)),
    -v_taxable,-v_gst,case when v_eligible then true else false end,trim(p_source_reference),
    p_returned_on,trim(p_debit_note_reference),i.supplier_gstin,i.hsn_sac,i.tax_rate_pct,
    -v_cgst,-v_sgst,-v_igst,-v_cess,'active'
  );

  v_net_invoice:=greatest(round(i.amount_ex_gst_inr+i.gst_inr-(v_prior_credit+v_gross),2),0);
  v_status:=case when v_net_invoice<=0.01 or v_paid>=v_net_invoice-0.01 then 'paid'
                 when v_paid>0 then 'part_paid' else 'approved' end;
  update vyndi_supplier_invoices set status=v_status,updated_at=now() where id=i.id;

  insert into vyndi_audit_events(
    id,entity_type,entity_id,action,actor_user_id,actor_role,source_reference,payload_json)
  values(
    'AUD-SUP-RET-'||upper(trim(p_id)),'supplier_return',upper(trim(p_id)),'posted',
    p_actor_user_id,p_actor_role,trim(p_source_reference),
    jsonb_build_object('supplierInvoiceId',i.id,'goodsReceiptId',r.id,'returnPlanMonth',p_plan_month,
      'quantity',p_quantity,'sku',p.sku,'fifoCostInr',v_fifo,'taxableValueInr',v_taxable,'gstInr',v_gst,
      'grossAmountInr',v_gross,'apOffsetInr',v_ap,'recoverableInr',v_recoverable,'journalId',v_journal)
  );

  return query select upper(trim(p_id)),v_gross,v_ap,v_recoverable,v_fifo;
end;
$$;

create or replace function post_vyndi_supplier_refund(
  p_id text,
  p_supplier_return_id text,
  p_plan_month integer,
  p_received_on date,
  p_amount_inr numeric,
  p_evidence_reference text,
  p_actor_user_id text,
  p_actor_role text
) returns table(refund_id text,journal_id text,new_closing_cash_lakh numeric,actual_revision integer)
language plpgsql
as $$
declare
  r vyndi_supplier_returns%rowtype;
  v_refunded numeric;
  v_open numeric;
  v_journal text;
  v_cash numeric;
  v_revision integer;
begin
  if p_plan_month not between 1 and 36 then raise exception 'Supplier refund cash plan month must be between 1 and 36.'; end if;
  if coalesce(p_amount_inr,0)<=0 then raise exception 'Supplier refund amount must be positive.'; end if;
  if trim(coalesce(p_evidence_reference,''))='' then raise exception 'Supplier refund bank evidence reference is required.'; end if;

  perform pg_advisory_xact_lock(hashtext('supplier-refund|'||p_supplier_return_id)::bigint);
  if exists(select 1 from vyndi_supplier_refunds where id=upper(trim(p_id))) then
    return query select f.id,f.journal_id,f.new_closing_cash_lakh,f.cash_actual_revision
      from vyndi_supplier_refunds f where f.id=upper(trim(p_id)) and f.status='posted';
    if found then return; end if;
    raise exception 'Supplier refund id already exists with different state.';
  end if;
  if exists(select 1 from vyndi_supplier_refunds where evidence_reference=trim(p_evidence_reference)) then
    raise exception 'Supplier refund bank evidence reference has already been used.';
  end if;

  select * into r from vyndi_supplier_returns where id=p_supplier_return_id and status='posted';
  if not found then raise exception 'Posted supplier return / debit note not found.'; end if;
  if r.recoverable_inr<=0 then raise exception 'Supplier debit note has no recoverable cash balance; it only offsets Accounts Payable.'; end if;
  select coalesce(sum(amount_inr),0) into v_refunded
    from vyndi_supplier_refunds where supplier_return_id=r.id and status='posted';
  v_open:=greatest(r.recoverable_inr-v_refunded,0);
  if round(p_amount_inr,2)>v_open+0.01 then
    raise exception 'Supplier refund exceeds open recoverable amount %.',v_open;
  end if;

  v_journal:=post_vyndi_finance_journal(
    'FIN-SUP-REFUND-'||upper(trim(p_id)),p_received_on,'supplier_refund',upper(trim(p_id)),
    'Supplier refund '||upper(trim(p_id))||' against debit note '||r.debit_note_reference,
    jsonb_build_array(
      jsonb_build_object('accountCode','1000','debitInr',round(p_amount_inr,2),'memo','Supplier refund received'),
      jsonb_build_object('accountCode','1400','creditInr',round(p_amount_inr,2),'memo','Settle supplier recoverable')
    )
  );

  select x.new_closing_cash_lakh,x.actual_revision into v_cash,v_revision
    from apply_vyndi_verified_cash_movement(
      p_plan_month,round(p_amount_inr,2)/100000.0,
      'supplier-refund:'||upper(trim(p_id))||'; '||trim(p_evidence_reference),
      p_actor_user_id,p_actor_role
    ) x;

  insert into vyndi_supplier_refunds(
    id,supplier_return_id,plan_month,received_on,amount_inr,evidence_reference,journal_id,
    cash_actual_revision,new_closing_cash_lakh,created_by)
  values(
    upper(trim(p_id)),r.id,p_plan_month,p_received_on,round(p_amount_inr,2),trim(p_evidence_reference),
    v_journal,v_revision,v_cash,p_actor_user_id
  );

  insert into vyndi_audit_events(
    id,entity_type,entity_id,action,actor_user_id,actor_role,source_reference,payload_json)
  values(
    'AUD-SUP-REFUND-'||upper(trim(p_id)),'supplier_refund',upper(trim(p_id)),'posted',
    p_actor_user_id,p_actor_role,trim(p_evidence_reference),
    jsonb_build_object('supplierReturnId',r.id,'paymentPlanMonth',p_plan_month,'amountInr',round(p_amount_inr,2),
      'journalId',v_journal,'newClosingCashLakh',v_cash,'actualRevision',v_revision)
  );

  return query select upper(trim(p_id)),v_journal,v_cash,v_revision;
end;
$$;

create or replace function reverse_vyndi_supplier_refund(
  p_id text,
  p_reversed_on date,
  p_reason text,
  p_actor_user_id text,
  p_actor_role text
) returns integer
language plpgsql
as $$
declare
  r vyndi_supplier_refunds%rowtype;
  v_revision integer;
  v_cash numeric;
  v_cash_revision integer;
begin
  if trim(coalesce(p_reason,''))='' then raise exception 'Supplier refund reversal evidence / reason is required.'; end if;
  perform pg_advisory_xact_lock(hashtext('supplier-refund|'||upper(trim(p_id)))::bigint);
  select * into r from vyndi_supplier_refunds where id=upper(trim(p_id)) for update;
  if not found then raise exception 'Supplier refund not found.'; end if;
  if r.status='reversed' then return r.revision; end if;
  if r.created_by=p_actor_user_id then raise exception 'Supplier refund reversal requires a different authorised user.'; end if;

  perform reverse_vyndi_finance_journal(
    'supplier_refund',r.id,'FIN-SUP-REFUND-REV-'||r.id,'supplier_refund_reversal',
    p_reversed_on,'Supplier refund reversal '||r.id||' · '||trim(p_reason)
  );

  select x.new_closing_cash_lakh,x.actual_revision into v_cash,v_cash_revision
    from apply_vyndi_verified_cash_movement(
      r.plan_month,-r.amount_inr/100000.0,
      'supplier-refund-reversal:'||r.id||'; '||trim(p_reason),p_actor_user_id,p_actor_role
    ) x;

  update vyndi_supplier_refunds set
    status='reversed',revision=revision+1,reversed_by=p_actor_user_id,reversed_at=now(),
    reversal_reason=trim(p_reason),cash_reversal_revision=v_cash_revision,reversed_closing_cash_lakh=v_cash
  where id=r.id returning revision into v_revision;

  insert into vyndi_audit_events(
    id,entity_type,entity_id,action,actor_user_id,actor_role,source_reference,payload_json)
  values(
    'AUD-SUP-REFUND-'||r.id||'-R'||v_revision,'supplier_refund',r.id,'reversed',
    p_actor_user_id,p_actor_role,trim(p_reason),
    jsonb_build_object('amountInr',r.amount_inr,'paymentPlanMonth',r.plan_month,
      'newClosingCashLakh',v_cash,'actualRevision',v_cash_revision)
  );
  return v_revision;
end;
$$;

-- Supplier payments now settle the net supplier-invoice liability after debit notes.
create or replace function post_vyndi_supplier_payment(
  p_id text,
  p_supplier_invoice_id text,
  p_payment_plan_month integer,
  p_paid_on date,
  p_amount_inr numeric,
  p_source_reference text,
  p_actor_user_id text,
  p_actor_role text
) returns table(
  payment_id text,journal_id text,new_closing_cash_lakh numeric,actual_revision integer,invoice_status text
)
language plpgsql
as $$
declare
  i vyndi_supplier_invoices%rowtype;
  v_paid numeric;
  v_notes numeric;
  v_open numeric;
  v_net numeric;
  v_status text;
  v_journal text;
  v_cash numeric;
  v_revision integer;
  v_existing vyndi_supplier_payments%rowtype;
begin
  if p_payment_plan_month not between 1 and 36 then raise exception 'Supplier payment cash plan month must be between 1 and 36.'; end if;
  if coalesce(p_amount_inr,0)<=0 then raise exception 'Supplier payment amount must be positive.'; end if;
  if trim(coalesce(p_source_reference,''))='' then raise exception 'Supplier payment bank evidence/reference is required.'; end if;

  perform pg_advisory_xact_lock(hashtext('supplier-payment|'||p_supplier_invoice_id)::bigint);
  select * into v_existing from vyndi_supplier_payments where id=upper(trim(p_id));
  if found then
    if v_existing.status='posted' and v_existing.supplier_invoice_id=p_supplier_invoice_id
       and v_existing.plan_month=p_payment_plan_month and v_existing.paid_on=p_paid_on
       and v_existing.amount_inr=round(p_amount_inr,2)
       and v_existing.cash_evidence_reference=trim(p_source_reference) then
      select status into v_status from vyndi_supplier_invoices where id=p_supplier_invoice_id;
      return query select v_existing.id,v_existing.journal_id,v_existing.new_closing_cash_lakh,
        v_existing.cash_actual_revision,v_status;
      return;
    end if;
    raise exception 'Supplier payment id already exists with different state.';
  end if;
  if exists(select 1 from vyndi_supplier_payments where cash_evidence_reference=trim(p_source_reference)) then
    raise exception 'Supplier payment bank evidence/reference has already been used.';
  end if;

  select * into i from vyndi_supplier_invoices where id=p_supplier_invoice_id for update;
  if not found then raise exception 'Supplier invoice not found.'; end if;
  if i.status not in ('approved','part_paid') then raise exception 'Payment requires an approved open supplier invoice.'; end if;

  select coalesce(sum(amount_inr),0) into v_paid
    from vyndi_supplier_payments where supplier_invoice_id=i.id and status='posted';
  select coalesce(sum(gross_amount_inr),0) into v_notes
    from vyndi_supplier_returns where supplier_invoice_id=i.id and status='posted';
  v_net:=greatest(round(i.amount_ex_gst_inr+i.gst_inr-v_notes,2),0);
  v_open:=greatest(round(v_net-v_paid,2),0);
  if v_open<=0.01 then raise exception 'Supplier invoice has no open payable after debit notes.'; end if;
  if round(p_amount_inr,2)>v_open+0.01 then raise exception 'Payment % exceeds net open supplier invoice amount % after debit notes.',round(p_amount_inr,2),v_open; end if;

  insert into vyndi_supplier_payments(
    id,supplier_invoice_id,plan_month,paid_on,amount_inr,source_reference,cash_evidence_reference,status,created_by)
  values(
    upper(trim(p_id)),i.id,p_payment_plan_month,p_paid_on,round(p_amount_inr,2),trim(p_source_reference),
    trim(p_source_reference),'posted',p_actor_user_id
  );

  select j.id into v_journal from epr_finance_journals j
   where j.source_type='supplier_payment' and j.source_id=upper(trim(p_id)) and j.status='posted'
   order by j.posted_at desc limit 1;
  if not found then raise exception 'Supplier payment did not produce a posted Bank journal.'; end if;

  select x.new_closing_cash_lakh,x.actual_revision into v_cash,v_revision
    from apply_vyndi_verified_cash_movement(
      p_payment_plan_month,-round(p_amount_inr,2)/100000.0,
      'supplier-payment:'||upper(trim(p_id))||'; '||trim(p_source_reference),p_actor_user_id,p_actor_role
    ) x;

  v_status:=case when v_paid+p_amount_inr>=v_net-0.01 then 'paid' else 'part_paid' end;
  update vyndi_supplier_payments set
    journal_id=v_journal,cash_actual_revision=v_revision,new_closing_cash_lakh=v_cash
  where id=upper(trim(p_id));
  update vyndi_supplier_invoices set status=v_status,updated_at=now() where id=i.id;

  insert into vyndi_audit_events(id,entity_type,entity_id,action,actor_user_id,actor_role,source_reference,payload_json)
  values(
    'AUD-'||upper(trim(p_id)),'supplier_payment',upper(trim(p_id)),'posted',p_actor_user_id,p_actor_role,
    trim(p_source_reference),jsonb_build_object('supplierInvoiceId',i.id,'paymentPlanMonth',p_payment_plan_month,
      'amountInr',round(p_amount_inr,2),'netInvoiceAfterDebitNotesInr',v_net,'journalId',v_journal,
      'newClosingCashLakh',v_cash,'actualRevision',v_revision,'invoiceStatus',v_status)
  );

  return query select upper(trim(p_id)),v_journal,v_cash,v_revision,v_status;
end;
$$;

create or replace function reverse_vyndi_supplier_payment(
  p_id text,p_reversed_on date,p_reason text,p_actor_user_id text,p_actor_role text
) returns integer
language plpgsql
as $$
declare
  pmt vyndi_supplier_payments%rowtype;
  i vyndi_supplier_invoices%rowtype;
  v_paid numeric;
  v_notes numeric;
  v_net numeric;
  v_status text;
  v_revision integer;
  v_reversal_journal text;
  v_cash numeric;
  v_cash_revision integer;
begin
  if trim(coalesce(p_reason,''))='' then raise exception 'Supplier payment reversal reason is required.'; end if;
  perform pg_advisory_xact_lock(hashtext('supplier-payment|'||upper(trim(p_id)))::bigint);
  select * into pmt from vyndi_supplier_payments where id=upper(trim(p_id)) for update;
  if not found then raise exception 'Supplier payment not found.'; end if;
  if pmt.status='reversed' then return pmt.revision; end if;
  if pmt.created_by=p_actor_user_id then raise exception 'Supplier-payment reversal requires a different authorised user.'; end if;
  if exists(
    select 1 from vyndi_supplier_returns sr
     where sr.supplier_invoice_id=pmt.supplier_invoice_id and sr.status='posted' and sr.recoverable_inr>0
  ) then
    raise exception 'Reverse or settle supplier recoverable/debit-note consequences before reversing this earlier supplier payment.';
  end if;

  select * into i from vyndi_supplier_invoices where id=pmt.supplier_invoice_id for update;
  if not found then raise exception 'Supplier invoice not found for payment reversal.'; end if;

  v_reversal_journal:=reverse_vyndi_finance_journal(
    'supplier_payment',pmt.id,'FIN-APPAY-REV-'||pmt.id,'supplier_payment_reversal',p_reversed_on,
    'Supplier payment reversal '||pmt.id||' · '||trim(p_reason)
  );
  if pmt.journal_id is not null and v_reversal_journal is null then
    raise exception 'Controlled supplier payment could not produce a finance reversal journal.';
  end if;

  if pmt.cash_actual_revision is not null and pmt.plan_month is not null then
    select x.new_closing_cash_lakh,x.actual_revision into v_cash,v_cash_revision
      from apply_vyndi_verified_cash_movement(
        pmt.plan_month,pmt.amount_inr/100000.0,
        'supplier-payment-reversal:'||pmt.id||'; '||trim(p_reason),p_actor_user_id,p_actor_role
      ) x;
  end if;

  update vyndi_supplier_payments set
    status='reversed',revision=revision+1,reversed_by=p_actor_user_id,reversed_at=now(),
    reversal_reason=trim(p_reason),cash_reversal_revision=v_cash_revision,reversed_closing_cash_lakh=v_cash
  where id=pmt.id returning revision into v_revision;

  select coalesce(sum(amount_inr),0) into v_paid
    from vyndi_supplier_payments where supplier_invoice_id=i.id and status='posted';
  select coalesce(sum(gross_amount_inr),0) into v_notes
    from vyndi_supplier_returns where supplier_invoice_id=i.id and status='posted';
  v_net:=greatest(round(i.amount_ex_gst_inr+i.gst_inr-v_notes,2),0);
  v_status:=case when v_net<=0.01 or v_paid>=v_net-0.01 then 'paid'
                 when v_paid>0 then 'part_paid' else 'approved' end;
  update vyndi_supplier_invoices set status=v_status,updated_at=now() where id=i.id;

  insert into vyndi_audit_events(id,entity_type,entity_id,action,actor_user_id,actor_role,source_reference,payload_json)
  values(
    'AUD-'||pmt.id||'-R'||v_revision,'supplier_payment',pmt.id,'reversed',p_actor_user_id,p_actor_role,
    trim(p_reason),jsonb_build_object('supplierInvoiceId',i.id,'paymentPlanMonth',pmt.plan_month,
      'amountInr',pmt.amount_inr,'reversalJournalId',v_reversal_journal,
      'cashReversed',pmt.cash_actual_revision is not null,'newClosingCashLakh',v_cash,
      'actualRevision',v_cash_revision,'invoiceStatus',v_status)
  );
  return v_revision;
end;
$$;

-- ---------------------------------------------------------------------------
-- Net reporting: original documents remain intact; notes/refunds net the financial truth.
-- ---------------------------------------------------------------------------
create or replace view vyndi_accounts_payable as
with notes as (
  select supplier_invoice_id,
         sum(gross_amount_inr)::numeric(18,2) as debit_note_inr,
         sum(recoverable_inr)::numeric(18,2) as recoverable_inr
    from vyndi_supplier_returns where status='posted' group by supplier_invoice_id
),
payments as (
  select supplier_invoice_id,sum(amount_inr) as paid_inr
    from vyndi_supplier_payments where status='posted' group by supplier_invoice_id
),
refunds as (
  select sr.supplier_invoice_id,sum(f.amount_inr)::numeric(18,2) as refunded_inr
    from vyndi_supplier_refunds f
    join vyndi_supplier_returns sr on sr.id=f.supplier_return_id
   where f.status='posted'
   group by sr.supplier_invoice_id
)
select i.id,i.purchase_order_id,p.supplier_id,s.name as supplier_name,i.invoice_number,
       i.invoice_on,i.due_on,i.quantity_invoiced,i.amount_ex_gst_inr,i.gst_inr,
       (i.amount_ex_gst_inr+i.gst_inr) as invoice_total_inr,
       coalesce(pay.paid_inr,0) as amount_paid_inr,
       greatest(i.amount_ex_gst_inr+i.gst_inr-coalesce(n.debit_note_inr,0)-coalesce(pay.paid_inr,0),0) as amount_open_inr,
       i.status,i.match_message,i.source_reference,
       coalesce(n.debit_note_inr,0)::numeric(18,2) as debit_note_inr,
       greatest(i.amount_ex_gst_inr+i.gst_inr-coalesce(n.debit_note_inr,0),0)::numeric(18,2) as net_invoice_total_inr,
       greatest(coalesce(n.recoverable_inr,0)-coalesce(ref.refunded_inr,0),0)::numeric(18,2) as supplier_recoverable_inr
  from vyndi_supplier_invoices i
  join vyndi_purchase_orders p on p.id=i.purchase_order_id
  join vyndi_suppliers s on s.id=p.supplier_id
  left join notes n on n.supplier_invoice_id=i.id
  left join payments pay on pay.supplier_invoice_id=i.id
  left join refunds ref on ref.supplier_invoice_id=i.id;

create or replace view vyndi_report_sales_ledger as
with collected as (
  select invoice_id,round(coalesce(sum(amount_lakh) filter(where status='posted'),0)*100000,2) as collected_inr
    from vyndi_collections group by invoice_id
),
credited as (
  select invoice_id,
         round(coalesce(sum(taxable_value_inr),0),2) as credit_taxable_inr,
         round(coalesce(sum(gst_inr),0),2) as credit_gst_inr,
         round(coalesce(sum(gross_amount_inr),0),2) as credit_gross_inr
    from vyndi_customer_credit_notes where status='active' group by invoice_id
),
refunded as (
  select cn.invoice_id,round(coalesce(sum(r.amount_inr),0),2) as refunded_inr
    from vyndi_customer_refunds r
    join vyndi_customer_credit_notes cn on cn.id=r.credit_note_id
   where r.status='posted' group by cn.invoice_id
)
select
  i.id as invoice_id,
  i.issued_at::date as issued_on,
  i.plan_month,
  i.sale_type,
  coalesce(o.channel,s.channel) as channel,
  i.recipient_name as customer_name,
  i.recipient_gstin as customer_gstin,
  i.sales_order_id,
  i.shipment_id,
  i.spare_sale_id,
  case when i.sale_type='spare_component' then s.sku else coalesce(o.variant_name,o.variant_id,o.product_id) end as item_reference,
  i.item_description,
  i.units as quantity,
  i.unit_code,
  ident.visible_id as vyndi_identity,
  ident.oem_part_number,
  ident.oem_serial_number,
  ident.supplier_lot,
  case when i.sale_type='spare_component' then s.allocated_identity_refs else '[]'::jsonb end as allocation_identity_refs,
  round(coalesce(i.taxable_value_inr,i.amount_lakh*100000),2) as taxable_value_inr,
  round(coalesce(i.gst_inr,0),2) as gst_inr,
  round(case when coalesce(i.gross_amount_inr,0)>0 then i.gross_amount_inr else i.amount_lakh*100000 end,2) as gross_amount_inr,
  coalesce(c.collected_inr,0)::numeric(18,2) as collected_inr,
  greatest(round(case when coalesce(i.gross_amount_inr,0)>0 then i.gross_amount_inr else i.amount_lakh*100000 end,2)
    -coalesce(cr.credit_gross_inr,0)-coalesce(c.collected_inr,0)+coalesce(rf.refunded_inr,0),0)::numeric(18,2) as balance_inr,
  case
    when i.status='void' then 'void'
    when greatest(coalesce(c.collected_inr,0)-coalesce(rf.refunded_inr,0)
      -(round(case when coalesce(i.gross_amount_inr,0)>0 then i.gross_amount_inr else i.amount_lakh*100000 end,2)
        -coalesce(cr.credit_gross_inr,0)),0)>0.01 then 'refund_due'
    when round(case when coalesce(i.gross_amount_inr,0)>0 then i.gross_amount_inr else i.amount_lakh*100000 end,2)-coalesce(cr.credit_gross_inr,0)<=0.01 then 'credited'
    when coalesce(c.collected_inr,0)-coalesce(rf.refunded_inr,0)<=0 then 'unpaid'
    when coalesce(c.collected_inr,0)-coalesce(rf.refunded_inr,0)+0.01 >=
      round(case when coalesce(i.gross_amount_inr,0)>0 then i.gross_amount_inr else i.amount_lakh*100000 end,2)-coalesce(cr.credit_gross_inr,0) then 'paid'
    else 'part_paid'
  end as payment_status,
  i.credit_terms_days,
  i.due_on,
  case
    when i.status='void' then 'VOID'
    when i.credit_profile_status<>'controlled' or i.due_on is null then 'LEGACY_NO_TERMS'
    when i.due_on>=current_date then 'CURRENT'
    when current_date-i.due_on>90 then 'OVER_90'
    when current_date-i.due_on>60 then 'OVER_60'
    when current_date-i.due_on>30 then 'OVER_30'
    else 'OVERDUE'
  end as aging_bucket,
  case when i.sale_type='spare_component' then s.fifo_cost_inr else null end as fifo_cogs_inr,
  case when i.sale_type='spare_component' then round(coalesce(i.taxable_value_inr,i.amount_lakh*100000)-coalesce(cr.credit_taxable_inr,0)-s.fifo_cost_inr,2) else null end as gross_margin_inr,
  i.status as invoice_status,
  i.source_reference,
  coalesce(cr.credit_taxable_inr,0)::numeric(18,2) as credit_note_taxable_inr,
  coalesce(cr.credit_gst_inr,0)::numeric(18,2) as credit_note_gst_inr,
  coalesce(cr.credit_gross_inr,0)::numeric(18,2) as credit_note_gross_inr,
  coalesce(rf.refunded_inr,0)::numeric(18,2) as refunded_inr,
  greatest(coalesce(c.collected_inr,0)-coalesce(rf.refunded_inr,0)
    -(round(case when coalesce(i.gross_amount_inr,0)>0 then i.gross_amount_inr else i.amount_lakh*100000 end,2)
      -coalesce(cr.credit_gross_inr,0)),0)::numeric(18,2) as refund_due_inr
from vyndi_invoices i
left join vyndi_sales_orders o on o.id=i.sales_order_id
left join vyndi_spare_sales s on s.id=i.spare_sale_id
left join vyndi_identity_registry ident on ident.identity_uid=s.selected_identity_uid
left join collected c on c.invoice_id=i.id
left join credited cr on cr.invoice_id=i.id
left join refunded rf on rf.invoice_id=i.id;

create or replace view vyndi_report_sales_summary as
select
  plan_month,
  sale_type,
  count(*) filter(where invoice_status='issued')::integer as invoice_count,
  round(coalesce(sum(taxable_value_inr-credit_note_taxable_inr) filter(where invoice_status='issued'),0),2) as taxable_sales_inr,
  round(coalesce(sum(gst_inr-credit_note_gst_inr) filter(where invoice_status='issued'),0),2) as output_gst_inr,
  round(coalesce(sum(gross_amount_inr-credit_note_gross_inr) filter(where invoice_status='issued'),0),2) as gross_sales_inr,
  round(coalesce(sum(collected_inr-refunded_inr) filter(where invoice_status='issued'),0),2) as collected_inr,
  round(coalesce(sum(balance_inr) filter(where invoice_status='issued'),0),2) as open_receivable_inr
from vyndi_report_sales_ledger
group by plan_month,sale_type
order by plan_month,sale_type;

create or replace view vyndi_monthly_transaction_actuals as
with months as (select generate_series(1,36)::integer as plan_month),
invoice_month as (
  select plan_month,sum(amount_lakh)::numeric(18,4) revenue,
         coalesce(sum(units) filter(where sale_type='bicycle'),0)::numeric(14,4) units
    from vyndi_invoices where status='issued' group by plan_month
),
credit_month as (
  select c.plan_month,
         (sum(c.taxable_value_inr)/100000.0)::numeric(18,4) revenue_credit,
         coalesce(sum(c.quantity) filter(where i.sale_type='bicycle'),0)::numeric(14,4) unit_credit
    from vyndi_customer_credit_notes c
    join vyndi_invoices i on i.id=c.invoice_id
   where c.status='active'
   group by c.plan_month
),
invoice_cume as (
  select m.plan_month,
         coalesce((select sum(case when i.gross_amount_inr>0 then i.gross_amount_inr/100000.0 else i.amount_lakh end)
                     from vyndi_invoices i where i.status='issued' and i.plan_month<=m.plan_month),0)::numeric(18,4) invoiced
    from months m
),
credit_cume as (
  select m.plan_month,
         coalesce((select sum(c.gross_amount_inr)/100000.0
                     from vyndi_customer_credit_notes c where c.status='active' and c.plan_month<=m.plan_month),0)::numeric(18,4) credited
    from months m
),
collection_cume as (
  select m.plan_month,
         coalesce((select sum(c.amount_lakh) from vyndi_collections c where c.status='posted' and c.plan_month<=m.plan_month),0)::numeric(18,4) collected
    from months m
),
refund_cume as (
  select m.plan_month,
         coalesce((select sum(r.amount_inr)/100000.0 from vyndi_customer_refunds r where r.status='posted' and r.plan_month<=m.plan_month),0)::numeric(18,4) refunded
    from months m
)
select m.plan_month,
       (coalesce(im.revenue,0)-coalesce(cm.revenue_credit,0))::numeric(18,4) revenue,
       (coalesce(im.units,0)-coalesce(cm.unit_credit,0))::numeric(14,4) units,
       greatest(ic.invoiced-cc.credited-co.collected+rf.refunded,0)::numeric(18,4) receivables
  from months m
  left join invoice_month im using(plan_month)
  left join credit_month cm using(plan_month)
  join invoice_cume ic using(plan_month)
  join credit_cume cc using(plan_month)
  join collection_cume co using(plan_month)
  join refund_cume rf using(plan_month);

create or replace view vyndi_report_receivables_aging as
select
  i.invoice_id,
  i.sales_order_id,
  i.plan_month,
  ((i.gross_amount_inr-i.credit_note_gross_inr)/100000.0)::numeric(18,4) as invoiced_lakh,
  ((i.collected_inr-i.refunded_inr)/100000.0) as collected_lakh,
  (i.balance_inr/100000.0) as open_lakh,
  i.issued_on,
  (current_date-i.issued_on) as age_days,
  i.aging_bucket,
  i.credit_terms_days,
  i.due_on,
  case when i.due_on is null then null else greatest(current_date-i.due_on,0) end as days_overdue,
  src.credit_profile_status,
  src.credit_terms_reference
from vyndi_report_sales_ledger i
join vyndi_invoices src on src.id=i.invoice_id
where i.invoice_status='issued' and i.balance_inr>0;

comment on table vyndi_customer_returns is
  'Customer RMA/return evidence. Restock is the only disposition that restores available inventory and reverses COGS; quarantine/scrap never silently increase ATP.';
comment on table vyndi_customer_credit_notes is
  'Append-only customer credit notes linked to controlled return evidence. Original invoice and GST evidence remain intact; signed GST evidence nets the return.';
comment on table vyndi_customer_refunds is
  'Evidenced customer bank refunds against credit notes. Each refund has an explicit M1..M36 cash month and updates verified canonical cash.';
comment on table vyndi_supplier_returns is
  'Return-to-vendor plus debit-note authority. FIFO must prove the physical stock came exclusively from the selected GRN; AP offset and supplier recoverable are separated.';
comment on table vyndi_supplier_refunds is
  'Evidenced supplier refund receipts against supplier recoverables with explicit M1..M36 cash authority.';
