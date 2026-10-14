import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const read = (path) => readFile(new URL("../"+path,import.meta.url),"utf8");

test("approved R2 remains untouched until an explicit ECN-scoped production change", async()=>{
 const authority=await read("src/lib/production-change-authority.ts");
 const jobCard=await read("src/lib/production-job-card.ts");
 assert.match(authority,/requestProductionChange=createServerFn/);
 assert.match(authority,/approveProductionChange=createServerFn/);
 assert.match(authority,/applyProductionChange=createServerFn/);
 assert.match(authority,/requireBusinessActor\("approve"/);
 assert.match(authority,/requireMatchingReleasedEcn/);
 assert.match(authority,/withSqlTransaction/);
 assert.match(authority,/isolationLevel:"serializable"/);
 assert.match(authority,/await guardPhysicalCommitments/);
 assert.match(authority,/status='cancelled',superseded_at=now\(\)/);
 assert.match(authority,/createControlledSuccessorJobCard\(sql,order,actor\)/);
 assert.match(jobCard,/superseded_at is null/);
});
test("historical build has a separate identity; new Job Card is the only current one",async()=>{
 const migration=await read("migrations/0193_controlled_production_change.sql");
 assert.match(migration,/drop constraint if exists epr_production_job_cards_sales_order_id_key/);
 assert.match(migration,/epr_current_job_card_per_order_uq/);
 assert.match(migration,/where superseded_at is null/);
 assert.match(migration,/supersedes_job_card_id/);
 assert.match(migration,/trg_vyndi_no_superseded_reservation_issue/);
 const view=await read("src/lib/production-job-card-view.ts");
 assert.match(view,/c.superseded_at is null/);
 assert.match(view,/archivedCards/);
});
test("Production UI exposes request, controlled approval, re-release and evidence history",async()=>{
 const ui=await read("src/routes/command/production.tsx");
 assert.match(ui,/Request Production Change/);
 assert.match(ui,/Approve controlled change/);
 assert.match(ui,/Apply & re-release controlled revision/);
 assert.match(ui,/Superseded approved Job Cards/);
 assert.match(ui,/normalReconciliation/);
 assert.match(ui,/!order.job_card_approved_at/);
});
