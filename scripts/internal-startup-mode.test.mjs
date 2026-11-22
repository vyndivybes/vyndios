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


test('founder autonomy policy allows only internal audited draft and task preparation writes',()=>{
 for(const action of ['WRITE_INTERNAL_DRAFT','UPDATE_INTERNAL_TASK','SAVE_INTERNAL_PLAN','SAVE_INTERNAL_REPORT']){
  const r=assessStartupAction({action,dataClass:'INTERNAL_DRAFT'});
  assert.equal(r.status,'INTERNAL_WRITE_POLICY_APPROVED');
  assert.equal(r.autonomousInternalWritePolicyApproved,true);
  assert.equal(r.requiresAuthenticatedActor,true);
  assert.equal(r.requiresAuditTrail,true);
  assert.equal(r.executionPermissionGranted,false);
  assert.equal(r.externalEffectAuthorized,false);
 }
 assert.equal(INTERNAL_STARTUP_MODE.autonomousInternalDraftWritesPolicyApproved,true);
 assert.equal(INTERNAL_STARTUP_MODE.externalCommunicationRequiresFounderApproval,true);
 assert.equal(INTERNAL_STARTUP_MODE.purchaseCommitmentRequiresFounderApproval,true);
});
test('purchasing and external messages can be drafted but never released by the policy',()=>{
 for(const action of ['PREPARE_PURCHASE_DRAFT','PREPARE_EXTERNAL_MESSAGE_DRAFT']){
  const r=assessStartupAction({action,dataClass:'INTERNAL_DRAFT'});
  assert.equal(r.status,'DRAFT_ONLY_AWAITING_FOUNDER');
  assert.equal(r.draftPreparationAllowed,true);
  assert.equal(r.releaseRequiresFounderApproval,true);
  assert.equal(r.executionPermissionGranted,false);
 }
 for(const action of ['ISSUE_REAL_PO','PAY_SUPPLIER','SEND_EXTERNAL_COMMITMENT','POST_STOCK','RELEASE_PRODUCTION','FILE_TAX','POST_LEDGER','ISSUE_PAYROLL']){
  assert.equal(assessStartupAction({action,dataClass:'INTERNAL_DRAFT'}).status,'HUMAN_APPROVAL_REQUIRED');
 }
 assert.equal(assessStartupAction({action:'WRITE_INTERNAL_DRAFT',dataClass:'ACTUAL_BUSINESS'}).status,'SOURCE_AUTHORITY_REQUIRED');
 assert.equal(assessStartupAction({action:'WRITE_INTERNAL_DRAFT',dataClass:'INTERNAL_DRAFT',externalEffect:true}).status,'HUMAN_APPROVAL_REQUIRED');
 assert.equal(assessStartupAction({action:'SEND_EXTERNAL_COMMITMENT',dataClass:'SIMULATION_ONLY'}).executionPermissionGranted,false);
});
