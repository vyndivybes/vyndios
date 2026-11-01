import test from "node:test";
import assert from "node:assert/strict";
import { buildFinancialStatements, type StatementLedgerLine } from "./financial-statements.ts";
import { projectFinancialIntelligence } from "./financial-intelligence.ts";

function journal(id: string, date: string, sourceType: string, lines: Array<[string,number,number]>): StatementLedgerLine[] {
  return lines.map(([accountCode,debitInr,creditInr])=>({journalId:id,entryDate:date,sourceType,sourceId:id,accountCode,debitInr,creditInr}));
}
test("posted cash, eligible direct CAPEX and financing remain separately classified", () => {
 const lines=[
  ...journal("FUND","2026-10-01","equity_funding_receipt",[["1000",200,0],["3000",0,200]]),
  ...journal("RECEIPT","2026-10-04","customer_receipt",[["1000",100,0],["1100",0,100]]),
  ...journal("AP","2026-10-05","supplier_payment",[["2000",30,0],["1000",0,30]]),
  ...journal("ASSET","2026-10-06","fixed_asset_purchase",[["1500",40,0],["1000",0,40]]),
 ];
 const p=buildFinancialStatements({lines,jobCosts:[],fromDate:"2026-10-01",toDate:"2026-10-31"});
 assert.equal(p.cashFlow.directCashCapexInr,40);
 assert.equal(p.cashFlow.rows.find(x=>x.label==="Operating activities")?.amountInr,70);
 assert.equal(p.cashFlow.rows.find(x=>x.label==="Financing activities")?.amountInr,200);
 const bi=projectFinancialIntelligence(p);
 assert.equal(bi.status,"POSTED_ACTUALS");
 assert.equal(bi.operatingCashFlowInr,70);
 assert.equal(bi.directCashCapexInr,40);
 assert.equal(bi.indicativeFreeCashFlowInr,30);
 assert.equal(bi.capexCoverage,"DIRECT_ASSET_BANK_ONLY");
});
test("asset disposal is not silently classified as CAPEX; returns are suppressed without posted activity",()=>{
 const lines=[
  ...journal("FUND","2026-10-01","equity_funding_receipt",[["1000",50,0],["3000",0,50]]),
  ...journal("DISPOSE","2026-10-07","fixed_asset_disposal",[["1000",10,0],["1500",0,10]]),
 ];
 const p=buildFinancialStatements({lines,jobCosts:[],fromDate:"2026-10-01",toDate:"2026-10-31"});
 assert.equal(p.cashFlow.directCashCapexInr,0);
 assert.equal(projectFinancialIntelligence(p).indicativeFreeCashFlowInr,0);
 const zero=buildFinancialStatements({lines:[],jobCosts:[],fromDate:"2026-10-01",toDate:"2026-10-31"});
 const summary=projectFinancialIntelligence(zero);
 assert.equal(summary.status,"NO_POSTED_ACTIVITY");
 assert.equal(summary.indicativeFreeCashFlowInr,null);
 assert.equal(summary.grossMarginPct,null);
 assert.equal(summary.dsoDays,null);
});
test("working capital diagnostics are indicative, date-scoped and not called certified DPO",()=>{
 const lines=[
  ...journal("SALE","2026-10-02","sales_invoice",[["1100",120,0],["4000",0,120]]),
  ...journal("COST","2026-10-02","dispatch_cogs",[["5000",60,0],["1220",0,60]]),
  ...journal("STOCK","2026-10-03","supplier_invoice",[["1200",90,0],["2000",0,90]]),
 ];
 const p=buildFinancialStatements({lines,jobCosts:[],fromDate:"2026-10-01",toDate:"2026-10-31"});
 const k=projectFinancialIntelligence(p);
 assert.equal(k.revenueInr,120);
 assert.equal(k.closingReceivablesInr,120);
 assert.equal(k.closingPayablesInr,90);
 assert.equal(k.dsoDays,31);
 assert.equal(k.payablesToCogsDays,46.5);
 assert.equal(k.dioDays,15.5);
 assert.equal(k.cashConversionCycleProxyDays,0);
 assert.equal(k.grossMarginPct,50);
});
test("unreconciled source is a HOLD and publishes no business KPI values",()=>{
 const p=buildFinancialStatements({lines:journal("FUND","2026-10-01","equity_funding_receipt",[["1000",50,0],["3000",0,50]]),jobCosts:[],fromDate:"2026-10-01",toDate:"2026-10-31"});
 p.cashFlow.reconciliationDifferenceInr=5;
 const k=projectFinancialIntelligence(p);
 assert.equal(k.status,"RECONCILIATION_HOLD");
 assert.equal(k.indicativeFreeCashFlowInr,null);
 assert.equal(k.workingCapitalInr,null);
});
