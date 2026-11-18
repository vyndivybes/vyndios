import test from 'node:test';
import assert from 'node:assert/strict';
import {runDevelopmentProbe} from './development-probe.mjs';

function harness(overrides={}) {
 const events=[],keys=new Set(),calls=[];
 const env={VAOS_AI_DEVELOPMENT_CONTROL:'synthetic-one-shot-v1',GEMINI_API_KEY:'test-secret',
  VAOS_AI_FREE_TIER_EVIDENCE:JSON.stringify({id:'review-20261118',project:'test-project',model:'gemini-3.8-flash',billingEnabled:false,tier:'free',reviewedAt:1000,expiresAt:2000,rpm:1,tpm:1000,rpd:1,approved:true}),
  VAOS_ARTIFACTS:{async put(key,value,options){events.push(JSON.parse(value));if(options?.onlyIf){if(keys.has(key))return null;keys.add(key)}return {etag:'ok'}}},...overrides};
 const fetchImpl=async(url,options)=>{calls.push({url,options});return {ok:true,json:async()=>({candidates:[{content:{parts:[{text:'2'}]}}]})}};
 return {env,events,calls,run:(request={confirm:true},options={})=>runDevelopmentProbe({env,request,now:1500,fetchImpl,...options})};
}
test('probe sends only its server-owned synthetic fixture and reserves once across instances',async()=>{
 const h=harness();assert.equal((await h.run()).status,'OK');assert.equal((await h.run()).status,'HOLD');
 assert.equal(h.calls.length,1);assert.equal(h.events[0].state,'RESERVED');assert.equal(h.events[1].state,'COMPLETED');
 assert.equal(h.calls[0].options.redirect,'error');assert.equal(h.events.some(e=>JSON.stringify(e).includes('test-secret')),false);
});
test('client text, labels, providers, prompts and tools cannot enter the synthetic probe',async()=>{
 for(const field of ['input','classification','provider','prompt','tools','model','evidence']){const h=harness();assert.equal((await h.run({confirm:true,[field]:'private'})).status,'HOLD');assert.equal(h.calls.length,0);}
});
test('off, expired evidence, billing, missing audit or missing consent block before network',async()=>{
 for(const override of [{VAOS_AI_DEVELOPMENT_CONTROL:'off'},{VAOS_ARTIFACTS:null},{VAOS_AI_FREE_TIER_EVIDENCE:'{}'},
  {VAOS_AI_FREE_TIER_EVIDENCE:JSON.stringify({id:'review',project:'project',model:'gemini-3.8-flash',billingEnabled:true,tier:'free',reviewedAt:1000,expiresAt:2000,rpm:1,tpm:1000,rpd:1,approved:true})}]){
  const h=harness(override);assert.equal((await h.run()).status,'HOLD');assert.equal(h.calls.length,0);
 }
 const h=harness();assert.equal((await h.run({confirm:false})).status,'HOLD');assert.equal(h.calls.length,0);
});
test('concurrent reservations allow only one request; failed audit never invokes provider',async()=>{
 const h=harness();const results=await Promise.all([h.run(),h.run()]);assert.equal(results.filter(x=>x.status==='OK').length,1);assert.equal(h.calls.length,1);
 const failed=harness({VAOS_ARTIFACTS:{put:async()=>{throw Error('secret')}}});assert.equal((await failed.run()).status,'HOLD');assert.equal(failed.calls.length,0);
});
test('expired/future/missing review identity and invalid quotas cannot qualify',async()=>{
 for(const patch of [{id:undefined},{project:undefined},{reviewedAt:1600},{expiresAt:1400},{expiresAt:86402000},{rpm:0},{rpd:0},{tpm:0},{approved:false}]){
  const h=harness();h.env.VAOS_AI_FREE_TIER_EVIDENCE=JSON.stringify({...JSON.parse(h.env.VAOS_AI_FREE_TIER_EVIDENCE),...patch});
  assert.equal((await h.run()).status,'HOLD');assert.equal(h.calls.length,0);
 }
});
test('provider failure consumes reservation, exposes no error and never retries',async()=>{
 const h=harness();let calls=0;
 const first=await h.run({confirm:true},{fetchImpl:async()=>{calls++;throw Error('test-secret')}});
 assert.equal(first.status,'HOLD');assert.doesNotMatch(JSON.stringify(first),/test-secret/);
 assert.equal((await h.run()).status,'HOLD');assert.equal(calls,1);assert.equal(h.calls.length,0);
});
