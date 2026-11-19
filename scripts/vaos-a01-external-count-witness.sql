-- A01 independent direct-DB same-statement witness.
-- Execute ONLY through an independently authorized read-only VYNDI database connection.
-- Shares one MVCC observation across three EXACT signed-bridge SQL projections.
-- Identical row counts plus content hashes are a point-in-time parity test,
-- NOT change-data-capture, a durable revision, a cross-connection snapshot,
-- independent signature, authoritative source certification or write permission.
-- Scope is subject to a single-venture fail-closed precondition; false means HOLD.
WITH venture_guard AS MATERIALIZED (
  SELECT count(*)::integer AS venture_count
  FROM (
    SELECT venture FROM public.epr_inventory_ledger
    UNION
    SELECT venture FROM public.epr_inventory_cost_ledger
    LIMIT 2
  ) distinct_ventures
), inventory_scope AS MATERIALIZED (
  SELECT sku,unit,quantity_balance,inventory_value_inr,weighted_average_cost_inr,
         first_movement_at,last_movement_at
    FROM public.vyndi_inventory_balance
), shortage_scope AS MATERIALIZED (
  SELECT job_card_id,job_card_line_id,sales_order_id,product_label,variant_id,
         units,due_month,sku,category,item,required_quantity,
         physical_quantity AS available_quantity,reserved_quantity,
         shortage_quantity,available_to_promise,unit,bom_revision,sales_order_revision
    FROM public.vyndi_live_job_card_requirements
   WHERE job_card_status IN ('released','in_progress')
     AND sku IS NOT NULL AND shortage_quantity > 0
), purchase_order_scope AS MATERIALIZED (
  SELECT p.id,p.supplier_id,p.source_action_id,p.requirement_month,p.sku,p.unit,
         p.quantity,p.unit_price_inr,p.order_date,p.expected_receipt_on,
         p.payment_terms_days,p.status,p.source_reference,p.job_card_id,
         p.record_revision,p.created_at,p.updated_at,
         j.status AS job_card_status,s.status AS sales_order_status,
         CASE WHEN j.status='cancelled' OR s.status='cancelled'
              THEN 'CANCELLED_UPSTREAM_DEMAND'
              ELSE 'UPSTREAM_DEMAND_UNVERIFIED' END AS demand_lineage_state
    FROM public.vyndi_purchase_orders p
    LEFT JOIN public.epr_production_job_cards j ON j.id=p.job_card_id
    LEFT JOIN public.vyndi_sales_orders s ON s.id=j.sales_order_id
   WHERE p.status IN ('draft','pending_approval','approved','issued','part_received')
)
SELECT transaction_timestamp() AS witness_observed_at,
       pg_current_snapshot()::text AS source_mvcc_snapshot,
       pg_current_wal_lsn()::text AS observed_wal_location_not_revision,
       current_database() AS source_database,
       (SELECT venture_count FROM venture_guard) = 1 AS single_venture_scope_verified,
       (SELECT count(*)::integer FROM inventory_scope) AS inventory_count,
       (SELECT count(*)::integer FROM shortage_scope) AS shortage_count,
       (SELECT count(*)::integer FROM purchase_order_scope) AS purchase_order_count,
       (SELECT encode(sha256(convert_to(
          coalesce(jsonb_agg(to_jsonb(i) ORDER BY i.sku,i.unit),'[]'::jsonb)::text,
           'UTF8')),'hex') FROM inventory_scope i) AS inventory_fingerprint,
       (SELECT encode(sha256(convert_to(
          coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.due_month,s.shortage_quantity DESC,s.sku,s.job_card_line_id),'[]'::jsonb)::text,
           'UTF8')),'hex') FROM shortage_scope s) AS shortage_fingerprint,
       (SELECT encode(sha256(convert_to(
          coalesce(jsonb_agg(to_jsonb(p) ORDER BY p.updated_at DESC,p.id),'[]'::jsonb)::text,
           'UTF8')),'hex') FROM purchase_order_scope p) AS purchase_order_fingerprint,
       false AS source_revision_certified,
       false AS source_completeness_verified,
       false AS independent_signature_verified,
       false AS business_action_authorized;
