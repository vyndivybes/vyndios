/**
 * Founder-only Better Auth email verification transport for Cloudflare Workers.
 *
 * The provider can send only when a separately commissioned Cloudflare
 * send_email Worker binding is present. This module does NOT mark the user
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
 * @param {{user?:{email?:unknown},url:unknown}} data
 * @param {{binding?:{send:(message:ReturnType<typeof buildFounderEmailVerificationMessage>)=>Promise<{messageId:string}>}|null}} options
 */
export async function sendFounderEmailVerification(data,options={}){
 // Construct and validate the email before consulting or calling any provider.
 const message=buildFounderEmailVerificationMessage({email:data?.user?.email,url:data?.url});
 const binding=Object.hasOwn(options,'binding')?options.binding:await runtimeEmailBinding();
 if(!binding||typeof binding.send!=='function')
  throw Error('VERIFICATION_EMAIL_DELIVERY_UNAVAILABLE');
 try{
  const result=await binding.send(message);
  if(!result||typeof result.messageId!=='string'||result.messageId.length<1)
   throw Error('VERIFICATION_EMAIL_PROVIDER_RECEIPT_INVALID');
  return result.messageId;
 }catch{
  throw Error('VERIFICATION_EMAIL_SEND_FAILED');
 }
}
