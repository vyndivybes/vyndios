-- A01 / P0: PRIVATE candidate inventory balance partitioned by venture.
-- Does NOT authorize cross-tenant reads, alter legacy ERP views, or promote
-- SOURCE_UNVERIFIED. This schema is UNRELEASED pending reviewed tenant identity,
-- reservations/ATP and demand lineage, independent signer, pagination, and SLO.
-- Requires migration 0196's private authority schema and existing inventory base.
DO $a01_require_authority$
BEGIN
  IF to_regnamespace('vyndi_vaos_authority') IS NULL THEN
    RAISE EXCEPTION 'A01_PRIVATE_AUTHORITY_SCHEMA_REQUIRED';
  END IF;
END;
$a01_require_authority$;

-- security_invoker does not make app roles safe when they themselves have
-- BYPASSRLS; runtime privileges and a trusted per-venture membership boundary
-- still need independent qualification. No direct runtime grant is introduced.
CREATE OR REPLACE VIEW vyndi_vaos_authority.inventory_balance_by_venture
WITH (security_barrier=true, security_invoker=true)
AS
WITH quantity AS (
  SELECT l.venture,l.sku,vyndi_canonical_unit(l.unit) AS unit,
         COALESCE(sum(l.quantity_delta),0::numeric) AS quantity_balance,
         min(l.created_at) AS first_movement_at,
         max(l.created_at) AS last_movement_at
  FROM public.epr_inventory_ledger l
  GROUP BY l.venture,l.sku,vyndi_canonical_unit(l.unit)
), value AS (
  SELECT c.venture,c.sku,vyndi_canonical_unit(c.unit) AS unit,
         COALESCE(sum(c.value_delta_inr),0::numeric) AS inventory_value_inr
  FROM public.epr_inventory_cost_ledger c
  GROUP BY c.venture,c.sku,vyndi_canonical_unit(c.unit)
)
SELECT q.venture,q.sku,q.unit,
       q.quantity_balance,
       COALESCE(v.inventory_value_inr,0::numeric) AS inventory_value_inr,
       CASE WHEN q.quantity_balance>0::numeric
            THEN COALESCE(v.inventory_value_inr,0::numeric)/q.quantity_balance
            ELSE 0::numeric
       END AS weighted_average_cost_inr,
       q.first_movement_at,q.last_movement_at
FROM quantity q
LEFT JOIN value v ON v.venture=q.venture AND v.sku=q.sku AND v.unit=q.unit;

REVOKE ALL ON TABLE vyndi_vaos_authority.inventory_balance_by_venture FROM PUBLIC;
COMMENT ON VIEW vyndi_vaos_authority.inventory_balance_by_venture IS
  'A01 candidate per-venture inventory balance only. No grants, source certification, signed scope or business writes.';
