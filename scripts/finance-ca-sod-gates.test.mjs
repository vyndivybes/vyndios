import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../src/lib/finance/statutory-authority.ts", import.meta.url), "utf8");

test("bank approval enforces independent actor and single approval in SQL", () => {
  assert.match(source, /update epr_finance_bank_reconciliation_sessions set approved_by=\$2[\s\S]*?where id=\$1 and status='reconciled' and prepared_by is distinct from \$2 and approved_by is null returning id/);
});
test("CA pack approval rejects self-approval and replay in SQL", () => {
  assert.match(source, /update epr_finance_ca_evidence_packs set status='approved'[\s\S]*?where id=\$1 and status='review_ready' and blocker_count=0 and generated_by is distinct from \$2 and approved_by is null returning id/);
});
test("hard close and review-ready cannot bypass blockers", () => {
  assert.match(source, /if \(blockerCount>0\) throw new Error/);
  assert.match(source, /blockerCount===0 && \["soft_closed","hard_closed"\]/);
});
