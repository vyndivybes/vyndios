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
