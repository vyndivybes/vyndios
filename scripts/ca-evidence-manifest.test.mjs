import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCaEvidenceManifest } from '../src/lib/finance/ca-evidence-manifest.mjs';
const report={status:'review_candidate',totalExceptions:0,sections:{trialBalance:{status:'reconciled',exceptionCount:0},vouchers:{status:'reconciled',exceptionCount:0},gst:{status:'reconciled',exceptionCount:0}}};
const evidence=[{type:'trial_balance',reference:'TB-OCT',sha256:'a'.repeat(64)},{type:'voucher_register',reference:'VR-OCT',sha256:'b'.repeat(64)},{type:'gst_register',reference:'GST-OCT',sha256:'c'.repeat(64)}];
test('complete evidence yields review-ready manifest only',()=>{
 const r=buildCaEvidenceManifest({period:'2026-10',report,evidence});
 assert.equal(r.status,'review_ready'); assert.equal(r.caCertified,false);
 assert.equal(r.evidence.length,3); assert.equal(r.period,'2026-10');
});
test('missing required evidence blocks review',()=>assert.equal(buildCaEvidenceManifest({period:'2026-10',report,evidence:evidence.slice(1)}).status,'blocked'));
test('blocked reconciliation cannot be cleared with evidence',()=>assert.equal(buildCaEvidenceManifest({period:'2026-10',report:{...report,status:'blocked'},evidence}).status,'blocked'));
test('duplicate evidence and fake hash rejected',()=>{
 assert.throws(()=>buildCaEvidenceManifest({period:'2026-10',report,evidence:[...evidence,evidence[0]]}),/duplicate/i);
 assert.throws(()=>buildCaEvidenceManifest({period:'2026-10',report,evidence:[{...evidence[0],sha256:'fake'},...evidence.slice(1)]}),/hash/i);
});
test('invalid period rejected',()=>assert.throws(()=>buildCaEvidenceManifest({period:'2026-13',report,evidence}),/period/i));
