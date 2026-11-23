-- A01 P0: PRIVATE, UNGRANTED candidate for business-object owner lineage.
-- Must be applied ONLY after 0210_a01_private_tenant_ownership_candidate.sql.
-- This migration does not add tenant columns or alter any source ERP row/view.
-- Tenant evidence in this model is SYNTHETIC and NOT verified by an IdP.
-- Never use these views to authorize business writes, source certificates or
-- cross-tenant reads. Actor proof, real FK owner lineage, stable source
-- revisions, complete pagination and non-BYPASSRLS runtime remain HOLD.
--
-- No runtime grants and no RLS SELECT policies are provided.

CREATE TABLE vyndi_a01_tenant_candidate.a01_membership_events (
  event_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES vyndi_a01_tenant_candidate.company_candidates(tenant_id) ON DELETE RESTRICT,
  principal_id text NOT NULL CHECK (length(trim(principal_id)) > 0),
  event_type text NOT NULL CHECK (event_type IN ('GRANT','REVOKE')),
  evidence_digest text NOT NULL CHECK (evidence_digest ~ '^[0-9a-f]{64}$'),
  approved_by text NOT NULL CHECK (length(trim(approved_by)) > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT a01_event_checker_not_principal CHECK (principal_id <> approved_by)
);
CREATE INDEX a01_membership_events_lookup
 ON vyndi_a01_tenant_candidate.a01_membership_events(tenant_id,principal_id,event_id DESC);

CREATE TABLE vyndi_a01_tenant_candidate.a01_object_owner_candidates (
  object_type text NOT NULL CHECK (object_type IN
   ('sales_order','job_card','job_line','reservation','purchase_order')),
  object_id text NOT NULL CHECK (length(trim(object_id)) > 0),
  tenant_id text NOT NULL REFERENCES vyndi_a01_tenant_candidate.company_candidates(tenant_id) ON DELETE RESTRICT,
  source_digest text NOT NULL CHECK (source_digest ~ '^[0-9a-f]{64}$'),
  source_revision text NOT NULL CHECK (length(trim(source_revision)) > 0),
  bound_by text NOT NULL CHECK (length(trim(bound_by)) > 0),
  reviewed_by text NOT NULL CHECK (length(trim(reviewed_by)) > 0),
  bound_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (object_type,object_id),
  CONSTRAINT a01_owner_maker_checker_distinct CHECK (bound_by <> reviewed_by)
);
CREATE INDEX a01_object_owner_candidates_tenant_idx
 ON vyndi_a01_tenant_candidate.a01_object_owner_candidates(tenant_id,object_type);

CREATE FUNCTION vyndi_a01_tenant_candidate.a01_deny_mutation()
RETURNS trigger LANGUAGE plpgsql AS $a01_deny$
BEGIN
  RAISE EXCEPTION 'A01 candidate ownership and membership history is append-only.';
END;
$a01_deny$;
CREATE TRIGGER a01_member_history_append_only BEFORE UPDATE OR DELETE
 ON vyndi_a01_tenant_candidate.a01_membership_events
 FOR EACH ROW EXECUTE FUNCTION vyndi_a01_tenant_candidate.a01_deny_mutation();
CREATE TRIGGER a01_owner_binding_append_only BEFORE UPDATE OR DELETE
 ON vyndi_a01_tenant_candidate.a01_object_owner_candidates
 FOR EACH ROW EXECUTE FUNCTION vyndi_a01_tenant_candidate.a01_deny_mutation();

-- No policy exists on these two tables. Even an accidental future SELECT
-- grant would produce no rows for a non-bypass role. Only a future reviewed
-- identity/source authorization migration may change that.
ALTER TABLE vyndi_a01_tenant_candidate.a01_membership_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE vyndi_a01_tenant_candidate.a01_membership_events FORCE ROW LEVEL SECURITY;
ALTER TABLE vyndi_a01_tenant_candidate.a01_object_owner_candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE vyndi_a01_tenant_candidate.a01_object_owner_candidates FORCE ROW LEVEL SECURITY;

-- Critical: the legacy 0210 candidate RLS policy reads a mutable approval.
-- A later immutable REVOKE event MUST also revoke the observed-source SELECT,
-- even when actor_memberships still says approved. Missing event means HOLD.
-- The event stream still has NO runtime grants. The fixture grants SELECT only
-- to its synthetic non-BYPASSRLS roles in disposable PostgreSQL.
CREATE POLICY a01_member_event_self_only
 ON vyndi_a01_tenant_candidate.a01_membership_events FOR SELECT
 USING (principal_id=current_user::text);

DROP POLICY a01_attribution_member_only
 ON vyndi_a01_tenant_candidate.source_ownership_candidates;
CREATE POLICY a01_attribution_member_only
 ON vyndi_a01_tenant_candidate.source_ownership_candidates FOR SELECT
 USING (
   attribution_state='observed'
   AND EXISTS (
     SELECT 1 FROM vyndi_a01_tenant_candidate.actor_memberships m
     WHERE m.tenant_id=source_ownership_candidates.tenant_id
       AND m.db_role::text=current_user::text
       AND m.membership_state='approved'
   )
   AND (
     SELECT e.event_type
     FROM vyndi_a01_tenant_candidate.a01_membership_events e
     WHERE e.tenant_id=source_ownership_candidates.tenant_id
       AND e.principal_id=current_user::text
     ORDER BY e.event_id DESC LIMIT 1
   )='GRANT'
 );

CREATE VIEW vyndi_a01_tenant_candidate.a01_member_state_candidate
WITH (security_barrier=true,security_invoker=true)
AS
WITH latest AS (
 SELECT DISTINCT ON (tenant_id,principal_id)
  tenant_id,principal_id,event_type
 FROM vyndi_a01_tenant_candidate.a01_membership_events
 ORDER BY tenant_id,principal_id,event_id DESC
)
SELECT tenant_id,principal_id,(event_type='GRANT')::boolean AS is_active
FROM latest;

-- Each reservation must have immutable *candidate* bindings for itself,
-- job-card, line and sales order. Every parent and revision must agree.
-- Matching bindings only produce an UNVERIFIED CANDIDATE, never authority.
CREATE VIEW vyndi_a01_tenant_candidate.a01_reservation_tenant_lineage_candidate
WITH (security_barrier=true,security_invoker=true)
AS
WITH checked AS (
 SELECT r.id AS reservation_id,
   own_r.tenant_id AS tentative_tenant,
   (
     own_r.tenant_id IS NOT NULL
     AND own_r.tenant_id=own_j.tenant_id
     AND own_r.tenant_id=own_l.tenant_id
     AND own_r.tenant_id=own_s.tenant_id
     AND j.id IS NOT NULL AND l.id IS NOT NULL AND s.id IS NOT NULL
     AND j.id=r.job_card_id AND l.job_card_id=j.id
     AND j.sales_order_id=r.sales_order_id
     AND s.id=r.sales_order_id
     AND s.revision=j.sales_order_revision
     AND r.sales_order_revision=j.sales_order_revision
     AND l.sku=r.sku
     AND public.vyndi_canonical_unit(l.unit)=public.vyndi_canonical_unit(r.unit)
   ) IS TRUE AS candidate_parent_chain_matches
 FROM public.epr_inventory_reservations r
 LEFT JOIN public.epr_production_job_cards j ON j.id=r.job_card_id
 LEFT JOIN public.epr_production_job_card_lines l ON l.id=r.job_card_line_id
 LEFT JOIN public.vyndi_sales_orders s ON s.id=r.sales_order_id
 LEFT JOIN vyndi_a01_tenant_candidate.a01_object_owner_candidates own_r
   ON own_r.object_type='reservation' AND own_r.object_id=r.id
 LEFT JOIN vyndi_a01_tenant_candidate.a01_object_owner_candidates own_j
   ON own_j.object_type='job_card' AND own_j.object_id=j.id
 LEFT JOIN vyndi_a01_tenant_candidate.a01_object_owner_candidates own_l
   ON own_l.object_type='job_line' AND own_l.object_id=l.id
 LEFT JOIN vyndi_a01_tenant_candidate.a01_object_owner_candidates own_s
   ON own_s.object_type='sales_order' AND own_s.object_id=s.id
)
SELECT reservation_id,
 CASE WHEN candidate_parent_chain_matches THEN tentative_tenant ELSE NULL::text END AS candidate_tenant_id,
 CASE WHEN candidate_parent_chain_matches
   THEN 'CANDIDATE_ONLY_UNVERIFIED'::text
   ELSE 'HOLD_OWNER_OR_PARENT_MISMATCH'::text END AS lineage_status,
 false::boolean AS source_authority_verified,
 false::boolean AS production_write_authorized
FROM checked;

-- POs with null/unknown job parent or missing multi-entity owner chain HOLD.
CREATE VIEW vyndi_a01_tenant_candidate.a01_purchase_order_tenant_lineage_candidate
WITH (security_barrier=true,security_invoker=true)
AS
WITH checked AS (
 SELECT p.id AS purchase_order_id, own_p.tenant_id AS tentative_tenant,
   (
      own_p.tenant_id IS NOT NULL
      AND own_p.tenant_id=own_j.tenant_id
      AND own_p.tenant_id=own_s.tenant_id
      AND j.id IS NOT NULL AND s.id IS NOT NULL
      AND p.job_card_id=j.id AND j.sales_order_id=s.id
      AND j.sales_order_revision=s.revision
   ) IS TRUE AS candidate_parent_chain_matches
 FROM public.vyndi_purchase_orders p
 LEFT JOIN public.epr_production_job_cards j ON j.id=p.job_card_id
 LEFT JOIN public.vyndi_sales_orders s ON s.id=j.sales_order_id
 LEFT JOIN vyndi_a01_tenant_candidate.a01_object_owner_candidates own_p
   ON own_p.object_type='purchase_order' AND own_p.object_id=p.id
 LEFT JOIN vyndi_a01_tenant_candidate.a01_object_owner_candidates own_j
   ON own_j.object_type='job_card' AND own_j.object_id=j.id
 LEFT JOIN vyndi_a01_tenant_candidate.a01_object_owner_candidates own_s
   ON own_s.object_type='sales_order' AND own_s.object_id=s.id
)
SELECT purchase_order_id,
 CASE WHEN candidate_parent_chain_matches THEN tentative_tenant ELSE NULL::text END AS candidate_tenant_id,
 CASE WHEN candidate_parent_chain_matches
   THEN 'CANDIDATE_ONLY_UNVERIFIED'::text
   ELSE 'HOLD_OWNER_OR_PARENT_MISMATCH'::text END AS lineage_status,
 false::boolean AS source_authority_verified,
 false::boolean AS production_write_authorized
FROM checked;

REVOKE ALL ON vyndi_a01_tenant_candidate.a01_membership_events FROM PUBLIC;
REVOKE ALL ON vyndi_a01_tenant_candidate.a01_object_owner_candidates FROM PUBLIC;
REVOKE ALL ON vyndi_a01_tenant_candidate.a01_member_state_candidate FROM PUBLIC;
REVOKE ALL ON vyndi_a01_tenant_candidate.a01_reservation_tenant_lineage_candidate FROM PUBLIC;
REVOKE ALL ON vyndi_a01_tenant_candidate.a01_purchase_order_tenant_lineage_candidate FROM PUBLIC;
REVOKE ALL ON FUNCTION vyndi_a01_tenant_candidate.a01_deny_mutation() FROM PUBLIC;
COMMENT ON VIEW vyndi_a01_tenant_candidate.a01_reservation_tenant_lineage_candidate IS
 'Draft object-owner chain only. No runtime grants; matching candidate is never authenticated tenancy, source completeness or write authority.';
COMMENT ON VIEW vyndi_a01_tenant_candidate.a01_purchase_order_tenant_lineage_candidate IS
 'Draft PO lineage only. Incomplete or contradictory parents HOLD; matching candidate never authorizes live sourcing or purchasing.';
