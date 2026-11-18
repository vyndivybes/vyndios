import {createGeminiFreeAdapter} from './gemini-free-adapter.mjs';
// Deliberately no user text, history, RAG, tools or business context at this boundary.
const FIXTURE='Synthetic arithmetic test. What is 1 + 1? Reply with only the integer.';
const hold=()=>({status:'HOLD',reason:'DEVELOPMENT_PROBE_NOT_QUALIFIED',actionAuthorized:false});
export async function runDevelopmentProbe({env,request,now=Date.now(),fetchImpl=globalThis.fetch}={}) {
 let key;
 try {
  if(env?.VAOS_AI_DEVELOPMENT_CONTROL!=='synthetic-one-shot-v1'||
   !request||Object.keys(request).sort().join(',')!=='confirm'||request.confirm!==true||
   typeof env?.VAOS_ARTIFACTS?.put!=='function')return hold();
  const raw=env.VAOS_AI_FREE_TIER_EVIDENCE;
  if(typeof raw!=='string'||raw.length>2048)return hold();
  const e=JSON.parse(raw);
  if(typeof e.id!=='string'||typeof e.project!=='string'||!Number.isSafeInteger(now)||
   !/^[a-zA-Z0-9_-]{3,80}$/.test(e.id)||!/^[-a-z0-9]{3,80}$/.test(e.project)||
   e.approved!==true||e.billingEnabled!==false||e.tier!=='free'||e.model!=='gemini-3.8-flash'||
   !Number.isSafeInteger(e.reviewedAt)||!Number.isSafeInteger(e.expiresAt)||
   e.reviewedAt>now||e.expiresAt<=now||e.expiresAt<=e.reviewedAt||e.expiresAt-e.reviewedAt>86400000||
   !Number.isSafeInteger(e.rpm)||e.rpm<1||!Number.isSafeInteger(e.rpd)||e.rpd<1||
   !Number.isSafeInteger(e.tpm)||e.tpm<768)return hold();
  const provider=createGeminiFreeAdapter({apiKey:env.GEMINI_API_KEY,freeTierVerified:true,maxRequestsPerProcess:1,fetchImpl});
  key=`ai-independence/reservations/${e.project}/${e.id}`;
  // R2 conditional creation is the cross-isolate one-shot budget AND pre-send audit.
  // Never delete/refund this reservation after upstream/audit failure or timeout.
  const admitted=await env.VAOS_ARTIFACTS.put(key,JSON.stringify({state:'RESERVED',model:e.model,fixture:'arithmetic-v1',createdAt:now}),{onlyIf:{etagDoesNotMatch:'*'}});
  if(!admitted)return hold();
  const output=await provider.invoke({classification:'SYNTHETIC',capability:'text',input:FIXTURE});
  const accepted=output.text.trim()==='2';
  await env.VAOS_ARTIFACTS.put(`${key}/outcome`,JSON.stringify({state:'COMPLETED',accepted,model:e.model,fixture:'arithmetic-v1',createdAt:now}));
  return {status:accepted?'OK':'HOLD',fixture:'arithmetic-v1',accepted,model:e.model,
   evidenceStatus:'SYNTHETIC_PROBE_ONLY',actionAuthorized:false};
 } catch {
  if(key)try{await env.VAOS_ARTIFACTS.put(`${key}/failure`,JSON.stringify({state:'FAILED',createdAt:now}));}catch{}
  return hold();
 }
}
