import test from 'node:test';
import assert from 'node:assert/strict';
import { importTallyTrialBalanceCsv } from '../src/lib/finance/tally-import.mjs';
const mapping = {'Bank Account':'1000','Share Capital':'3000'};
test('parses quoted CSV and approved mapping',()=>{
 const x=importTallyTrialBalanceCsv('Ledger,Debit,Credit\n"Bank Account","1,200.50",0\n"Share Capital",0,1200.50\n',mapping);
 assert.equal(x.rows.length,2); assert.deepEqual(x.rows[0],{code:'1000',name:'Bank Account',debitInr:1200.5,creditInr:0});
});
test('fails closed on unmapped ledger',()=>assert.throws(()=>importTallyTrialBalanceCsv('Ledger,Debit,Credit\nOther,1,0',mapping),/unmapped/i));
test('fails closed on duplicate mapping',()=>assert.throws(()=>importTallyTrialBalanceCsv('Ledger,Debit,Credit\nBank Account,1,0\nBank Account,2,0',mapping),/duplicate/i));
test('rejects unsafe names and negative values',()=>{
 assert.throws(()=>importTallyTrialBalanceCsv('Ledger,Debit,Credit\n=HYPERLINK(),1,0',mapping),/unsafe|unmapped/i);
 assert.throws(()=>importTallyTrialBalanceCsv('Ledger,Debit,Credit\nBank Account,-1,0',mapping),/invalid/i);
});
test('rejects invalid header and monetary values',()=>{
 assert.throws(()=>importTallyTrialBalanceCsv('Name,Debit,Credit\nBank Account,1,0',mapping),/header/i);
 assert.throws(()=>importTallyTrialBalanceCsv('Ledger,Debit,Credit\nBank Account,abc,0',mapping),/invalid/i);
});
