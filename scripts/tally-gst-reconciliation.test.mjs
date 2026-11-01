import test from 'node:test';
import assert from 'node:assert/strict';
import { reconcileGstRegister } from '../src/lib/finance/tally-gst-reconciliation.mjs';
const base={invoiceId:'INV-1',period:'2026-10',gstin:'27ABCDE1234F1Z5',taxableInr:1000,cgstInr:90,sgstInr:90,igstInr:0,cessInr:0};
test('identical GST source rows reconcile',()=>{
 const result=reconcileGstRegister([base],[base]);
 assert.equal(result.status,'reconciled');assert.equal(result.exceptions.length,0);assert.equal(result.caCertified,false);
});
test('GST mismatches and missing invoice block',()=>{
 assert.equal(reconcileGstRegister([base],[{...base,cgstInr:80}]).exceptions[0].reason,'tax_mismatch');
 assert.equal(reconcileGstRegister([base],[]).exceptions[0].reason,'missing_in_external_register');
 assert.equal(reconcileGstRegister([],[base]).exceptions[0].reason,'missing_in_vyndi');
});
test('duplicate, invalid period and invalid money rejected',()=>{
 assert.throws(()=>reconcileGstRegister([base,base],[base]),/duplicate/i);
 assert.throws(()=>reconcileGstRegister([{...base,period:'2026-13'}],[base]),/invalid/i);
 assert.throws(()=>reconcileGstRegister([{...base,igstInr:-1}],[base]),/invalid/i);
});
test('different GSTIN and periods do not silently match',()=>{
 const r=reconcileGstRegister([base],[{...base,period:'2026-09'}]);
 assert.equal(r.exceptions.length,2);
});
test('empty sources do not certify readiness',()=>assert.equal(reconcileGstRegister([],[]).status,'blocked'));
