-- This query returns aggregate, non-sensitive role evidence only.
-- It must run with the SAME BACKUP_READ_URL as the subsequent pg_dump.
WITH app_tables AS (
  SELECT c.oid, c.relrowsecurity
  FROM pg_catalog.pg_class AS c
  JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
  WHERE c.relkind IN ('r', 'p')
    AND n.nspname NOT IN ('pg_catalog', 'information_schema')
    AND n.nspname NOT LIKE 'pg_toast%'
), checks AS (
  SELECT COUNT(*)::integer AS table_count,
         COUNT(*) FILTER (WHERE NOT has_table_privilege(current_user, oid, 'SELECT'))::integer AS missing_select,
         COUNT(*) FILTER (WHERE has_table_privilege(current_user, oid, 'INSERT')
                     OR has_table_privilege(current_user, oid, 'UPDATE')
                     OR has_table_privilege(current_user, oid, 'DELETE')
                     OR has_table_privilege(current_user, oid, 'TRUNCATE'))::integer AS mutation_count,
         COUNT(*) FILTER (WHERE relrowsecurity)::integer AS rls_count
  FROM app_tables
)
SELECT r.rolname, r.rolsuper, r.rolbypassrls, r.rolcreaterole,
       r.rolcreatedb, r.rolcanlogin, checks.table_count,
       checks.missing_select, checks.mutation_count, checks.rls_count
FROM pg_catalog.pg_roles AS r CROSS JOIN checks
WHERE r.rolname = current_user;
