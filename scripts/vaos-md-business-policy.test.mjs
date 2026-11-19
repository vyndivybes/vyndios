import test from 'node:test';
import assert from 'node:assert/strict';
import {
 VYNDI_MD_SOURCE_POLICY,
 assessSimulationDeclarationBoundary,
} from '../src/lib/vaos-founder-business-policy.mjs';

test('Managing Director declaration records one legal owner and VYNDI OS as source of record, never as verified login',()=>{
 const p=VYNDI_MD_SOURCE_POLICY;
 assert.equal(p.schemaVersion,'VYNDI_MD_SOURCE_POLICY_V1');
 assert.equal(p.declaredLegalEntity,'Vāyú Shastr Pvt Ltd');
 assert.equal(p.product,'VYNDI OS');
 assert.equal(p.declaredSystemOfRecord,'VYNDI_OS');
 assert.equal(p.agentOrchestrationSystem,'VAOS_JARVIS');
 assert.equal(p.businessOwnershipDecision,'MD_DECLARED');
 assert.equal(p.sourceAuthorityDecision,'MD_APPROVED');
 assert.equal(p.historicalDataClassification,'SIMULATION_ONLY_DECLARED');
 assert.equal(p.authenticationVerified,false);
 assert.equal(p.recordLevelClassificationVerified,false);
 assert.equal(p.businessDataVerified,false);
 assert.equal(p.productionWriteAuthorized,false);
 assert.equal(Object.values(p.simulationBaselineCounts).reduce((a,b)=>a+b,0),119);
});
test('equal baseline record counts never convert a founder declaration to certified source data',()=>{
 const r=assessSimulationDeclarationBoundary({...VYNDI_MD_SOURCE_POLICY.simulationBaselineCounts});
 assert.equal(r.status,'HOLD');
 assert.equal(r.countsEqual,true);
 assert.equal(r.baselineScope,'ROW_COUNTS_ONLY_NOT_RECORD_IDENTITIES');
 assert.equal(r.sourceRevisionCertified,false);
 assert.equal(r.productionBusinessDataCertified,false);
 assert.equal(r.productionWriteAuthorized,false);
 assert.equal(r.authenticationVerified,false);
});
test('additional real or test rows trigger scope drift, never inherit historic simulation classification',()=>{
 const counts={...VYNDI_MD_SOURCE_POLICY.simulationBaselineCounts,purchaseOrders:49};
 const r=assessSimulationDeclarationBoundary(counts);
 assert.equal(r.countsEqual,false);
 assert.ok(r.holds.includes('SIMULATION_DECLARATION_COHORT_DRIFT'));
 assert.equal(r.productionBusinessDataCertified,false);
});
test('invalid or incomplete count proof fails closed, never coerces strings or unknown inputs',()=>{
 const base=VYNDI_MD_SOURCE_POLICY.simulationBaselineCounts;
 for(const v of [undefined,null,{},'unknown',{...base,jobCards:'4'},
  {...base,jobCards:-1},{...base,jobCards:2.5},{...base,foo:4}]){
  assert.throws(()=>assessSimulationDeclarationBoundary(v),/SIMULATION_BASELINE_INVALID/);
 }
});
