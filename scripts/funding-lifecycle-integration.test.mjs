import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { pendingMigrations } from "./migration-plan.mjs";

const here=dirname(fileURLToPath(import.meta.url));
const migrationsDir=join(here,"..","migrations");

async function db(){
  const instance=new PGlite(); await instance.waitReady;
  const files=await readdir(migrationsDir);
  for(const migration of pendingMigrations(files,[])) await instance.exec(await readFile(join(migrationsDir,migration.path),"utf8"));
  return instance;
}

test("loan drawdown links existing cash receipt, interest accrues, repayment reduces cash and outstanding balances",async(t)=>{
  const sql=await db(); t.after(()=>sql.close());

  await sql.query(
    "select save_vyndi_monthly_actual($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)",
    [10,null,null,null,null,5,null,null,null,"TEST:BASE",true,"finance-user","finance"],
  );
  await sql.query(
    "select create_vyndi_funding_loan($1,$2,$3,$4,$5,$6::date,$7::date,$8,$9,$10,$11)",
    ["LOAN-1","Test Bank","FAC-001",20,12,"2026-10-01","2027-10-01","TEST:LOAN","EVID:LOAN","finance-user","finance"],
  );
  await sql.query(
    "select * from post_vyndi_cash_funding_receipt($1,$2,$3::date,$4,$5,$6,$7,$8,$9,$10)",
    ["CASH-LOAN-1",10,"2026-10-02",10,"loan","debt","BANK:LOAN:1","loan drawdown","finance-user","finance"],
  );
  const cashAfterReceipt=await sql.query("select closing_cash from vyndi_monthly_actuals where plan_month=10");
  assert.equal(Number(cashAfterReceipt.rows[0].closing_cash),15);

  const draw=await sql.query(
    "select * from register_vyndi_loan_drawdown($1,$2,$3,$4,$5,$6,$7)",
    ["LOAN-DRAW-1","LOAN-1","CASH-LOAN-1","drawdown","EVID:DRAW","finance-user","finance"],
  );
  assert.equal(Number(draw.rows[0].principal_outstanding_lakh),10);
  const cashAfterDraw=await sql.query("select closing_cash from vyndi_monthly_actuals where plan_month=10");
  assert.equal(Number(cashAfterDraw.rows[0].closing_cash),15,"drawdown registration must not post cash twice");

  const accrued=await sql.query(
    "select * from accrue_vyndi_loan_interest($1,$2,$3::date,$4,$5,$6,$7,$8)",
    ["LOAN-INT-1","LOAN-1","2026-10-31",1,"EVID:INT","monthly accrual","finance-user","finance"],
  );
  assert.equal(Number(accrued.rows[0].accrued_interest_lakh),1);
  assert.equal(Number(accrued.rows[0].total_outstanding_lakh),11);

  const paid=await sql.query(
    "select * from post_vyndi_loan_repayment($1,$2,$3,$4::date,$5,$6,$7,$8,$9,$10)",
    ["LOAN-PAY-1","LOAN-1",10,"2026-10-31",2,0.5,"BANK:LOAN:PAY:1","partial repayment","finance-user","finance"],
  );
  assert.equal(Number(paid.rows[0].principal_outstanding_lakh),8);
  assert.equal(Number(paid.rows[0].accrued_interest_lakh),0.5);
  assert.equal(Number(paid.rows[0].total_outstanding_lakh),8.5);
  assert.equal(Number(paid.rows[0].new_closing_cash_lakh),12.5);

  await assert.rejects(
    sql.query(
      "select * from post_vyndi_loan_repayment($1,$2,$3,$4::date,$5,$6,$7,$8,$9,$10)",
      ["LOAN-PAY-OVER","LOAN-1",10,"2026-11-01",9,0,"BANK:LOAN:PAY:OVER","overpay","finance-user","finance"],
    ),
    /exceeds principal outstanding/i,
  );

  await assert.rejects(
    sql.query("update vyndi_funding_loan_ledger set principal_delta_lakh=0 where id='LOAN-DRAW-1'"),
    /append-only/i,
  );
});

test("grant receipts are tied to verified grant cash and utilisation cannot exceed received funds",async(t)=>{
  const sql=await db(); t.after(()=>sql.close());

  await sql.query(
    "select save_vyndi_monthly_actual($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)",
    [11,null,null,null,null,2,null,null,null,"TEST:BASE",true,"finance-user","finance"],
  );
  await sql.query(
    "select create_vyndi_funding_grant($1,$2,$3,$4,$5,$6::date,$7::date,$8::date,$9,$10,$11,$12)",
    ["GRANT-1","Prototype Grant","Test Agency","AWARD-001",5,"2026-10-01","2026-10-01","2027-03-31","TEST:GRANT","EVID:AWARD","finance-user","finance"],
  );
  await sql.query(
    "select * from post_vyndi_cash_funding_receipt($1,$2,$3::date,$4,$5,$6,$7,$8,$9,$10)",
    ["CASH-GRANT-1",11,"2026-10-03",3,"grant","grant_income","BANK:GRANT:1","grant tranche","finance-user","finance"],
  );
  const receipt=await sql.query(
    "select * from register_vyndi_grant_receipt($1,$2,$3,$4,$5,$6)",
    ["GRANT-REC-1","GRANT-1","CASH-GRANT-1","EVID:GRANT:REC","finance-user","finance"],
  );
  assert.equal(Number(receipt.rows[0].received_lakh),3);
  assert.equal(Number(receipt.rows[0].available_to_utilise_lakh),3);

  let condition=await sql.query(
    "select * from record_vyndi_grant_condition($1,$2,$3,$4,$5,$6::date,$7,$8,$9,$10)",
    ["COND-1","GRANT-1","REPORT-Q1","Submit quarterly report","pending","2026-12-31","EVID:COND:PENDING","pending","finance-user","finance"],
  );
  assert.equal(Number(condition.rows[0].open_condition_count),1);
  condition=await sql.query(
    "select * from record_vyndi_grant_condition($1,$2,$3,$4,$5,$6::date,$7,$8,$9,$10)",
    ["COND-2","GRANT-1","REPORT-Q1","Submit quarterly report","met","2026-12-31","EVID:COND:MET","submitted","finance-user","finance"],
  );
  assert.equal(Number(condition.rows[0].condition_revision),2);
  assert.equal(Number(condition.rows[0].open_condition_count),0);

  const used=await sql.query(
    "select * from post_vyndi_grant_utilisation($1,$2,$3,$4::date,$5,$6,$7,$8,$9,$10,$11)",
    ["GRANT-USE-1","GRANT-1",11,"2026-10-20",2.5,"prototype","EXP-001","EVID:USE","prototype spend","finance-user","finance"],
  );
  assert.equal(Number(used.rows[0].utilised_lakh),2.5);
  assert.equal(Number(used.rows[0].available_to_utilise_lakh),0.5);

  await assert.rejects(
    sql.query(
      "select * from post_vyndi_grant_utilisation($1,$2,$3,$4::date,$5,$6,$7,$8,$9,$10,$11)",
      ["GRANT-USE-OVER","GRANT-1",11,"2026-10-21",1,"prototype","EXP-002","EVID:OVER","overuse","finance-user","finance"],
    ),
    /cannot exceed received grant funds/i,
  );

  const balance=await sql.query("select * from vyndi_funding_grant_balance where grant_id='GRANT-1'");
  assert.equal(Number(balance.rows[0].awarded_lakh),5);
  assert.equal(Number(balance.rows[0].received_lakh),3);
  assert.equal(Number(balance.rows[0].utilised_lakh),2.5);
  assert.equal(Number(balance.rows[0].available_to_utilise_lakh),0.5);
  assert.equal(Number(balance.rows[0].award_not_received_lakh),2);
});
