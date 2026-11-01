import test from 'node:test';
import assert from 'node:assert/strict';
import { qualifyCaReconciliation } from '../src/lib/finance/ca-qualification-pipeline.mjs';
const tb=[{code:'1000',name:'Bank',debitInr:100,creditInr:0},{code:'3000',name:'Capital',debitInr:0,creditInr:100}];
const voucher=[{voucherType:'Receipt',voucherNumber:'R1',date:'2026-10-01',accountCode:'1000',debitInr:100,creditInr:0}];
const gst=[{invoiceId:'I1',period:'2026-10',gstin:'27ABCDE1234F1Z5',taxableInr:100,cgstInr:9,sgstInr:9,igstInr:0,cessInr:0}];
const input={period:'2026-10',vyndi:{trialBalance:tb,vouchers:voucher,gst},external:{trialBalance:tb,vouchers:voucher,gst}};
test('qualifies matching accounting comparisons as candidate, not CA approval',()=>{
 const result=qualifyCaReconciliation(input);
 assert.equal(result.status,'review_candidate');assert.equal(result.caCertified,false);
 assert.equal(result.totalExceptions,0);
});
test('mismatched GST blocks consolidated status',()=>{
 const result=qualifyCaReconciliation({...input,external:{...input.external,gst:[{...gst[0],cgstInr:10}]}});
 assert.equal(result.status,'blocked');assert.equal(result.sections.gst.exceptionCount,1);
});
test('missing external data cannot silently pass',()=>{
 assert.throws(()=>qualifyCaReconciliation({...input,external:{...input.external,vouchers:undefined}}),/missing/i);
});
test('cross-period vouchers and GST are rejected',()=>{
 assert.throws(()=>qualifyCaReconciliation({...input,vyndi:{...input.vyndi,vouchers:[{...voucher[0],date:'2026-09-01'}]}}),/period/i);
 assert.throws(()=>qualifyCaReconciliation({...input,external:{...input.external,gst:[{...gst[0],period:'2026-09'}]}}),/period/i);
});
