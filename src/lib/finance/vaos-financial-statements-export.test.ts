import test from "node:test";
import assert from "node:assert/strict";
import {readVaosFinancialStatements,validateFinanceStatementPeriod} from "./vaos-financial-statements-export.ts";

test("signed finance read uses complete posted ledger basis, not a 100-row sample",async()=>{
 const ledger=[
  {journal_id:"S1",entry_date:"2026-10-04",source_type:"sales_invoice",source_id:"S1",account_code:"1100",debit_inr:100,credit_inr:0},
  {journal_id:"S1",entry_date:"2026-10-04",source_type:"sales_invoice",source_id:"S1",account_code:"4000",debit_inr:0,credit_inr:100},
  {journal_id:"C1",entry_date:"2026-10-05",source_type:"dispatch_cogs",source_id:"C1",account_code:"5000",debit_inr:60,credit_inr:0},
  {journal_id:"C1",entry_date:"2026-10-05",source_type:"dispatch_cogs",source_id:"C1",account_code:"1220",debit_inr:0,credit_inr:60},
 ];
 const statements=await readVaosFinancialStatements({
  query:async<T>(query:string,params?:unknown[]):Promise<T[]>=>{
   assert.ok(params?.length);
   if(query.includes("epr_finance_general_ledger")){
    assert.match(query,/entry_date <= \$1::date/);
    assert.doesNotMatch(query,/limit\s+100/i);
    return ledger as T[];
   }
   return [] as T[];
  }
 },{fromDate:"2026-10-01",toDate:"2026-10-15"});
 assert.equal(statements.readOnly,true);
 assert.equal(statements.completeLedgerThroughDate,true);
 assert.equal(statements.statements.evidence.periodJournalCount,2);
 assert.equal(statements.statements.trading.accrual.resultInr,40);
});
test("financial period is bounded and rejects invalid future/dates",()=>{
 assert.deepEqual(validateFinanceStatementPeriod({fromDate:"2026-10-01",toDate:"2026-10-15"}),
  {fromDate:"2026-10-01",toDate:"2026-10-15"});
 for(const value of [
  {fromDate:"2026-02-30",toDate:"2026-10-15"},
  {fromDate:"2025-01-01",toDate:"2026-10-15"},
  {fromDate:"2026-10-01",toDate:"2099-01-01"},
  {fromDate:"2026-10-15",toDate:"2026-10-01"}
 ])assert.throws(()=>validateFinanceStatementPeriod(value),/FINANCE_STATEMENT_PERIOD_INVALID/);
});
