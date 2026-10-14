-- Approved production changes create a new controlled, current Job Card.
-- Original approved Job Cards, travellers, evidence and released BOM snapshots survive untouched.
alter table epr_production_job_cards
  add column if not exists current_for_order boolean not null default true;
alter table epr_production_job_cards
  add column if not exists supersedes_job_card_id text references epr_production_job_cards(id) on delete restrict;
alter table epr_production_job_cards
  add column if not exists production_change_id text;

-- Existing production data has exactly one card per order; only the designated
-- current card is unique. Historical superseded records remain addressable by id.
alter table epr_production_job_cards
  drop constraint if exists epr_production_job_cards_sales_order_id_key;
create unique index if not exists epr_production_job_cards_current_order_uq
  on epr_production_job_cards (sales_order_id) where current_for_order=true;
create unique index if not exists epr_production_job_cards_change_uq
  on epr_production_job_cards(production_change_id) where production_change_id is not null;
create index if not exists epr_production_job_cards_supersedes_idx
  on epr_production_job_cards(supersedes_job_card_id);

create table if not exists vyndi_production_change_requests (
  id text primary key,
  sales_order_id text not null references vyndi_sales_orders(id) on delete restrict,
  source_job_card_id text not null references epr_production_job_cards(id) on delete restrict,
  target_sales_revision integer not null check (target_sales_revision>0),
  reason text not null check (length(trim(reason))>=12),
  ecn_id text references vyndi_engineering_change_notices(id) on delete restrict,
  status text not null default 'requested' check (status in ('requested','applied','rejected')),
  source_snapshot jsonb not null,
  created_by text not null,
  approved_by text,
  successor_job_card_id text references epr_production_job_cards(id) on delete restrict,
  created_at timestamptz not null default now(),
  applied_at timestamptz,
  updated_at timestamptz not null default now()
);
create unique index if not exists vyndi_production_change_pending_uq
  on vyndi_production_change_requests(sales_order_id) where status='requested';
create index if not exists vyndi_production_change_order_idx
  on vyndi_production_change_requests(sales_order_id,created_at desc);

-- A superseded batch must never receive further reservation or batch approval.
-- Existing R2 release/evidence stays auditable; only its current eligibility changes.
create or replace function vyndi_production_successor_guard()
returns trigger language plpgsql as $$
declare
  v_current boolean;
begin
  if tg_table_name='epr_production_job_cards' then
    if tg_op='UPDATE' and old.current_for_order=false and
       (new.current_for_order=true or new.sales_order_revision is distinct from old.sales_order_revision
       or new.bom_revision is distinct from old.bom_revision) then
      raise exception 'Superseded Job Card is immutable; use the current controlled successor.';
    end if;
    return new;
  end if;
  return new;
end;
$$;
drop trigger if exists vyndi_production_successor_guard_trigger on epr_production_job_cards;
create trigger vyndi_production_successor_guard_trigger
before update on epr_production_job_cards
for each row execute function vyndi_production_successor_guard();

comment on table vyndi_production_change_requests is
  'Audited request and approval evidence linking immutable approved Job Card revisions to controlled successors; application gates verify no physical execution or downstream commitment before release.';

-- Prevent any new physical execution, release evidence or serial allocation
-- from being recorded against a superseded (noncurrent) approved Job Card.
create or replace function vyndi_block_superseded_traveller_activity()
returns trigger language plpgsql as $$
declare
  v_traveller text;
  v_current boolean;
begin
  v_traveller:=new.traveller_id;
  select c.current_for_order into v_current
    from epr_travellers t
    join epr_production_job_cards c on c.id=t.job_card_id
    where t.id=v_traveller
    for share of c;
  if v_current=false then
    raise exception 'Superseded production Job Card cannot accept new traveller, quality or dispatch evidence.';
  end if;
  return new;
end;
$$;
drop trigger if exists vyndi_gate_supersession_guard on epr_gate_events;
create trigger vyndi_gate_supersession_guard
before insert or update on epr_gate_events
for each row execute function vyndi_block_superseded_traveller_activity();

drop trigger if exists vyndi_evidence_supersession_guard on epr_evidence;
create trigger vyndi_evidence_supersession_guard
before insert or update on epr_evidence
for each row execute function vyndi_block_superseded_traveller_activity();

drop trigger if exists vyndi_quality_supersession_guard on vyndi_quality_releases;
create trigger vyndi_quality_supersession_guard
before insert on vyndi_quality_releases
for each row execute function vyndi_block_superseded_traveller_activity();

drop trigger if exists vyndi_shipment_supersession_guard on vyndi_shipment_serial_allocations;
create trigger vyndi_shipment_supersession_guard
before insert on vyndi_shipment_serial_allocations
for each row execute function vyndi_block_superseded_traveller_activity();

-- Existing operational reports select current cards, while historic genealogy retains prior versions.
create or replace view vyndi_report_order_book_sync as
 SELECT o.id AS sales_order_id,
    o.revision AS order_revision,
    o.status AS order_status,
    o.plan_month,
    o.product_id,
    o.units AS order_units,
    o.asp_lakh,
    c.id AS job_card_id,
    c.sales_order_revision AS job_order_revision,
    c.status AS job_status,
        CASE
            WHEN c.id IS NULL AND (o.status = ANY (ARRAY['confirmed'::text, 'delivered'::text])) THEN 'MISSING_JOB_CARD'::text
            WHEN c.id IS NOT NULL AND c.sales_order_revision IS DISTINCT FROM o.revision THEN 'STALE_JOB_CARD'::text
            WHEN o.status = 'cancelled'::text AND c.status <> 'cancelled'::text THEN 'CANCELLED_ORDER_ACTIVE_JOB'::text
            ELSE 'SYNCED'::text
        END AS sync_status
   FROM vyndi_sales_orders o
     LEFT JOIN epr_production_job_cards c ON c.sales_order_id = o.id AND c.current_for_order = true;

create or replace view vyndi_report_sop_snapshot as
 SELECT ( SELECT count(*)::integer AS count
           FROM vyndi_sales_orders
          WHERE vyndi_sales_orders.status = ANY (ARRAY['lead'::text, 'confirmed'::text])) AS open_orders,
    ( SELECT COALESCE(sum(vyndi_sales_orders.units), 0::numeric) AS "coalesce"
           FROM vyndi_sales_orders
          WHERE vyndi_sales_orders.status = ANY (ARRAY['lead'::text, 'confirmed'::text])) AS open_order_units,
    ( SELECT count(*)::integer AS count
           FROM epr_production_job_cards
          WHERE epr_production_job_cards.current_for_order = true AND epr_production_job_cards.status <> ALL (ARRAY['complete'::text, 'cancelled'::text])) AS open_job_cards,
    ( SELECT count(*)::integer AS count
           FROM epr_inventory_reservations
          WHERE epr_inventory_reservations.status = 'active'::text) AS active_reservations,
    ( SELECT COALESCE(sum(epr_inventory_reservations.quantity_reserved), 0::numeric) AS "coalesce"
           FROM epr_inventory_reservations
          WHERE epr_inventory_reservations.status = 'active'::text) AS reserved_units,
    ( SELECT count(*)::integer AS count
           FROM master_inventory_items i
             LEFT JOIN vyndi_inventory_available_to_promise atp ON atp.sku = i.sku AND atp.unit = vyndi_canonical_unit(i.unit)
          WHERE i.active AND i.minimum_stock_level > 0::numeric AND COALESCE(atp.available_to_promise, 0::numeric) < i.minimum_stock_level) AS skus_below_msl,
    ( SELECT count(*)::integer AS count
           FROM vyndi_purchase_order_status
          WHERE vyndi_purchase_order_status.status = ANY (ARRAY['approved'::text, 'issued'::text, 'part_received'::text])) AS open_pos,
    ( SELECT COALESCE(sum(x.open_lakh), 0::numeric) AS "coalesce"
           FROM ( SELECT GREATEST(i.amount_lakh - COALESCE(c.collected, 0::numeric), 0::numeric) AS open_lakh
                   FROM vyndi_invoices i
                     LEFT JOIN ( SELECT vyndi_collections.invoice_id,
                            sum(vyndi_collections.amount_lakh) AS collected
                           FROM vyndi_collections
                          WHERE vyndi_collections.status = 'posted'::text
                          GROUP BY vyndi_collections.invoice_id) c ON c.invoice_id = i.id
                  WHERE i.status = 'issued'::text) x) AS open_receivables_lakh,
    ( SELECT count(*)::integer AS count
           FROM vyndi_audit_events
          WHERE vyndi_audit_events.created_at > (now() - '7 days'::interval)) AS audit_events_7d;

create or replace view vyndi_vibpe_assurance_exceptions as
 WITH current_cards AS (
         SELECT c.id,
            c.sales_order_id,
            c.product_id,
            c.product_label,
            c.units,
            c.bom_tier,
            c.due_month,
            c.status,
            c.production_owner,
            c.created_by,
            c.created_at,
            c.updated_at,
            c.model_tier,
            c.variant_id,
            c.configuration,
            c.sales_order_revision,
            c.bom_revision,
            c.released_mapping_set,
            c.updated_by,
            c.batch_code,
            c.approved_by,
            c.approved_at,
            row_number() OVER (PARTITION BY c.sales_order_id, c.sales_order_revision ORDER BY c.updated_at DESC NULLS LAST, c.created_at DESC NULLS LAST, c.id DESC) AS rn,
            count(*) OVER (PARTITION BY c.sales_order_id, c.sales_order_revision) AS sibling_count
           FROM epr_production_job_cards c
          WHERE c.current_for_order = true AND c.status <> 'cancelled'::text
        ), confirmed_orders AS (
         SELECT vyndi_sales_orders.id,
            vyndi_sales_orders.revision,
            vyndi_sales_orders.plan_month,
            vyndi_sales_orders.product_id,
            vyndi_sales_orders.units,
            vyndi_sales_orders.asp_lakh,
            vyndi_sales_orders.channel,
            vyndi_sales_orders.status,
            vyndi_sales_orders.model_tier,
            vyndi_sales_orders.variant_id,
            vyndi_sales_orders.variant_name,
            vyndi_sales_orders.configuration,
            vyndi_sales_orders.created_by,
            vyndi_sales_orders.created_at,
            vyndi_sales_orders.updated_by,
            vyndi_sales_orders.updated_at
           FROM vyndi_sales_orders
          WHERE vyndi_sales_orders.status = 'confirmed'::text
        ), shortage_cards AS (
         SELECT r.job_card_id,
            count(*) FILTER (WHERE r.sku IS NOT NULL AND r.shortage_quantity > 0::numeric)::integer AS shortage_lines,
            COALESCE(sum(r.shortage_quantity) FILTER (WHERE r.sku IS NOT NULL AND r.shortage_quantity > 0::numeric), 0::numeric) AS shortage_units
           FROM vyndi_live_job_card_requirements r
          GROUP BY r.job_card_id
        ), po_cards AS (
         SELECT p.job_card_id,
            count(*) FILTER (WHERE p.status <> 'cancelled'::text)::integer AS po_count
           FROM vyndi_purchase_orders p
          GROUP BY p.job_card_id
        ), traveller_cards AS (
         SELECT t.job_card_id,
            count(*) FILTER (WHERE t.status <> 'rejected'::text)::integer AS traveller_count
           FROM epr_travellers t
          GROUP BY t.job_card_id
        ), shipment_orders AS (
         SELECT s.sales_order_id,
            count(*) FILTER (WHERE s.status = 'posted'::text)::integer AS shipment_count
           FROM vyndi_shipments s
          GROUP BY s.sales_order_id
        ), invoice_orders AS (
         SELECT i.sales_order_id,
            count(*) FILTER (WHERE i.status = 'issued'::text)::integer AS invoice_count
           FROM vyndi_invoices i
          GROUP BY i.sales_order_id
        )
 SELECT (('confirmed-order-missing-job-card|'::text || o.id) || '|R'::text) || o.revision AS exception_key,
    'confirmed_order_missing_job_card'::text AS exception_type,
    'critical'::text AS severity,
    'production'::text AS domain,
    'sales_order'::text AS entity_type,
    o.id AS entity_id,
    'production_job_card'::text AS related_entity_type,
    NULL::text AS related_entity_id,
    'G07-PROD-RELEASE'::text AS gate_id,
    (('ORDER|'::text || o.id) || '|R'::text) || o.revision AS correlation_id,
    jsonb_build_object('salesOrderRevision', o.revision, 'status', o.status, 'variantId', o.variant_id, 'planMonth', o.plan_month) AS evidence_json
   FROM confirmed_orders o
     LEFT JOIN current_cards c ON c.sales_order_id = o.id AND c.sales_order_revision = o.revision AND c.rn = 1
  WHERE c.id IS NULL
UNION ALL
 SELECT 'orphan-job-card|'::text || c.id AS exception_key,
    'orphan_job_card'::text AS exception_type,
    'critical'::text AS severity,
    'production'::text AS domain,
    'production_job_card'::text AS entity_type,
    c.id AS entity_id,
    'sales_order'::text AS related_entity_type,
    c.sales_order_id AS related_entity_id,
    'G02-REF-INTEGRITY'::text AS gate_id,
    (('ORDER|'::text || COALESCE(c.sales_order_id, 'UNKNOWN'::text)) || '|R'::text) || COALESCE(c.sales_order_revision, 0) AS correlation_id,
    jsonb_build_object('jobCardRevision', c.sales_order_revision, 'status', c.status) AS evidence_json
   FROM current_cards c
     LEFT JOIN vyndi_sales_orders o ON o.id = c.sales_order_id
  WHERE c.rn = 1 AND o.id IS NULL
UNION ALL
 SELECT 'stale-job-card-revision|'::text || c.id AS exception_key,
    'stale_job_card_revision'::text AS exception_type,
    'critical'::text AS severity,
    'production'::text AS domain,
    'production_job_card'::text AS entity_type,
    c.id AS entity_id,
    'sales_order'::text AS related_entity_type,
    o.id AS related_entity_id,
    'G07-PROD-RELEASE'::text AS gate_id,
    (('ORDER|'::text || o.id) || '|R'::text) || o.revision AS correlation_id,
    jsonb_build_object('currentSalesOrderRevision', o.revision, 'jobCardRevision', c.sales_order_revision) AS evidence_json
   FROM vyndi_sales_orders o
     JOIN current_cards c ON c.sales_order_id = o.id AND c.rn = 1
  WHERE o.status = 'confirmed'::text AND c.sales_order_revision <> o.revision
UNION ALL
 SELECT (('duplicate-job-card|'::text || c.sales_order_id) || '|R'::text) || c.sales_order_revision AS exception_key,
    'duplicate_job_card_for_revision'::text AS exception_type,
    'critical'::text AS severity,
    'production'::text AS domain,
    'sales_order'::text AS entity_type,
    c.sales_order_id AS entity_id,
    'production_job_card'::text AS related_entity_type,
    c.id AS related_entity_id,
    'G07-PROD-RELEASE'::text AS gate_id,
    (('ORDER|'::text || c.sales_order_id) || '|R'::text) || c.sales_order_revision AS correlation_id,
    jsonb_build_object('jobCardCount', c.sibling_count, 'sampleJobCardId', c.id) AS evidence_json
   FROM current_cards c
  WHERE c.rn = 1 AND c.sibling_count > 1
UNION ALL
 SELECT 'shortage-without-procurement|'::text || c.id AS exception_key,
    'shortage_without_procurement_action'::text AS exception_type,
    'critical'::text AS severity,
    'procurement'::text AS domain,
    'production_job_card'::text AS entity_type,
    c.id AS entity_id,
    'purchase_order'::text AS related_entity_type,
    NULL::text AS related_entity_id,
    'G06-PROCUREMENT'::text AS gate_id,
    (('ORDER|'::text || c.sales_order_id) || '|R'::text) || c.sales_order_revision AS correlation_id,
    jsonb_build_object('shortageLines', COALESCE(s.shortage_lines, 0), 'shortageUnits', COALESCE(s.shortage_units, 0::numeric)) AS evidence_json
   FROM current_cards c
     JOIN shortage_cards s ON s.job_card_id = c.id AND s.shortage_lines > 0
     LEFT JOIN po_cards p ON p.job_card_id = c.id
  WHERE c.rn = 1 AND COALESCE(p.po_count, 0) = 0
UNION ALL
 SELECT 'approved-build-missing-traveller|'::text || c.id AS exception_key,
    'approved_build_missing_traveller'::text AS exception_type,
    'critical'::text AS severity,
    'production'::text AS domain,
    'production_job_card'::text AS entity_type,
    c.id AS entity_id,
    'production_traveller'::text AS related_entity_type,
    NULL::text AS related_entity_id,
    'G09-PROCESS-COMPLETE'::text AS gate_id,
    (('ORDER|'::text || c.sales_order_id) || '|R'::text) || c.sales_order_revision AS correlation_id,
    jsonb_build_object('approvedAt', c.approved_at, 'units', c.units, 'travellerCount', COALESCE(t.traveller_count, 0)) AS evidence_json
   FROM current_cards c
     LEFT JOIN traveller_cards t ON t.job_card_id = c.id
  WHERE c.rn = 1 AND c.approved_at IS NOT NULL AND COALESCE(t.traveller_count, 0)::numeric < c.units
UNION ALL
 SELECT 'shipment-without-approved-build|'::text || s.id AS exception_key,
    'shipment_without_approved_build'::text AS exception_type,
    'critical'::text AS severity,
    'commercial'::text AS domain,
    'shipment'::text AS entity_type,
    s.id AS entity_id,
    'sales_order'::text AS related_entity_type,
    s.sales_order_id AS related_entity_id,
    'G12-DISPATCH'::text AS gate_id,
    'ORDER|'::text || s.sales_order_id AS correlation_id,
    jsonb_build_object('shipmentStatus', s.status, 'units', s.units) AS evidence_json
   FROM vyndi_shipments s
     LEFT JOIN LATERAL ( SELECT c_1.id,
            c_1.approved_at
           FROM current_cards c_1
          WHERE c_1.sales_order_id = s.sales_order_id AND c_1.rn = 1
         LIMIT 1) c ON true
  WHERE s.status = 'posted'::text AND (c.id IS NULL OR c.approved_at IS NULL)
UNION ALL
 SELECT 'invoice-without-shipment|'::text || i.id AS exception_key,
    'invoice_without_posted_shipment'::text AS exception_type,
    'critical'::text AS severity,
    'finance'::text AS domain,
    'invoice'::text AS entity_type,
    i.id AS entity_id,
    'sales_order'::text AS related_entity_type,
    i.sales_order_id AS related_entity_id,
    'G13-FINANCE'::text AS gate_id,
    'ORDER|'::text || i.sales_order_id AS correlation_id,
    jsonb_build_object('invoiceStatus', i.status, 'amountLakh', i.amount_lakh) AS evidence_json
   FROM vyndi_invoices i
     LEFT JOIN shipment_orders s ON s.sales_order_id = i.sales_order_id
  WHERE i.status = 'issued'::text AND COALESCE(s.shipment_count, 0) = 0
UNION ALL
 SELECT (('missing-sales-order-audit|'::text || o.id) || '|R'::text) || o.revision AS exception_key,
    'missing_audit_event'::text AS exception_type,
    'warning'::text AS severity,
    'governance'::text AS domain,
    'sales_order'::text AS entity_type,
    o.id AS entity_id,
    'audit_event'::text AS related_entity_type,
    NULL::text AS related_entity_id,
    'G15-AUDIT'::text AS gate_id,
    (('ORDER|'::text || o.id) || '|R'::text) || o.revision AS correlation_id,
    jsonb_build_object('expectedEntityRevision', o.revision) AS evidence_json
   FROM vyndi_sales_orders o
     LEFT JOIN vyndi_audit_events a ON a.entity_type = 'sales_order'::text AND a.entity_id = o.id AND a.entity_revision = o.revision
  WHERE a.id IS NULL
UNION ALL
 SELECT 'audit-actor-attribution|'::text || a.id AS exception_key,
    'audit_actor_attribution_missing'::text AS exception_type,
    'warning'::text AS severity,
    'governance'::text AS domain,
    'audit_event'::text AS entity_type,
    a.id AS entity_id,
    a.entity_type AS related_entity_type,
    a.entity_id AS related_entity_id,
    'G14-AUTH'::text AS gate_id,
    COALESCE(a.correlation_id, (('AUDIT|'::text || a.entity_type) || '|'::text) || a.entity_id) AS correlation_id,
    jsonb_build_object('actorUserId', a.actor_user_id, 'actorRole', a.actor_role, 'action', a.action) AS evidence_json
   FROM vyndi_audit_events a
  WHERE btrim(COALESCE(a.actor_user_id, ''::text)) = ''::text OR btrim(COALESCE(a.actor_role, ''::text)) = ''::text;

