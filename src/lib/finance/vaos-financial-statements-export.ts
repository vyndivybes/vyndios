import type {SqlRow} from "@/lib/db";
import {buildFinancialStatements, type StatementJobCost, type StatementLedgerLine} from "@/lib/finance/financial-statements";

/** Read-only, complete-to-date ledger basis for the existing VYNDI finance statement engine.
 * Unlike generic bridge record samples this query must not silently truncate P&L actuals.
 */
function calendarDay(v: unknown): v is string {
 return typeof v==="string"&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&
  Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v;
}
export function validateFinanceStatementPeriod(input: Record<string,unknown> = {}){
 const fromDate=input.fromDate,toDate=input.toDate;
 if(!calendarDay(fromDate)||!calendarDay(toDate)||fromDate>toDate||
    toDate>new Date().toISOString().slice(0,10)||
    Date.parse(toDate)-Date.parse(fromDate)>366*86400000){
  throw new Error("FINANCE_STATEMENT_PERIOD_INVALID");
 }
 return {fromDate,toDate};
}
type FinanceSql={query:<T=SqlRow>(sql:string,params?:unknown[])=>Promise<T[]>};
export async function readVaosFinancialStatements(sql: FinanceSql,input: Record<string,unknown> = {}){
 const {fromDate,toDate}=validateFinanceStatementPeriod(input);
 const [ledgerRows,costRows]=await Promise.all([
  sql.query<SqlRow>(
   `select journal_id,entry_date::text as entry_date,source_type,source_id,account_code,debit_inr,credit_inr
      from epr_finance_general_ledger
     where entry_date <= $1::date
     order by entry_date,journal_id,line_no`,[toDate]),
  sql.query<SqlRow>(
   `select distinct on (job_card_id)
      job_card_id,model,planned_quantity,completed_quantity,material_actual_inr,material_standard_inr,
      material_variance_inr,direct_labour_inr,outsourcing_inr,manufacturing_consumables_inr,
      manufacturing_depreciation_inr,support_depreciation_inr,overhead_inr,scrap_inr,rework_inr,
      total_actual_cost_inr,finished_goods_value_inr,wip_value_inr
      from epr_job_cost_snapshots
      where captured_at::date between $1::date and $2::date
      order by job_card_id,captured_at desc`,[fromDate,toDate])
 ]);
 const lines:StatementLedgerLine[]=ledgerRows.map(row=>({
  journalId:String(row.journal_id??""),entryDate:String(row.entry_date??""),
  sourceType:String(row.source_type??""),sourceId:String(row.source_id??""),
  accountCode:String(row.account_code??""),debitInr:Number(row.debit_inr??0),
  creditInr:Number(row.credit_inr??0)
 }));
 const jobCosts:StatementJobCost[]=costRows.map(row=>({
  jobCardId:String(row.job_card_id??""),model:String(row.model??""),
  plannedQuantity:Number(row.planned_quantity??0),completedQuantity:Number(row.completed_quantity??0),
  materialActualInr:Number(row.material_actual_inr??0),materialStandardInr:Number(row.material_standard_inr??0),
  materialVarianceInr:Number(row.material_variance_inr??0),directLabourInr:Number(row.direct_labour_inr??0),
  outsourcingInr:Number(row.outsourcing_inr??0),manufacturingConsumablesInr:Number(row.manufacturing_consumables_inr??0),
  manufacturingDepreciationInr:Number(row.manufacturing_depreciation_inr??0),supportDepreciationInr:Number(row.support_depreciation_inr??0),
  overheadInr:Number(row.overhead_inr??0),scrapInr:Number(row.scrap_inr??0),reworkInr:Number(row.rework_inr??0),
  totalActualCostInr:Number(row.total_actual_cost_inr??0),finishedGoodsValueInr:Number(row.finished_goods_value_inr??0),
  wipValueInr:Number(row.wip_value_inr??0)
 }));
 return {
  schemaVersion:"VYNDI_FINANCE_STATEMENTS_V1",
  readOnly:true,
  sourceBasis:"POSTED_GENERAL_LEDGER_AND_LATEST_PERIOD_JOB_COST",
  completeLedgerThroughDate:true,
  observedAt:new Date().toISOString(),
  statements:buildFinancialStatements({lines,jobCosts,fromDate,toDate})
 };
}
