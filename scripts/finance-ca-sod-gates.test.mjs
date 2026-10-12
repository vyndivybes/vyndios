import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../src/lib/finance/statutory-authority.ts", import.meta.url), "utf8");

test("bank approval enforces independent actor and single approval in SQL", () => {
  assert.match(source, /update epr_finance_bank_reconciliation_sessions set approved_by=\$2[\s\S]*?where id=\$1 and status='reconciled' and prepared_by is not null and prepared_by <> \$2 and approved_by is null returning id/);
});
test("CA pack approval rejects self-approval and replay in SQL", () => {
  assert.match(source, /update epr_finance_ca_evidence_packs set status='approved'[\s\S]*?where id=\$1 and status='review_ready' and blocker_count=0 and generated_by is not null and generated_by <> \$2 and approved_by is null returning id/);
});
test("hard close and review-ready cannot bypass blockers", () => {
  assert.match(source, /if \(blockerCount>0\) throw new Error/);
  assert.match(source, /blockerCount===0 && \["soft_closed","hard_closed"\]/);
});

test("all thirteen statutory blockers remain wired into hard-close admission", () => {
  const names = ["unmatched_bank","gst_evidence","unverified_input_itc","pending_supplier_itc",
    "invoice_tax"," as irn"," as payroll"," as posting"," as assets",
    "tb_difference","approved_bank_reconciliations","posted_stocktakes","open_stocktakes"];
  for (const name of names) assert.ok(source.includes(name), `missing close gate: ${name}`);
  assert.match(source, /const blockerCount = blockers\.unmatchedBank/);
  assert.match(source, /if \(blockerCount>0\) throw new Error/);
});

test("isolated PostgreSQL enforces maker/checker and replay predicates", async (t) => {
  const { PGlite } = await import("@electric-sql/pglite");
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`
    create table epr_finance_bank_reconciliation_sessions (
      id text primary key, status text not null, prepared_by text,
      approved_by text, approved_at timestamptz, evidence_reference text
    );
    create table epr_finance_ca_evidence_packs (
      id text primary key, status text not null, blocker_count integer not null,
      generated_by text, approved_by text, approved_at timestamptz, evidence_reference text
    );
    insert into epr_finance_bank_reconciliation_sessions(id,status,prepared_by)
      values ('bank-normal','reconciled','maker'),('bank-unknown','reconciled',null);
    insert into epr_finance_ca_evidence_packs(id,status,blocker_count,generated_by)
      values ('pack-normal','review_ready',0,'maker'),('pack-unknown','review_ready',0,null),
        ('pack-blocked','review_ready',1,'maker'),('pack-draft','draft',0,'maker');
  `);
  const bankSQL = `update epr_finance_bank_reconciliation_sessions
    set approved_by=$2, approved_at=now(), evidence_reference=$3
    where id=$1 and status='reconciled' and prepared_by is not null
      and prepared_by <> $2 and approved_by is null returning id`;
  const packSQL = `update epr_finance_ca_evidence_packs
    set status='approved',approved_by=$2,approved_at=now(),evidence_reference=$3
    where id=$1 and status='review_ready' and blocker_count=0
      and generated_by is not null and generated_by <> $2
      and approved_by is null returning id`;
  for (const [sql, record, actor, expected] of [
    [bankSQL,"bank-normal","maker",0], [bankSQL,"bank-unknown","checker",0],
    [bankSQL,"bank-normal","checker",1], [bankSQL,"bank-normal","checker-2",0],
    [packSQL,"pack-normal","maker",0], [packSQL,"pack-unknown","checker",0],
    [packSQL,"pack-blocked","checker",0], [packSQL,"pack-draft","checker",0],
    [packSQL,"pack-normal","checker",1], [packSQL,"pack-normal","checker-2",0],
  ]) {
    const result = await db.query(sql, [record, actor, "TEST-EVIDENCE"]);
    assert.equal(result.rows.length, expected, `${record}/${actor} must return ${expected} approved rows`);
  }
});
