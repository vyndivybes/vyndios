/**
 * Explicitly opted-in, development-only Gemini API text adapter.
 * This is NOT a billing guarantee or a production release.
 * Upstream must independently verify free-tier account status and sanitize public/synthetic content.
 */
const FREE_TEXT_MODELS = new Set(['gemini-3.8-flash']);
const MAX_INPUT = 8192;
const MAX_OUTPUT = 12000;

export function createGeminiFreeAdapter({apiKey, model='gemini-3.8-flash', freeTierVerified=false,
  maxRequestsPerProcess=1, fetchImpl=globalThis.fetch, timeoutMs=8000}={}) {
  if (freeTierVerified !== true) throw new Error('FREE_TIER_NOT_VERIFIED');
  if (!FREE_TEXT_MODELS.has(model)) throw new Error('MODEL_NOT_APPROVED_FREE');
  if (typeof apiKey !== 'string' || !apiKey.trim()) throw new Error('GEMINI_SECRET_REQUIRED');
  if (!Number.isSafeInteger(maxRequestsPerProcess) || maxRequestsPerProcess<1 || maxRequestsPerProcess>100)
    throw new Error('INVALID_REQUEST_BUDGET');
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs<100 || timeoutMs>20000 || typeof fetchImpl !== 'function')
    throw new Error('INVALID_ADAPTER_CONFIG');
  let requests = 0;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  return Object.freeze({
    id:'gemini-free', kind:'external', costTier:'free', available:true, capabilities:Object.freeze(['text']),
    async invoke(task) {
      if (!task || !['PUBLIC','SYNTHETIC'].includes(task.classification))
        throw new Error('DATA_CLASSIFICATION_DENIED');
      if (task.capability !== 'text') throw new Error('UNSUPPORTED_CAPABILITY');
      if (typeof task.input !== 'string' || !task.input.trim() || task.input.length>MAX_INPUT)
        throw new Error('INVALID_PROMPT');
      if (requests >= maxRequestsPerProcess) throw new Error('REQUEST_BUDGET_EXHAUSTED');
      requests += 1; // reserve before request, including concurrent requests and failures
      try {
        const response = await fetchImpl(url, {
          method:'POST',redirect:'error',
          headers:{'content-type':'application/json','x-goog-api-key':apiKey},
          body:JSON.stringify({contents:[{role:'user',parts:[{text:task.input}]}],
            generationConfig:{maxOutputTokens:512}}),
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (!response?.ok) throw new Error('UPSTREAM_STATUS');
        const payload=await response.json();
        const result=payload?.candidates?.[0]?.content?.parts
          ?.filter(part=>part?.thought!==true&&typeof part?.text==='string').map(part=>part.text).join('');
        if (typeof result !== 'string' || !result.trim() || result.length>MAX_OUTPUT)
          throw new Error('UPSTREAM_EMPTY_OR_OVERSIZED');
        return Object.freeze({text:result, model, evidenceStatus:'MODEL_OUTPUT_UNVERIFIED'});
      } catch {
        // Never expose upstream error bodies, headers, prompts, or API tokens.
        throw new Error('REMOTE_PROVIDER_FAILED');
      }
    },
  });
}
