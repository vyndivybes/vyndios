import test from 'node:test';
import assert from 'node:assert/strict';
import {handleAiDevelopmentRequest} from './ai-development-http.ts';
const request=(body:unknown={confirm:true},origin='https://vyndi.test')=>new Request('https://vyndi.test/api/runtime/ai-development',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify(body)});
test('development route requires server authorization before provider access',async()=>{
 let calls=0;const response=await handleAiDevelopmentRequest(request(),{authorize:async()=>{throw Error('private')},runProbe:async()=>{calls++;return {status:'OK'}}});
 assert.equal(response.status,403);assert.equal(calls,0);assert.doesNotMatch(await response.text(),/private/);
});
test('authorized route rejects cross-origin, tools and client prompts without provider calls',async()=>{
 let calls=0;const deps={authorize:async()=>{},runProbe:async()=>{calls++;return {status:'OK'}}};
 for(const req of [request({},'https://evil.test'),request({confirm:true,prompt:'confidential'}),request({confirm:true,tools:[]}),request({confirm:false})])assert.ok((await handleAiDevelopmentRequest(req,deps)).status>=400);
 assert.equal(calls,0);
});
test('authorized synthetic probe returns only bounded qualification status with no write authority',async()=>{
 const response=await handleAiDevelopmentRequest(request(),{authorize:async()=>{},runProbe:async()=>({status:'OK',accepted:true,actionAuthorized:false})});
 assert.equal(response.status,200);assert.equal((await response.json()).data.actionAuthorized,false);
 assert.equal(response.headers.get('cache-control'),'no-store');
});
