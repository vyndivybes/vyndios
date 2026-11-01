import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCaReconciliationDashboard } from '../src/lib/finance/ca-reconciliation-dashboard.mjs';
const clean={trialBalance:{status:'reconciled',differences:[],vyndiBalanced:true,tallyBalanced:true},vouchers:{status:'reconciled',exceptions:[]},gst:{status:'reconciled',exceptions:[]}};
test('reconciled comparisons remain review-only, never certified',()=>{
 const r=buildCaReconciliationDashboard(clean);
 assert.equal(r.status,'review_candidate');assert.equal(r.caCertified,false);assert.equal(r.totalExceptions,0);
});
test('any discrepancy prevents review candidate',()=>{
 const r=buildCaReconciliationDashboard({...clean,gst:{status:'blocked',exceptions:[{key:'A',reason:'tax_mismatch'}]}});
 assert.equal(r.status,'blocked');assert.equal(r.totalExceptions,1);assert.equal(r.sections.gst.status,'blocked');
});
test('missing comparison inputs are not treated as clean',()=>{
 const r=buildCaReconciliationDashboard({trialBalance:clean.trialBalance});
 assert.equal(r.status,'blocked');assert.equal(r.sections.vouchers.status,'not_provided');
});
test('non-finite and dishonest exception counts fail closed',()=>{
 assert.throws(()=>buildCaReconciliationDashboard({...clean,vouchers:{status:'reconciled',exceptions:[{reason:'missing_in_tally'}]}}),/inconsistent/i);
 assert.throws(()=>buildCaReconciliationDashboard({...clean,gst:{status:'unknown',exceptions:[]}}),/invalid/i);
});
test('output cannot grant CA approval from caller-supplied fields',()=>{
 const r=buildCaReconciliationDashboard({...clean,caCertified:true,approvedBy:'tester'});
 assert.equal(r.caCertified,false);assert.equal(Object.hasOwn(r,'approvedBy'),false);
});
