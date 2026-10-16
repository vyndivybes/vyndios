import test from "node:test";
import assert from "node:assert/strict";
import { buildReceivablesAgingReport } from "../src/lib/finance/receivables-report.ts";
const invoice={id:"I",partyId:"ORDER",issueDate:"2026-09-01",dueDate:"2026-09-15",amountInr:100,status:"issued",creditProfileStatus:"controlled"};
const journal=(id,sourceType,sourceId,entryDate,amount,reversedEntryId)=>({id,sourceType,sourceId,entryDate,reversedEntryId,description:"Synthetic",status:"posted",lines:amount>0?[{accountCode:"1100",debitInr:amount},{accountCode:"4000",creditInr:amount}]:[{accountCode:"1000",debitInr:-amount},{accountCode:"1100",creditInr:-amount}]});
const base=()=>({invoices:[invoice],collections:[],credits:[],refunds:[],journals:[journal("JI","sales_invoice","I","2026-09-01",100)]});
const movement=(id,postedDate,amountInr,status="posted")=>({id,invoiceId:"I",postedDate,amountInr,status});
test("receivable reports preserve credit balances and dated refund/reversal history",()=>{
 const s=base();s.collections.push(movement("C","2026-09-02",100));s.credits.push(movement("CN","2026-09-03",100,"active"));
 s.refunds.push(movement("R","2026-09-04",100,"reversed"));
 s.journals.push(journal("JC","customer_receipt","C","2026-09-02",-100),journal("JN","customer_credit_note","CN","2026-09-03",-100),journal("JR","customer_refund","R","2026-09-04",100),journal("JREV","customer_refund_reversal","R","2026-09-05",-100,"JR"));
 for(const [date,credit] of [["2026-09-03",100],["2026-09-04",0],["2026-09-05",100]]) { const r=buildReceivablesAgingReport(s,date);assert.equal(r.creditBalanceInr,credit);assert.equal(r.totalOutstandingInr,0);assert.equal(r.reconciliation.reconciled,true);assert.equal(r.reconciliation.ledgerBalanceInr,credit ? -credit : 0); }
});
test("legacy missing due dates stay in reconciled balances but are not invented into ageing buckets",()=>{
 const s=base();s.invoices=[{...invoice,dueDate:null,creditProfileStatus:"legacy_unclassified"}];
 const r=buildReceivablesAgingReport(s,"2026-10-16");assert.equal(r.completeAging,false);assert.equal(r.unagedTotalInr,100);assert.equal(r.totalOutstandingInr,100);assert.equal(r.aging.totalOutstandingInr,0);assert.equal(r.reconciliation.reconciled,true);
});
test("partial collections, reversals and unmapped ledger entries have exact dated balances",()=>{
 const s=base();s.collections.push(movement("C","2026-09-02",25,"reversed"));s.journals.push(journal("JC","customer_receipt","C","2026-09-02",-25),journal("REV","customer_receipt_reversal","C","2026-09-04",25,"JC"));
 assert.equal(buildReceivablesAgingReport(s,"2026-09-03").totalOutstandingInr,75);
 assert.equal(buildReceivablesAgingReport(s,"2026-09-04").totalOutstandingInr,100);
 s.journals.push(journal("OPEN","opening","OPEN","2026-09-01",10));assert.equal(buildReceivablesAgingReport(s,"2026-10-16").reconciliation.differenceInr,10);
});
test("missing evidence, excessive credit notes and invalid source amounts cannot produce a report",()=>{
 const s=base();s.journals=[];assert.throws(()=>buildReceivablesAgingReport(s,"2026-10-16"),/Missing posted/);
 const bad=base();bad.invoices=[{...invoice,amountInr:99}];assert.throws(()=>buildReceivablesAgingReport(bad,"2026-10-16"),/mismatch/);
 const over=base();over.credits.push(movement("CN","2026-09-03",101,"active"));over.journals.push(journal("JN","customer_credit_note","CN","2026-09-03",-101));assert.throws(()=>buildReceivablesAgingReport(over,"2026-10-16"),/exceed/);
});
