import test from 'node:test';
import assert from 'node:assert/strict';
import { reconcilePostedStatementsWithTallyCsv } from '../src/lib/finance/tally-ca-session.ts';

const pack={
 period:{fromDate:'2026-04-01',toDate:'2026-10-31'},
 trialBalance:[
  {accountCode:'1000',accountName:'Bank',accountType:'asset',debitInr:500,creditInr:400,balanceInr:100},
  {accountCode:'3000',accountName:'Equity',accountType:'equity',debitInr:0,creditInr:100,balanceInr:-100}
 ],
 evidence:{periodJournalCount:2,periodLineCount:4,throughDateJournalCount:2,latestEntryDate:'2026-10-22',jobCostSnapshotCount:0}
};
const mapping={'Tally Bank':'1000','Tally Equity':'3000'};
const csv='Ledger,Debit,Credit\nTally Bank,100.00,0\nTally Equity,0,100.00\n';
test('actual posted statement values reconcile against manually mapped Tally trial balance',()=>{
 const result=reconcilePostedStatementsWithTallyCsv({pack,tallyCsv:csv,mapping});
 assert.equal(result.status,'reconciled');
 assert.equal(result.caCertified,false);
 assert.equal(result.source,'POSTED_GENERAL_LEDGER');
 assert.equal(result.period.fromDate,'2026-04-01');
 assert.equal(result.tallyRows,2);
 assert.equal(result.diff.differences.length,0);
});
test('unmapped or missing ledgers fail closed',()=>{
 assert.throws(()=>reconcilePostedStatementsWithTallyCsv({pack,tallyCsv:csv,mapping:{'Tally Bank':'1000'}}),/Unmapped/i);
 const missing=reconcilePostedStatementsWithTallyCsv({pack,tallyCsv:'Ledger,Debit,Credit\nTally Bank,100,0\n',mapping});
 assert.equal(missing.status,'blocked');
 assert.equal(missing.diff.differences[0].reason,'missing_in_tally');
});
test('unknown account mapping and reversed debit/credit reject or block',()=>{
 assert.throws(()=>reconcilePostedStatementsWithTallyCsv({pack,tallyCsv:csv,mapping:{...mapping,'Tally Bank':'9999'}}),/Unknown.*account/i);
 const other=reconcilePostedStatementsWithTallyCsv({pack,tallyCsv:'Ledger,Debit,Credit\nTally Bank,0,100\nTally Equity,0,100\n',mapping});
 assert.equal(other.status,'blocked');
});
test('empty accounting actuals cannot be reconciled',()=>{
 assert.throws(()=>reconcilePostedStatementsWithTallyCsv({pack:{...pack,trialBalance:[],evidence:{...pack.evidence,throughDateJournalCount:0}},tallyCsv:csv,mapping}),/posted|empty/i);
});
test('reject unsafe accounting period or contradictory server balance',()=>{
 assert.throws(()=>reconcilePostedStatementsWithTallyCsv({pack:{...pack,period:{fromDate:'2026-11-02',toDate:'2026-10-31'}},tallyCsv:csv,mapping}),/period/i);
 assert.throws(()=>reconcilePostedStatementsWithTallyCsv({pack:{...pack,trialBalance:[{...pack.trialBalance[0],balanceInr:999},pack.trialBalance[1]]},tallyCsv:csv,mapping}),/balance/i);
});
