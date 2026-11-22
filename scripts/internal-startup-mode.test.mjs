import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {INTERNAL_STARTUP_MODE, assessStartupAction} from '../src/lib/internal-startup-mode.ts';

test('the startup model is a single-company internal workspace, not a commercial ERP release',()=>{
  assert.equal(INTERNAL_STARTUP_MODE.company,'Vāyú Shastr Pvt Ltd');
  assert.equal(INTERNAL_STARTUP_MODE.mode,'INTERNAL_PREOPERATIONAL');
  assert.equal(INTERNAL_STARTUP_MODE.multiTenantCommercialOffering,false);
  assert.equal(INTERNAL_STARTUP_MODE.historicalData,'FOUNDER_DECLARED_SIMULATION_ONLY');
  assert.equal(INTERNAL_STARTUP_MODE.bypassesAuthentication,false);
  assert.equal(INTERNAL_STARTUP_MODE.bypassesExistingWriteGates,false);
});
test('safe startup planning and internal draft preparation are eligible for autonomy',()=>{
  for(const action of ['OBSERVE','ANALYZE','FORECAST','SIMULATE','PREPARE_INTERNAL_DRAFT','PREPARE_INTERNAL_REPORT']){
    const r=assessStartupAction({action,dataClass:'SIMULATION_ONLY'});
    assert.equal(r.status,'INTERNAL_SUPPORT_ELIGIBLE',action);
    assert.equal(r.externalEffectAuthorized,false);
    assert.equal(r.executionPermissionGranted,false);
  }
});
test('real-world effects and unknown data never obtain automatic permission',()=>{
  for(const action of ['PAY_SUPPLIER','ISSUE_REAL_PO','POST_STOCK','RELEASE_PRODUCTION','FILE_TAX','CREATE_EXTERNAL_ACCOUNT']){
    const r=assessStartupAction({action,dataClass:'SIMULATION_ONLY'});
    assert.equal(r.status,'HUMAN_APPROVAL_REQUIRED');
    assert.equal(r.executionPermissionGranted,false);
  }
  assert.equal(assessStartupAction({action:'OBSERVE',dataClass:'UNCLASSIFIED'}).status,'CLASSIFICATION_REQUIRED');
  assert.equal(assessStartupAction({action:'SIMULATE',dataClass:'ACTUAL_BUSINESS'}).status,'SOURCE_AUTHORITY_REQUIRED');
  assert.equal(assessStartupAction({action:'OBSERVE',dataClass:'SIMULATION_ONLY',externalEffect:true}).status,'HUMAN_APPROVAL_REQUIRED');
  assert.equal(assessStartupAction({action:'UNKNOWN',dataClass:'SIMULATION_ONLY'}).status,'ACTION_NOT_IN_SCOPE');
});
test('Command Centre explicitly labels the historical simulation-only operating mode',async()=>{
  const page=await readFile(new URL('../src/routes/command/index.tsx',import.meta.url),'utf8');
  assert.match(page,/INTERNAL_STARTUP_MODE/);
  assert.match(page,/Internal startup workspace/);
  assert.match(page,/Historical source records are simulation-only by founder declaration/);
  assert.match(page,/Startup planning and preparation/);
});
