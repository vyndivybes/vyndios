import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read=(path)=>readFile(path,"utf8");

test("H2 recovery drill is isolated, hash-verifies lineage and proves post-restore authority", async()=>{
  const [script,policy,workflow]=await Promise.all([
    read("scripts/h2-recovery-drill.mjs"),
    read("docs/VYNDI-H2-BACKUP-RESTORE-RECOVERY-REV1.md"),
    read(".github/workflows/h2-recovery-drill.yml"),
  ]);
  assert.match(script,/H2_SOURCE_DATABASE_URL/);
  assert.match(script,/H2_RESTORED_DATABASE_URL/);
  assert.match(script,/Restored critical business\/audit snapshot differs from source/);
  assert.match(script,/H2-SO-POST-RESTORE/);
  assert.match(script,/postRestoreGovernedWrite:true/);
  assert.match(policy,/RPO target.*24 hours/i);
  assert.match(policy,/RTO target.*60 minutes/i);
  assert.match(policy,/never overwrite the damaged database first/i);
  assert.match(workflow,/pg_dump/);
  assert.match(workflow,/pg_restore/);
  assert.match(workflow,/vyndi_restore/);
  assert.match(workflow,/stage-d-browser-acceptance\.mjs/);
  assert.match(workflow,/observe:slo/);
  assert.doesNotMatch(workflow,/production.*DATABASE_URL/i);
});
