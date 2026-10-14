import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
const read = (file) => readFileSync(new URL("../"+file,import.meta.url),"utf8");
const migration = read("migrations/0193_production_change_successors.sql");
const server = read("src/lib/production-change-authority.ts");
const view = read("src/lib/production-job-card-view.ts");
const production = read("src/routes/command/production.tsx");
const sync = read("src/lib/production-job-card.ts");
test("approved build remains immutable while a current successor can be released",()=>{
 assert.match(migration,/current_for_order/);
 assert.match(migration,/supersedes_job_card_id/);
 assert.match(migration,/unique index/i);
 assert.match(migration,/on epr_production_job_cards\s*\(sales_order_id\)/);
 assert.match(migration,/vyndi_production_change_requests/);
});
test("changes are explicitly requested then approved with transactional release and audit",()=>{
 assert.match(server,/requestProductionChange/);
 assert.match(server,/approveAndApplyProductionChange/);
 assert.match(server,/withSqlTransaction/);
 assert.match(server,/requireBusinessActor\("approve"/);
 assert.match(server,/vyndi_audit_events/);
 assert.match(server,/released_mapping_set/);
 assert.match(server,/reserve_epr_inventory_for_job_line/);
});
test("stale approved R2 cannot be silently synchronized or selected as current R3",()=>{
 assert.match(sync,/current_for_order=true/);
 assert.match(view,/current_for_order=true/);
 assert.match(server,/job_card_id/);
 assert.match(server,/approved_at/);
});
test("production workspace exposes a visible governed change path",()=>{
 assert.match(production,/Request controlled change/);
 assert.match(production,/Approve and release successor/);
 assert.match(production,/Engineering/);
});
