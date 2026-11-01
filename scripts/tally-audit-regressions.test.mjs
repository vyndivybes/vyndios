import test from "node:test";
import assert from "node:assert/strict";
import { createVoucherJournal } from "../src/lib/finance/voucher-journals.ts";
import { validateJournal } from "../src/lib/finance/general-ledger.ts";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
const voucher = { id:"V",reference:"DOC",entryDate:"2026-10-16",kind:"receipt",amountInr:1,debitAccountCode:"1000",creditAccountCode:"1100" };
test("voucher rejects impossible dates and accounts equal after normalization", () => {
  assert.throws(() => createVoucherJournal({...voucher,entryDate:"2026-02-30"}), /date/i);
  assert.throws(() => createVoucherJournal({...voucher,debitAccountCode:"1000 ",creditAccountCode:" 1000"}), /different/i);
});
test("SQL posting rejects invalid paise and conflicting retries, without partial journals", async t => {
  const db = new PGlite(); t.after(() => db.close());
  await db.exec(`create table epr_finance_journals(id text primary key,entry_date date,source_type text,source_id text,description text,status text,posted_at timestamptz);
    create table epr_finance_journal_lines(journal_id text,line_no int,account_code text,debit_inr numeric,credit_inr numeric,memo text)`);
  await db.exec(await readFile(new URL("../migrations/0194_finance_journal_exact_paise.sql",import.meta.url),"utf8"));
  const post = (id, lines, source=id) => db.query(`select post_vyndi_finance_journal($1,'2026-10-16','test',$2,'Test',$3::jsonb) as id`,[id,source,JSON.stringify(lines)]);
  const lines = (d,c) => [{accountCode:"1000",debitInr:d},{accountCode:"1100",creditInr:c}];
  for(const [d,c] of [[1,0.99],[-1,1],[1.001,1.001],["NaN",1],[Number.MAX_SAFE_INTEGER,Number.MAX_SAFE_INTEGER]]) await assert.rejects(() => post("BAD",lines(d,c)));
  assert.equal((await post("GOOD",lines(1.01,1.01))).rows[0].id,"GOOD");
  assert.equal((await post("RETRY",lines(1.01,1.01),"GOOD")).rows[0].id,"GOOD");
  await assert.rejects(() => post("CONFLICT",lines(2,2),"GOOD"),/different content/);
  assert.equal((await db.query(`select count(*)::int as n from epr_finance_journals`)).rows[0].n,1);
});
test("journal rejects even one paise of imbalance and unsafe individual or aggregate paise", () => {
  assert.equal(validateJournal({lines:[{accountCode:"1000",debitInr:1},{accountCode:"1100",creditInr:0.99}]}).valid,false);
  assert.equal(validateJournal({lines:[{accountCode:"1000",debitInr:Number.MAX_SAFE_INTEGER},{accountCode:"1100",creditInr:Number.MAX_SAFE_INTEGER}]}).valid,false);
  const lines = Array.from({length:4},(_,index) => index%2 ? {accountCode:"1100",creditInr:50_000_000_000_000} : {accountCode:"1000",debitInr:50_000_000_000_000});
  assert.equal(validateJournal({lines}).valid,false);
  assert.throws(() => createVoucherJournal({...voucher,amountInr:Number.MAX_SAFE_INTEGER}),/amount/i);
});
