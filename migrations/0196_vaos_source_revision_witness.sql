-- P0 A01: forward-only, server-private, commit-aware *candidate* source witness.
-- Metadata only: do not rewrite business data, invent historical CDC, or confer
-- source-of-record authority. Bounded signed reads remain SOURCE_UNVERIFIED.
--
-- The singleton row is updated transactionally (not a PostgreSQL sequence).
-- Its row lock serializes concurrent writers covering these source relations
-- until commit/rollback. Observations must query the witness AND source rows in
-- the same SQL snapshot. A new installation has an UNKNOWN historical baseline.
--
-- Seven direct/transitive source dependencies (Neon pg_rewrite inspection):
-- inventory: epr_inventory_ledger + epr_inventory_cost_ledger
-- shortages: both ledgers + epr_inventory_reservations +
--            epr_production_job_card_lines + epr_production_job_cards
-- open purchase orders: vyndi_purchase_orders + epr_production_job_cards
--                       + vyndi_sales_orders (demand-lineage joins)
--
-- NOT YET qualified: tenant isolation, concurrent writers / contention SLO,
-- source-to-VAOS signed attestation, full multi-page canonical enumeration,
-- external restore/replay baseline, maker/checker or A01 mission closure.
CREATE SCHEMA IF NOT EXISTS vyndi_vaos_authority;
REVOKE ALL ON SCHEMA vyndi_vaos_authority FROM PUBLIC;

CREATE TABLE IF NOT EXISTS vyndi_vaos_authority.source_revision (
  source_key text PRIMARY KEY CHECK (source_key = 'A01_ONTOLOGY_V1'),
  generation_id uuid NOT NULL DEFAULT gen_random_uuid(),
  revision bigint NOT NULL DEFAULT 0 CHECK (revision >= 0),
  seeded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE vyndi_vaos_authority.source_revision ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON vyndi_vaos_authority.source_revision FROM PUBLIC;

-- Baseline generation is NOT historical change provenance. Insert is idempotent.
INSERT INTO vyndi_vaos_authority.source_revision (source_key)
VALUES ('A01_ONTOLOGY_V1')
ON CONFLICT (source_key) DO NOTHING;

-- Private SECURITY DEFINER trigger permits limited application DML roles to
-- advance the witness without granting them direct UPDATE/DELETE on it.
-- All referenced SQL names are schema qualified; search_path is constrained.
CREATE OR REPLACE FUNCTION vyndi_vaos_authority.bump_source_revision()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog
AS $a01_source_revision$
BEGIN
  UPDATE vyndi_vaos_authority.source_revision
     SET revision = revision + 1
   WHERE source_key = 'A01_ONTOLOGY_V1';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'VYNDI_A01_SOURCE_REVISION_MISSING';
  END IF;
  RETURN NULL; -- AFTER STATEMENT trigger; never changes business rows.
END;
$a01_source_revision$;
REVOKE ALL ON FUNCTION vyndi_vaos_authority.bump_source_revision() FROM PUBLIC;

DO $a01_install_hooks$
DECLARE
  source_table text;
BEGIN
  -- Stronger than the books audit: includes the line and reservation relations.
  -- Fail migration atomically if a required relation is absent or is not a table.
  FOREACH source_table IN ARRAY ARRAY[
    'epr_inventory_ledger',
    'epr_inventory_cost_ledger',
    'epr_inventory_reservations',
    'epr_production_job_card_lines',
    'epr_production_job_cards',
    'vyndi_purchase_orders',
    'vyndi_sales_orders'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = source_table
        AND c.relkind IN ('r','p')
    ) THEN
      RAISE EXCEPTION 'VYNDI_A01_REQUIRED_SOURCE_TABLE_MISSING: %', source_table;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_trigger t
      WHERE t.tgname = 'trg_vyndi_a01_source_revision'
        AND t.tgrelid = pg_catalog.to_regclass('public.' || source_table)
        AND NOT t.tgisinternal
    ) THEN
      EXECUTE pg_catalog.format(
        'CREATE TRIGGER trg_vyndi_a01_source_revision AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE ON public.%I FOR EACH STATEMENT EXECUTE FUNCTION vyndi_vaos_authority.bump_source_revision()',
        source_table
      );
    END IF;
    EXECUTE pg_catalog.format(
      'ALTER TABLE public.%I ENABLE ALWAYS TRIGGER trg_vyndi_a01_source_revision',
      source_table
    );
  END LOOP;
END;
$a01_install_hooks$;

-- Only a server-side, provisioned app role may *read* revision metadata.
-- Source RLS / tenant attribution must be separately audited. This never
-- grants direct write rights, nor gives any browser/anonymous role access.
DO $a01_server_read$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname='hyperdrive-user') THEN
    EXECUTE 'GRANT USAGE ON SCHEMA vyndi_vaos_authority TO "hyperdrive-user"';
    EXECUTE 'GRANT SELECT ON vyndi_vaos_authority.source_revision TO "hyperdrive-user"';
    IF NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_policies
      WHERE schemaname='vyndi_vaos_authority'
        AND tablename='source_revision'
        AND policyname='a01_server_read_revision'
    ) THEN
      EXECUTE 'CREATE POLICY a01_server_read_revision ON vyndi_vaos_authority.source_revision FOR SELECT TO "hyperdrive-user" USING (source_key = ''A01_ONTOLOGY_V1'')';
    END IF;
  END IF;
END;
$a01_server_read$;
