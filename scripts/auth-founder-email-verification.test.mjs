import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {
 buildFounderEmailVerificationMessage,
 sendFounderEmailVerification,
} from '../src/lib/auth/verification-email.mjs';

const url='https://vyndios.vayushastr.workers.dev/api/auth/verify-email?token=fixed-test-token&callbackURL=%2Flogin';

test('verification is delivered only to approved founder by configured email binding',async()=>{
 const sends=[];
 const binding={send:async message=>{sends.push(message);return {messageId:'sandbox-verified'};}};
 const result=await sendFounderEmailVerification({user:{email:'shyamsundhar1982@gmail.com'},url},{binding});
 assert.equal(result,'sandbox-verified');
 assert.equal(sends.length,1);
 assert.equal(sends[0].to,'shyamsundhar1982@gmail.com');
 assert.equal(sends[0].from.email,'no-reply@vayushastr.com');
 assert.equal(sends[0].subject,'Verify your VYNDI OS email');
 assert.ok(sends[0].text.includes(url));
 assert.doesNotMatch(sends[0].text,/password|otp/i);
});
test('no binding means no dispatch, no silent success and no verified flag',async()=>{
 await assert.rejects(
  ()=>sendFounderEmailVerification({user:{email:'shyamsundhar1982@gmail.com'},url},{binding:null}),
  /VERIFICATION_EMAIL_DELIVERY_UNAVAILABLE/,
 );
});
test('forged origin, protocol, path, missing token or wrong recipient are rejected BEFORE provider',async()=>{
 const sends=[];const binding={send:async m=>{sends.push(m);return {messageId:'x'};}};
 for(const fake of [
   'http://vyndios.vayushastr.workers.dev/api/auth/verify-email?token=a',
   'https://attacker.invalid/api/auth/verify-email?token=a',
   'https://vyndios.vayushastr.workers.dev.evil.test/api/auth/verify-email?token=a',
   'https://vyndios.vayushastr.workers.dev/other?token=a',
   'https://vyndios.vayushastr.workers.dev/api/auth/verify-email',
   'javascript:alert(1)',
 ]){
  await assert.rejects(()=>sendFounderEmailVerification({
   user:{email:'shyamsundhar1982@gmail.com'},url:fake},{binding}),
   /VERIFICATION_EMAIL_(URL_INVALID|DELIVERY_FORBIDDEN)/);
 }
 for(const e of ['other@example.test','shyamsundhar1982+spoof@gmail.com','','shyamsundhar1982@gmail.com\nBcc:evil@invalid.test']){
  await assert.rejects(()=>sendFounderEmailVerification({user:{email:e},url},{binding}),
   /VERIFICATION_EMAIL_DELIVERY_FORBIDDEN/);
 }
 assert.equal(sends.length,0);
});
test('message creation alone never verifies identity or issues a session',()=>{
 const m=buildFounderEmailVerificationMessage({email:'shyamsundhar1982@gmail.com',url});
 assert.deepEqual(Object.keys(m).sort(),['from','subject','text','to']);
 assert.equal(typeof m.text,'string');
 assert.ok(m.text.includes('If you did not request this'));
 assert.doesNotMatch(JSON.stringify(m),/emailVerified|sessionToken|businessWritesAuthorized/);
});
test('do not silently suppress Cloudflare email delivery failure',async()=>{
 const binding={send:async()=>{throw Error('mail delivery failed');}};
 await assert.rejects(()=>sendFounderEmailVerification({user:{email:'shyamsundhar1982@gmail.com'},url},{binding}),/VERIFICATION_EMAIL_SEND_FAILED/);
});
test('Better Auth verification callback has explicit expiry, does not force-login and does not lock out pre-existing unverified founder',async()=>{
 const server=await readFile(new URL('../src/lib/auth/server.ts',import.meta.url),'utf8');
 assert.match(server,/emailVerification:\s*\{/);
 assert.match(server,/sendVerificationEmail:\s*async/);
 assert.match(server,/sendFounderEmailVerification/);
 assert.match(server,/autoSignInAfterVerification:\s*false/);
 assert.match(server,/expiresIn:\s*15\s*\*\s*60/);
 assert.doesNotMatch(server,/requireEmailVerification:\s*true/);
 const login=await readFile(new URL('../src/routes/login.tsx',import.meta.url),'utf8');
 assert.match(login,/authClient\.sendVerificationEmail/);
 assert.match(login,/Send verification link/);
});

// Resend Free alternative: send only to the existing founder account. The
// provider setup and credential remain outside source control.
test('Resend Free mode uses a fixed HTTPS endpoint, narrow sender, idempotency, and no key leakage',async()=>{
 const sends=[];
 const fetcher=async (requestUrl,init)=>{
  sends.push({url:requestUrl,init});
  return {ok:true,status:200,json:async()=>({id:'email-receipt-1'})};
 };
 const secret='re_'+ 'T'.repeat(36);
 const result=await sendFounderEmailVerification(
  {user:{email:'shyamsundhar1982@gmail.com'},url},
  {binding:null,resendApiKey:secret,fetcher}
 );
 assert.equal(result,'email-receipt-1');
 assert.equal(sends.length,1);
 assert.equal(sends[0].url,'https://api.resend.com/emails');
 assert.equal(sends[0].init.method,'POST');
 assert.equal(sends[0].init.headers.authorization,'Bearer '+secret);
 assert.match(sends[0].init.headers['idempotency-key'],/^vyndi-md-verify-v1-[a-f0-9]{64}$/);
 const payload=JSON.parse(sends[0].init.body);
 assert.deepEqual(payload.to,['shyamsundhar1982@gmail.com']);
 assert.equal(payload.from,'VYNDI OS <no-reply@vayushastr.com>');
 assert.equal(payload.subject,'Verify your VYNDI OS email');
 assert.ok(payload.text.includes(url));
 assert.doesNotMatch(JSON.stringify(payload),/re_TTTTT|api_key|password_hash/);
});
test('Resend Free mode refuses arbitrary or missing API credentials and never attempts network',async()=>{
 let calls=0;const fetcher=async()=>{calls++;return {ok:true,json:async()=>({id:'x'})}};
 for(const secret of ['', 'not_a_resend_key','re_short','resend:secret\nX-Evil:1','re_'+'Z'.repeat(200)]){
  await assert.rejects(()=>sendFounderEmailVerification(
   {user:{email:'shyamsundhar1982@gmail.com'},url},
   {binding:null,resendApiKey:secret,fetcher}
  ),/VERIFICATION_EMAIL_DELIVERY_UNAVAILABLE/);
 }
 assert.equal(calls,0);
});
test('Resend Free mode rejects remote errors, empty receipts, and forged recipient without exposing provider secrets',async()=>{
 const secret='re_'+'T'.repeat(36);
 for(const response of [
  {ok:false,status:429,json:async()=>({message:'rate-limit secret'})},
  {ok:false,status:403,json:async()=>({message:'sender domain unverified'})},
  {ok:true,status:200,json:async()=>({id:''})},
  {ok:true,status:200,json:async()=>({foo:'unexpected'})}
 ]){
  await assert.rejects(()=>sendFounderEmailVerification(
   {user:{email:'shyamsundhar1982@gmail.com'},url},
   {binding:null,resendApiKey:secret,fetcher:async()=>response}
  ),err=>err?.message==='VERIFICATION_EMAIL_SEND_FAILED');
 }
 let calls=0;
 await assert.rejects(()=>sendFounderEmailVerification(
  {user:{email:'attacker@example.test'},url},
  {binding:null,resendApiKey:secret,fetcher:async()=>{calls++;}}
 ),/VERIFICATION_EMAIL_DELIVERY_FORBIDDEN/);
 assert.equal(calls,0);
});
test('same Better Auth token gets stable Resend idempotency key',async()=>{
 const keys=[];const secret='re_'+'T'.repeat(36);
 const fetcher=async (_url,init)=>{keys.push(init.headers['idempotency-key']);return {ok:true,json:async()=>({id:'id'})}};
 for(let i=0;i<2;i++)await sendFounderEmailVerification(
  {user:{email:'shyamsundhar1982@gmail.com'},url},{binding:null,resendApiKey:secret,fetcher}
 );
 assert.equal(keys.length,2);
 assert.equal(keys[0],keys[1]);
});
