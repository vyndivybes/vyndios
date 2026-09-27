const value = (env, key) => (typeof env?.[key] === "string" ? env[key].trim() : "");

export function productionMigrationContext(env = process.env) {
  if (value(env, "VYNDI_DEPLOYMENT_ENV").toLowerCase() === "production") return true;
  if (value(env, "WORKERS_CI") === "1" || value(env, "WORKERS_CI_BRANCH")) {
    return value(env, "WORKERS_CI_BRANCH") === "main";
  }
  if (value(env, "CF_PAGES") === "1" || value(env, "CF_PAGES_BRANCH")) {
    return value(env, "CF_PAGES_BRANCH") === "main";
  }
  return false;
}

export function destructiveMigrationStatements(sql) {
  const normalized = String(sql)
    .replace(/--.*$/gm, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .toUpperCase();

  const classes = [
    ["DROP TABLE", /\bDROP\s+TABLE\b/],
    ["DROP COLUMN", /\bDROP\s+COLUMN\b/],
    ["TRUNCATE", /\bTRUNCATE\b/],
    ["DELETE WITHOUT WHERE", /\bDELETE\s+FROM\s+[A-Z0-9_."-]+\s*;/],
  ];

  return classes.filter(([, pattern]) => pattern.test(normalized)).map(([name]) => name);
}

export function requireDestructiveMigrationEvidence({ sql, env = process.env, path = "migration" }) {
  const destructive = destructiveMigrationStatements(sql);
  if (!destructive.length || !productionMigrationContext(env)) return destructive;

  const backupRef = value(env, "VYNDI_MIGRATION_BACKUP_REF");
  if (!backupRef) {
    throw new Error(
      `Destructive production migration blocked for ${path}: ${destructive.join(", ")}. Set VYNDI_MIGRATION_BACKUP_REF to controlled recovery evidence.`,
    );
  }
  if (!/^[0-9a-z][0-9a-z._:/-]{5,200}$/i.test(backupRef)) {
    throw new Error(`Destructive production migration blocked for ${path}: VYNDI_MIGRATION_BACKUP_REF is malformed.`);
  }
  return destructive;
}
