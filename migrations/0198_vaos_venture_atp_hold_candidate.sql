-- A01 P0: PRIVATE, unreleased, conservative ATP observation candidate.
-- Do not replace public ATP or shortages. Do not grant a runtime role access.
-- Never use these candidate numbers to approve procurement or production.
-- Existing epr_inventory_reservations records lack authoritative venture ID:
-- any active reservation forces a GLOBAL terminal HOLD, not a guessed split.
-- If the same SKU+canonical unit appears in >1 venture, that key also HOLDS.
-- Physical quantities are explicitly uncertified even in the single-venture
-- zero-reservation case. Completeness, tenant membership, business action,
-- signed revisions and full source provenance remain NOT qualified.
DO $a01_require_isolated_balance$
BEGIN
  IF pg_catalog.to_regclass('vyndi_vaos_authority.inventory_balance_by_venture') IS NULL THEN
    RAISE EXCEPTION 'A01_PRIVATE_VENTURE_BALANCE_REQUIRED';
  END IF;
END;
$a01_require_isolated_balance$;

-- Deliberately use CREATE, not CREATE OR REPLACE: never silently preserve
-- unexpected grants from an existing object with this name.
CREATE VIEW vyndi_vaos_authority.inventory_atp_hold_candidate
WITH (security_barrier=true, security_invoker=true)
AS
WITH venture_key_count AS MATERIALIZED (
  SELECT sku,unit,count(*)::integer AS venture_count
  FROM vyndi_vaos_authority.inventory_balance_by_venture
  GROUP BY sku,unit
), active_reservation_scope AS MATERIALIZED (
  -- Reservations have NO venture field. Global active count is intentional:
  -- fail all keys closed, including stock keys not named by reservations.
  SELECT count(*)::bigint AS unattributed_active_count
  FROM public.epr_inventory_reservations
  WHERE status='active'
)
SELECT b.venture,b.sku,b.unit,
       b.quantity_balance AS physical_quantity,
       CASE
         WHEN r.unattributed_active_count>0
           THEN 'HOLD_UNATTRIBUTED_ACTIVE_RESERVATIONS'::text
         WHEN k.venture_count>1
           THEN 'HOLD_MULTI_VENTURE_SKU'::text
         ELSE 'CANDIDATE_ONLY_UNVERIFIED'::text
       END AS scope_status,
       CASE
         WHEN r.unattributed_active_count>0 OR k.venture_count>1
           THEN NULL::numeric
         ELSE GREATEST(b.quantity_balance,0::numeric)
       END AS atp_candidate_quantity,
       false::boolean AS source_completeness_verified,
       false::boolean AS action_authorized,
       false::boolean AS production_write_authorized
FROM vyndi_vaos_authority.inventory_balance_by_venture b
JOIN venture_key_count k ON k.sku=b.sku AND k.unit=b.unit
CROSS JOIN active_reservation_scope r;

REVOKE ALL ON vyndi_vaos_authority.inventory_atp_hold_candidate FROM PUBLIC;
COMMENT ON VIEW vyndi_vaos_authority.inventory_atp_hold_candidate IS
 'NO runtime grants. A01 conservative physical quantity candidate only. Shared venture SKU or any active reservation causes HOLD; cannot certify ATP or business action.';
