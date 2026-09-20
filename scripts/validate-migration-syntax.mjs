#!/usr/bin/env node
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");

function validateDollarQuotes(name, sql) {
  const errors = [];

  // A lone "$" cannot delimit a PostgreSQL dollar-quoted function body.
  const invalidOpen = /(^|\n)[^\n]*\bas \$(?!\$|[A-Za-z_][A-Za-z0-9_]*\$)/g;
  const invalidClose = /(^|\n)\$;\s*(?=\n|$)/g;

  if (invalidOpen.test(sql)) {
    errors.push("single-dollar PL/pgSQL opening delimiter (use $$ or a named tag)");
  }
  if (invalidClose.test(sql)) {
    errors.push("single-dollar PL/pgSQL closing delimiter (use $$ or the matching named tag)");
  }

  // Every explicit dollar-quote token used as a delimiter must be paired.
  // This catches truncated $$ / $tag$ function bodies without parsing SQL semantics.
  const tokens = sql.match(/\$\$|\$[A-Za-z_][A-Za-z0-9_]*\$/g) ?? [];
  const counts = new Map();
  for (const token of tokens) counts.set(token, (counts.get(token) ?? 0) + 1);
  for (const [token, count] of counts) {
    if (count % 2 !== 0) errors.push(`unbalanced PostgreSQL dollar-quote delimiter ${token} (${count} occurrence(s))`);
  }

  return errors.map((message) => `${name}: ${message}`);
}

const entries = (await readdir(migrationsDir, { withFileTypes: true }))
  .filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
  .map((entry) => entry.name)
  .sort();

const failures = [];
for (const name of entries) {
  const sql = await readFile(join(migrationsDir, name), "utf8");
  failures.push(...validateDollarQuotes(name, sql));
}

if (failures.length) {
  console.error("[migration-syntax] FAILED");
  for (const failure of failures) console.error(` - ${failure}`);
  process.exit(1);
}

console.log(
  `[migration-syntax] PASS — ${entries.length} root migration file(s) checked for malformed or unbalanced PostgreSQL dollar quoting.`,
);
