-- Executed ONLY inside --network none ephemeral PostgreSQL after a successful restore.
-- This reviewer identity and RLS SELECT policy are isolated-test fixtures, never production DDL.
BEGIN;
CREATE ROLE vyndi_restore_readback NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
GRANT USAGE ON SCHEMA vyndi_private TO vyndi_restore_readback;
GRANT SELECT ON TABLE vyndi_private.bi_dashboards TO vyndi_restore_readback;
CREATE POLICY vyndi_isolated_restore_readback_select
  ON vyndi_private.bi_dashboards FOR SELECT TO vyndi_restore_readback USING (true);
COMMIT;

SET ROLE vyndi_restore_readback;
DO $$
DECLARE row_count bigint;
BEGIN
  IF current_user <> 'vyndi_restore_readback' THEN
    RAISE EXCEPTION 'RESTORE_READBACK_IDENTITY_HOLD';
  END IF;
  IF has_table_privilege(current_user, 'vyndi_private.bi_dashboards', 'INSERT,UPDATE,DELETE,TRUNCATE') THEN
    RAISE EXCEPTION 'RESTORE_READBACK_WRITE_PRIVILEGE_HOLD';
  END IF;
  IF has_table_privilege(current_user, 'public."user"', 'SELECT') THEN
    RAISE EXCEPTION 'RESTORE_READBACK_UNRELATED_READ_PRIVILEGE_HOLD';
  END IF;
  SELECT COUNT(*) INTO row_count FROM vyndi_private.bi_dashboards;
  IF row_count <> 1 THEN
    RAISE EXCEPTION 'RESTORE_READBACK_PROTECTED_ROW_HOLD';
  END IF;
END
$$;
RESET ROLE;
