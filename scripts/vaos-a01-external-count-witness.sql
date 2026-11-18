-- A01 external direct-DB witness, run via a separately authorized read-only
-- database connection, NEVER via the signed VYNDI bridge. Returns only counts
-- and query timestamp; not an authoritative revision/CDC/completeness proof.
-- One SQL statement yields a consistent snapshot for all three sources.
SELECT transaction_timestamp() AS witness_observed_at,
       current_database() AS source_database,
       (SELECT count(*)::integer
          FROM public.vyndi_inventory_balance) AS inventory_count,
       (SELECT count(*)::integer
          FROM public.vyndi_live_job_card_requirements
         WHERE job_card_status IN ('released','in_progress')
           AND sku IS NOT NULL AND shortage_quantity > 0) AS shortage_count,
       (SELECT count(*)::integer
          FROM public.vyndi_purchase_orders p
         WHERE p.status IN ('draft','pending_approval','approved','issued','part_received')) AS purchase_order_count;
