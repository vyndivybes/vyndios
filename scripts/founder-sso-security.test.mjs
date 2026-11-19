import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {validateFounderSsoAuthorization,validateFounderSsoRedeem,FOUNDER_SSO_CLIENT_ID,FOUNDER_SSO_CALLBACK} from '../src/lib/founder-sso-protocol.mjs';
import {issueFounderSsoCode,redeemFounderSsoCode} from '../src/lib/founder-sso-store.mjs';

const state='s'.repeat(43),nonce='n'.repeat(43),challenge='a'.repeat(43),code='c'.repeat(48),verifier='v'.repeat(48);
const sha=async v=>Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(v))).toString('base64url');
function validParams(){return new URLSearchParams({client_id:FOUNDER_SSO_CLIENT_ID,redirect_uri:FOUNDER_SSO_CALLBACK,response_type:'code',state,nonce,code_challenge:challenge,code_challenge_method:'S256'});}
test('authorization restricts client, redirect, PKCE S256, state, nonce, and rejects additional keys',()=>{
 const v=validateFounderSsoAuthorization(validParams());
 assert.equal(v.clientId,FOUNDER_SSO_CLIENT_ID);
 assert.equal(v.redirectUri,FOUNDER_SSO_CALLBACK);
 assert.equal(v.challenge,challenge);
 for(const [key,value] of [
  ['client_id','evil'],['redirect_uri','https://attacker.invalid/callback'],
  ['redirect_uri',FOUNDER_SSO_CALLBACK+'?next=https://evil.invalid'],
  ['response_type','token'],['code_challenge_method','plain'],
  ['code_challenge','short'],['state','bad'],['nonce','bad'],
 ]){const p=validParams();p.set(key,value);assert.throws(()=>validateFounderSsoAuthorization(p),/SSO_AUTHORIZATION_INVALID/,key);}
 const repeated=validParams();repeated.append('state','duplicate');
 assert.throws(()=>validateFounderSsoAuthorization(repeated),/SSO_AUTHORIZATION_INVALID/);
 const unknown=validParams();unknown.set('email','attacker@invalid.test');
 assert.throws(()=>validateFounderSsoAuthorization(unknown),/SSO_AUTHORIZATION_INVALID/);
});
test('redemption requires fixed P256 authenticated service body and exact path',()=>{
 const body={protocolVersion:'vaos-founder-sso.v1',serviceIdentity:'vaos',audience:'vyndi-os',
  method:'POST',path:'/api/sso/redeem',purpose:'authenticate-founder',
  clientId:FOUNDER_SSO_CLIENT_ID,redirectUri:FOUNDER_SSO_CALLBACK,code,codeVerifier:verifier};
 assert.equal(validateFounderSsoRedeem(body).code,code);
 for(const [key,value] of [['clientId','attacker'],['redirectUri','https://evil.invalid'],['method','GET'],['path','/api/vaos/bridge'],['purpose','write-execute'],['code','short'],['codeVerifier','short'],['serviceIdentity','browser']]){
  assert.throws(()=>validateFounderSsoRedeem({...body,[key]:value}),/SSO_REDEEM_INVALID/,key);
 }
 assert.throws(()=>validateFounderSsoRedeem({...body,email:'founder@example.com'}),/SSO_REDEEM_INVALID/);
});
async function fixture(t){
 const db=new PGlite();await db.waitReady;t.after(()=>db.close());
 await db.exec('CREATE TABLE public."user"(id text PRIMARY KEY,email text NOT NULL,"emailVerified" boolean NOT NULL);');
 await db.exec('CREATE TABLE public.vindy_user_roles(user_id text PRIMARY KEY,role text NOT NULL);');
 await db.exec('CREATE TABLE public."session"(id text PRIMARY KEY,"userId" text NOT NULL,"expiresAt" timestamptz NOT NULL);');
 await db.exec('CREATE TABLE public."account"(id text PRIMARY KEY,"userId" text NOT NULL,"providerId" text NOT NULL);');
 const migration=await readFile(new URL('../migrations/0201_founder_sso_authentication_codes.sql',import.meta.url),'utf8');
 await db.exec(migration);
 await db.query('INSERT INTO public."user" VALUES($1,$2,true)',['native-user-1','shyamsundhar1982@gmail.com']);
 await db.query('INSERT INTO public.vindy_user_roles VALUES($1,$2)',['native-user-1','admin']);
 await db.query("INSERT INTO public.\"session\" VALUES($1,$2,now()+interval '1 hour')",['native-session-1','native-user-1']);
 await db.query('INSERT INTO public."account" VALUES($1,$2,$3)',['native-account-1','native-user-1','credential']);
 const sql={query:async(text,params=[])=>(await db.query(text,params)).rows};
 return {db,sql,params:validateFounderSsoAuthorization(validParams())};
}
test('native verified founder session issues hash-only, 2-minute authorization code',async t=>{
 const {db,sql,params}=await fixture(t);
 assert.equal(await issueFounderSsoCode({sql,userId:'native-user-1',sessionId:'native-session-1',code,params}),true);
 const rows=(await db.query('SELECT * FROM public.vyndi_founder_sso_authorization_codes')).rows;
 assert.equal(rows.length,1);
 assert.equal(rows[0].code_sha256,Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(code))).toString('hex'));
 assert.equal(rows[0].code_challenge,challenge);
 assert.equal(rows[0].consumed_at,null);
 assert.ok(new Date(rows[0].expires_at).getTime()-new Date(rows[0].created_at).getTime()<=120001);
 assert.doesNotMatch(JSON.stringify(rows),/c{24}|v{24}|session_token|password/);
});
test('unverified email, removed admin, expired session, different principal cannot issue code',async t=>{
 const {db,sql,params}=await fixture(t);
 await db.exec('UPDATE public."user" SET "emailVerified"=false');
 assert.equal(await issueFounderSsoCode({sql,userId:'native-user-1',sessionId:'native-session-1',code,params}),false);
 await db.exec("UPDATE public.\"user\" SET \"emailVerified\"=true; UPDATE public.vindy_user_roles SET role='viewer'");
 assert.equal(await issueFounderSsoCode({sql,userId:'native-user-1',sessionId:'native-session-1',code,params}),false);
 await db.exec("UPDATE public.vindy_user_roles SET role='admin'; UPDATE public.\"session\" SET \"expiresAt\"=now()-interval '1 hour'");
 assert.equal(await issueFounderSsoCode({sql,userId:'native-user-1',sessionId:'native-session-1',code,params}),false);
 assert.equal(await issueFounderSsoCode({sql,userId:'attacker',sessionId:'native-session-1',code,params}),false);
});
test('PKCE challenge must match and code can be atomically consumed only once',async t=>{
 const {db,sql,params}=await fixture(t);
 assert.equal(await issueFounderSsoCode({sql,userId:'native-user-1',sessionId:'native-session-1',code,params:{...params,challenge:await sha(verifier)}}),true);
 assert.equal(await redeemFounderSsoCode({sql,code,codeVerifier:'wrong'.repeat(11),clientId:FOUNDER_SSO_CLIENT_ID,redirectUri:FOUNDER_SSO_CALLBACK}),false);
 assert.equal(await redeemFounderSsoCode({sql,code,codeVerifier:verifier,clientId:FOUNDER_SSO_CLIENT_ID,redirectUri:FOUNDER_SSO_CALLBACK}),true);
 assert.equal(await redeemFounderSsoCode({sql,code,codeVerifier:verifier,clientId:FOUNDER_SSO_CLIENT_ID,redirectUri:FOUNDER_SSO_CALLBACK}),false);
 const rows=(await db.query('SELECT consumed_at FROM public.vyndi_founder_sso_authorization_codes')).rows;
 assert.ok(rows[0].consumed_at);
});
test('role, email, and session revocations block code redemption after issuance',async t=>{
 const {db,sql,params}=await fixture(t);
 assert.equal(await issueFounderSsoCode({sql,userId:'native-user-1',sessionId:'native-session-1',code,params:{...params,challenge:await sha(verifier)}}),true);
 await db.exec("UPDATE public.vindy_user_roles SET role='viewer'");
 assert.equal(await redeemFounderSsoCode({sql,code,codeVerifier:verifier,clientId:FOUNDER_SSO_CLIENT_ID,redirectUri:FOUNDER_SSO_CALLBACK}),false);
 await db.exec("UPDATE public.vindy_user_roles SET role='admin'; UPDATE public.\"user\" SET \"emailVerified\"=false");
 assert.equal(await redeemFounderSsoCode({sql,code,codeVerifier:verifier,clientId:FOUNDER_SSO_CLIENT_ID,redirectUri:FOUNDER_SSO_CALLBACK}),false);
});
test('route enforces native Better Auth user, signed VAOS P256 redemption and nonce replay claim',async()=>{
 const authorize=await readFile(new URL('../src/routes/api/sso/authorize.ts',import.meta.url),'utf8');
 const redeem=await readFile(new URL('../src/routes/api/sso/redeem.ts',import.meta.url),'utf8');
 assert.match(authorize,/auth\.api\.getSession/);
 assert.match(authorize,/withAuthPostgresRequest/);
 assert.match(authorize,/issueFounderSsoCode/);
 assert.match(redeem,/verifyVaosBridgeSignature/);
 assert.match(redeem,/claim_vyndi_vaos_bridge_nonce/);
 assert.match(redeem,/redeemFounderSsoCode/);
 assert.doesNotMatch(redeem,/setSessionCookie|createSession|createUser|businessWrite/i);
});
