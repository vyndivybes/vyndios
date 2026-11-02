import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("private dashboard metadata grants only server runtime CRUD and no public/browser access", async () => {
  const sql=await readFile(new URL("../migrations/0195_conversational_bi.sql",import.meta.url),"utf8");
  assert.match(sql,/revoke\s+all\s+on\s+schema\s+vyndi_private\s+from\s+public/i);
  assert.match(sql,/revoke\s+all\s+on\s+vyndi_private\.bi_dashboards\s+from\s+public/i);
  assert.match(sql,/alter\s+table\s+vyndi_private\.bi_dashboards\s+enable\s+row\s+level\s+security/i);
  assert.match(sql,/do\s+\$bi_runtime\$/i);
  assert.match(sql,/end\s+\$bi_runtime\$;/i);
  assert.match(sql,/pg_roles\s+where\s+rolname\s*=\s*'hyperdrive-user'/i);
  assert.match(sql,/grant\s+usage\s+on\s+schema\s+vyndi_private\s+to\s+"hyperdrive-user"/i);
  assert.match(sql,/grant\s+select,\s*insert,\s*update\s+on\s+vyndi_private\.bi_dashboards\s+to\s+"hyperdrive-user"/i);
  assert.doesNotMatch(sql,/grant\s+(?:all|delete|truncate)\b/i);
});
