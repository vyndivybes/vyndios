import test from 'node:test';
import assert from 'node:assert/strict';
import { assessInferenceRoute, assessProviderDisconnection } from './ai-independence-policy.ts';

const base={classification:'SYNTHETIC', capability:'text', provider:'gemini-free', providerKind:'external',costTier:'free',freeTierVerified:true,mode:'development',allowExternal:true};

test('default external routing is not authorized',()=>{
 const a=assessInferenceRoute({...base,allowExternal:false});
 assert.equal(a.state,'HOLD');assert.ok(a.holds.includes('EXTERNAL_CONSENT_REQUIRED'));
});
test('synthetic development inference may be prepared but cannot execute business writes',()=>{
 const a=assessInferenceRoute(base);
 assert.equal(a.state,'PREPARE_ONLY');assert.equal(a.businessWriteAuthorized,false);
});
test('finance, customer and engineering confidential content is blocked from free external models',()=>{
 for(const classification of ['CONFIDENTIAL','UNKNOWN']) {
  const a=assessInferenceRoute({...base,classification});
  assert.equal(a.state,'HOLD');
 }
});
test('paid or unverified free tier fails closed',()=>{
 for(const p of [{...base,costTier:'paid'},{...base,freeTierVerified:false}])
  assert.equal(assessInferenceRoute(p).state,'HOLD');
});
test('independence mode requires internal inference',()=>{
 assert.equal(assessInferenceRoute({...base,mode:'independence'}).state,'HOLD');
 assert.equal(assessInferenceRoute({...base,mode:'independence',providerKind:'local',allowExternal:false}).state,'PREPARE_ONLY');
});
test('multimodal capability must be independently declared supported',()=>{
 assert.equal(assessInferenceRoute({...base,capability:'vision',supportedCapabilities:['text']}).state,'HOLD');
 assert.equal(assessInferenceRoute({...base,capability:'vision',supportedCapabilities:['text','vision']}).state,'PREPARE_ONLY');
});
test('unsupported provider or absent classification fails closed',()=>{
 assert.equal(assessInferenceRoute({...base,providerKind:'unknown'}).state,'HOLD');
 assert.equal(assessInferenceRoute({...base,classification:undefined}).state,'HOLD');
});
test('disconnection requires independently verified evidence before being proposed',()=>{
 const a=assessProviderDisconnection({offlineHours:72,verifiedEvidence:false});
 assert.equal(a.state,'HOLD');assert.equal(a.autoDisconnectAuthorized,false);
});
