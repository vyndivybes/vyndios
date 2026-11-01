import test from 'node:test';
import assert from 'node:assert/strict';
import { reconcileTallyVouchers } from '../src/lib/finance/tally-voucher-reconciliation.mjs';
const base = {voucherType:'Payment',voucherNumber:'PAY-1',date:'2026-10-01',accountCode:'1000',debitInr:100,creditInr:0};
test('equal voucher sets pass with source evidence',()=>{
 const r=reconcileTallyVouchers([base],[base]);
 assert.equal(r.status,'reconciled');assert.equal(r.exceptions.length,0);assert.equal(r.caCertified,false);
});
test('missing vouchers and altered amounts are blockers',()=>{
 let r=reconcileTallyVouchers([base],[]);
 assert.equal(r.status,'blocked');assert.equal(r.exceptions[0].reason,'missing_in_tally');
 r=reconcileTallyVouchers([base],[{...base,debitInr:99}]);
 assert.equal(r.exceptions[0].reason,'amount_mismatch');
});
test('duplicates and malformed entries fail closed',()=>{
 assert.throws(()=>reconcileTallyVouchers([base,base],[]),/duplicate/i);
 assert.throws(()=>reconcileTallyVouchers([{...base,date:'invalid'}],[]),/invalid/i);
 assert.throws(()=>reconcileTallyVouchers([{...base,debitInr:NaN}],[]),/invalid/i);
});
test('same reference different account must not match',()=>{
 const r=reconcileTallyVouchers([base],[{...base,accountCode:'2000'}]);
 assert.equal(r.status,'blocked');assert.equal(r.exceptions.length,2);
});
test('empty datasets cannot claim reconciliation success',()=>{
 assert.equal(reconcileTallyVouchers([],[]).status,'blocked');
});
