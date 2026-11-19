-- A01 P0 PRIVATE DESIGN CANDIDATE (NOT PRODUCTION AUTHORITY).
-- Real "venture" in epr_inventory_* is an internal stock category, not
-- a validated legal company/tenant. Never join it to these tenant IDs by SKU.
-- This catalog contains NO user data, NO runtime permissions, and NO source
-- transactions. It provides only an isolated contract for later commissioning.
-- Never promote a business read or authorize a write from these rows.
-- Membership approval SHA and source provenance SHA are NOT cryptographic
-- verification: real IdP, tenant attestation, custody and lineage are absent.
-- Before any runtime usage: independently qualify authenticated principal,
-- membership attestation, canonical source FKs, least-privilege non-BYPASSRLS
-- application role, signed source revision and cross-company paging.
CREATE SCHEMA vyndi_a01_tenant_candidate;
REVOKE ALL ON SCHEMA vyndi_a01_tenant_candidate FROM PUBLIC;

CREATE TABLE vyndi_a01_tenant_candidate.company_candidates (
  tenant_id text PRIMARY KEY
    CHECK (tenant_id ~ '^tenant_[a-z][a-z0-9_-]*$'),
  legal_label text NOT NULL CHECK (length(trim(legal_label)) > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);
-- Deny even when a future accidental GRANT makes the private table selectable.
ALTER TABLE vyndi_a01_tenant_candidate.company_candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE vyndi_a01_tenant_candidate.company_candidates FORCE ROW LEVEL SECURITY;

CREATE TABLE vyndi_a01_tenant_candidate.actor_memberships (
  tenant_id text NOT NULL REFERENCES vyndi_a01_tenant_candidate.company_candidates(tenant_id) ON DELETE RESTRICT,
  db_role name NOT NULL,
  membership_state text NOT NULL DEFAULT 'pending'
    CHECK (membership_state IN ('pending','approved','revoked')),
  approval_sha256 text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, db_role),
  CONSTRAINT a01_membership_approval_evidence_check CHECK
    (membership_state <> 'approved' OR approval_sha256 ~ '^[0-9a-f]{64}$')
);
-- Only a real PostgreSQL login identity may observe its own approved row
-- in this isolated fixture. This is NOT an app-server OAuth integration.
ALTER TABLE vyndi_a01_tenant_candidate.actor_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE vyndi_a01_tenant_candidate.actor_memberships FORCE ROW LEVEL SECURITY;
CREATE POLICY a01_member_self_only
ON vyndi_a01_tenant_candidate.actor_memberships
FOR SELECT
USING (db_role::text = current_user::text AND membership_state = 'approved');

CREATE TABLE vyndi_a01_tenant_candidate.source_ownership_candidates (
  entity_type text NOT NULL
    CHECK (entity_type IN (
      'inventory_ledger', 'inventory_cost_ledger', 'inventory_reservation',
      'job_card', 'purchase_order', 'sales_order')),
  entity_id text NOT NULL CHECK (length(trim(entity_id)) > 0),
  tenant_id text NOT NULL
    REFERENCES vyndi_a01_tenant_candidate.company_candidates(tenant_id) ON DELETE RESTRICT,
  attribution_state text NOT NULL DEFAULT 'candidate'
    CHECK (attribution_state IN ('candidate','observed','revoked')),
  provenance_sha256 text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (entity_type,entity_id),
  CONSTRAINT a01_observed_provenance_format_check CHECK
    (attribution_state <> 'observed' OR provenance_sha256 ~ '^[0-9a-f]{64}$')
);
-- No policy for INSERT/UPDATE/DELETE; a future invoker with only SELECT
-- cannot mutate other companies' ownership or any authorizations.
ALTER TABLE vyndi_a01_tenant_candidate.source_ownership_candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE vyndi_a01_tenant_candidate.source_ownership_candidates FORCE ROW LEVEL SECURITY;
CREATE POLICY a01_attribution_member_only
ON vyndi_a01_tenant_candidate.source_ownership_candidates
FOR SELECT
USING (
  attribution_state='observed'
  AND EXISTS (
    SELECT 1
    FROM vyndi_a01_tenant_candidate.actor_memberships m
    WHERE m.tenant_id = source_ownership_candidates.tenant_id
      AND m.db_role::text = current_user::text
      AND m.membership_state = 'approved'
  )
);

CREATE VIEW vyndi_a01_tenant_candidate.visible_ownership_candidates
WITH (security_invoker=true,security_barrier=true)
AS SELECT tenant_id,entity_type,entity_id,
          false::boolean AS source_completeness_verified,
          false::boolean AS business_write_authorized
FROM vyndi_a01_tenant_candidate.source_ownership_candidates
WHERE attribution_state = 'observed';

REVOKE ALL ON ALL TABLES IN SCHEMA vyndi_a01_tenant_candidate FROM PUBLIC;
COMMENT ON SCHEMA vyndi_a01_tenant_candidate IS
 'A01 tenant mapping prototype only. No runtime role grants, no verified identity, no canonical business owner lineage, no live data or source-certification authority.';
COMMENT ON VIEW vyndi_a01_tenant_candidate.visible_ownership_candidates IS
 'Candidate-only RLS scope. Synthetic test actors demonstrate denial but do not confer app OAuth tenant membership; source completeness and writes are never authorized.';
