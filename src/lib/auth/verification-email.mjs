/**
 * Founder-only Better Auth email verification transport for Cloudflare Workers.
 *
 * The sender uses a commissioned free-plan Resend API credential or
 * a separately commissioned Cloudflare send_email Worker binding. This module does NOT mark the user
 * verified or mint a session. Better Auth owns token expiry, consumption and
 * emailVerified state transitions after the recipient follows the link.
 *
 * No logging of the email verification URL, token, session, credentials or
 * provider response. This first stage is explicitly scoped to the founder;
 * never silently expand it to all registered users.
 */
const FOUNDER_EMAIL='shyamsundhar1982@gmail.com';
const SENDER_EMAIL='no-reply@vayushastr.com';
const VERIFICATION_ORIGIN='https://vyndios.vayushastr.workers.dev';
const VERIFICATION_PATH='/api/auth/verify-email';

/** @param {unknown} url */
function validVerificationUrl(url){
 if(typeof url!=='string'||url.length<30||url.length>4500)
  throw Error('VERIFICATION_EMAIL_URL_INVALID');
 let parsed;
 try{parsed=new URL(url);}catch{throw Error('VERIFICATION_EMAIL_URL_INVALID');}
 if(parsed.origin!==VERIFICATION_ORIGIN||parsed.pathname!==VERIFICATION_PATH||
    parsed.username||parsed.password||parsed.hash)
  throw Error('VERIFICATION_EMAIL_URL_INVALID');
 const token=parsed.searchParams.get('token');
 if(!token||token.length<8||token.length>2048||
    parsed.searchParams.getAll('token').length!==1)
  throw Error('VERIFICATION_EMAIL_URL_INVALID');
 for(const key of parsed.searchParams.keys()){
  if(!['token','callbackURL'].includes(key))
   throw Error('VERIFICATION_EMAIL_URL_INVALID');
 }
 const callback=parsed.searchParams.get('callbackURL');
 if(callback!==null&&(!callback.startsWith('/')||callback.startsWith('//')||
    callback.includes('\\')||/[\u0000-\u001f]/.test(callback)))
  throw Error('VERIFICATION_EMAIL_URL_INVALID');
 return parsed.href;
}

/** @param {{email:unknown,url:unknown}} input */
export function buildFounderEmailVerificationMessage(input){
 const email=typeof input?.email==='string'?input.email.trim().toLowerCase():'';
 if(email!==FOUNDER_EMAIL)throw Error('VERIFICATION_EMAIL_DELIVERY_FORBIDDEN');
 const link=validVerificationUrl(input.url);
 return Object.freeze({
  from:Object.freeze({name:'VYNDI OS',email:SENDER_EMAIL}),
  to:FOUNDER_EMAIL,
  subject:'Verify your VYNDI OS email',
  text:'VYNDI OS · Vāyú Shastr Pvt Ltd\n\nVerify the email address of your existing account by opening this one-time link:\n'+
   link+'\n\nThe link expires after 15 minutes. If you did not request this, you can ignore the email.'+
   '\n\nNever share the link with anyone. Verification does not activate business-write authority.',
 });
}

/**
 * @returns {Promise<{send:(message:ReturnType<typeof buildFounderEmailVerificationMessage>)=>Promise<{messageId:string}>}|null>}
 */
async function runtimeEmailBinding(){
 try {
  const platformModule='cloudflare:workers';
  const runtime=await import(/* @vite-ignore */ platformModule);
  const binding=runtime.env?.VYNDI_VERIFICATION_EMAIL;
  return binding&&typeof binding.send==='function'?binding:null;
 }catch{return null;}
}

/**
 * Only the founder's registered email may be used in this initial stage.
 * Cloudflare Workers Free accounts can use Resend's separate free-tier HTTPS
 * API; Cloudflare native Email Sending does NOT need to be purchased.
 */
const RESEND_ENDPOINT='https://api.resend.com/emails';
const RESEND_KEY_PATTERN=/^re_[A-Za-z0-9_-]{15,160}$/;

/** @returns {Promise<string|null>} */
async function runtimeResendKey(){
 try{
  const platformModule='cloudflare:workers';
  const runtime=await import(/* @vite-ignore */ platformModule);
  const candidate=runtime.env?.VYNDI_RESEND_API_KEY;
  if(typeof candidate==='string')return candidate;
 }catch{ /* Local Node runtime has no Cloudflare bindings. */ }
 return typeof process!=='undefined'&&typeof process.env?.VYNDI_RESEND_API_KEY==='string'
  ? process.env.VYNDI_RESEND_API_KEY:null;
}
/** @param {string} value */
async function sha256Hex(value){
 const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));
 return Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');
}
/**
 * @param {ReturnType<typeof buildFounderEmailVerificationMessage>} message
 * @param {string} apiKey
 * @param {typeof fetch} fetcher
 */
async function sendViaResend(message,apiKey,fetcher){
 if(!RESEND_KEY_PATTERN.test(apiKey))
  throw Error('VERIFICATION_EMAIL_DELIVERY_UNAVAILABLE');
 try{
  const key='vyndi-md-verify-v1-'+await sha256Hex(message.to+'\n'+message.text);
  const response=await fetcher(RESEND_ENDPOINT,{
   method:'POST',
   headers:{
    'content-type':'application/json',
    authorization:'Bearer '+apiKey,
    'idempotency-key':key,
   },
   body:JSON.stringify({
    from:message.from.name+' <'+message.from.email+'>',
    to:[message.to],
    subject:message.subject,
    text:message.text,
   }),
   signal:AbortSignal.timeout(10000),
  });
  if(!response.ok)throw Error('RESEND_PROVIDER_REJECTED');
  const data=await response.json();
  if(typeof data?.id!=='string'||!data.id.trim()||data.id.length>160)
   throw Error('RESEND_RECEIPT_INVALID');
  return data.id;
 }catch{
  // Never leak provider error, credential, target or token through the auth API.
  throw Error('VERIFICATION_EMAIL_SEND_FAILED');
 }
}
/**
 * @param {{user?:{email?:unknown},url:unknown}} data
 * @param {{
 * binding?:{send:(message:ReturnType<typeof buildFounderEmailVerificationMessage>)=>Promise<{messageId:string}>}|null,
 * resendApiKey?:string|null,
 * fetcher?:typeof fetch
 * }} options
 */
export async function sendFounderEmailVerification(data,options={}){
 // Validate recipient and origin before the transport or any external call.
 const message=buildFounderEmailVerificationMessage({email:data?.user?.email,url:data?.url});
 const binding=Object.hasOwn(options,'binding')?options.binding:await runtimeEmailBinding();
 if(binding&&typeof binding.send==='function'){
  try{
   const result=await binding.send(message);
   if(!result||typeof result.messageId!=='string'||result.messageId.length<1)
    throw Error('VERIFICATION_EMAIL_PROVIDER_RECEIPT_INVALID');
   return result.messageId;
  }catch{
   throw Error('VERIFICATION_EMAIL_SEND_FAILED');
  }
 }
 const apiKey=Object.hasOwn(options,'resendApiKey')?options.resendApiKey:await runtimeResendKey();
 if(typeof apiKey!=='string'||!RESEND_KEY_PATTERN.test(apiKey))
  throw Error('VERIFICATION_EMAIL_DELIVERY_UNAVAILABLE');
 return sendViaResend(message,apiKey,options.fetcher??fetch);
}
