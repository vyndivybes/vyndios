/**
 * Isolated, real Better Auth 1.7.26 OAuth2.1 token-endpoint PKCE qualification.
 * Never uses production credentials, databases, authorization codes or sessions.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {betterAuth} from 'better-auth';
import {jwt} from 'better-auth/plugins';
import {oauthProvider} from '@better-auth/oauth-provider';
import {pgliteDialect} from '../src/lib/auth/pglite-dialect.ts';
import {founderOidcProviderOptions} from '../src/lib/auth/founder-oidc-provider.mjs';

test('real isolated OIDC issuer rejects wrong PKCE verifier for an authorized one-time code',async t=>{
 const db=new PGlite();await db.waitReady;t.after(()=>db.close());
 await db.exec(await readFile(new URL('../migrations/0001_auth.sql',import.meta.url),'utf8'));
 await db.exec(await readFile(new URL('../migrations/0201_founder_oauth_identity_provider.sql',import.meta.url),'utf8'));
 const base='https://vyndi-pkce-isolated.test/api/auth';
 const redirect='https://vaos-isolated.test/api/founder-sso-callback';
 const auth=betterAuth({
  baseURL:base,
  secret:'test-only-issuer-founding-qual-20261122-not-production',
  database:{dialect:pgliteDialect(()=>db),type:'postgres'},
  emailAndPassword:{enabled:true},
  plugins:[
   jwt({disableSettingJwtHeader:true}),
   oauthProvider(founderOidcProviderOptions({VYNDI_SSO_PROVIDER_ENABLED:'commissioned-v1'})),
  ],
 });
 const signup=await auth.handler(new Request(base+'/sign-up/email',{
  method:'POST',headers:{'content-type':'application/json'},
  body:JSON.stringify({name:'Founder Qualification Fixture',email:'shyamsundhar1982@gmail.com',password:'Test-Only-PKCE-Not-Production-2026!'}),
 }));
 assert.equal(signup.status,200,'isolated fixture signup must create an authenticated session');
 const setCookie=signup.headers.get('set-cookie');
 assert.ok(setCookie,'isolated fixture must receive a session cookie');
 const cookie=setCookie.split(';')[0];
 await db.query('update "user" set "emailVerified"=true where "email"=$1',['shyamsundhar1982@gmail.com']);
 const client=await auth.api.adminCreateOAuthClient({
  headers:new Headers({cookie}),
  body:{
   application_type:'web',redirect_uris:[redirect],
   token_endpoint_auth_method:'client_secret_basic',
   skip_consent:true,require_pkce:true,
  },
 });
 assert.equal(client.require_pkce,true);
 assert.ok(client.client_secret);
 const validVerifier=crypto.randomBytes(48).toString('base64url');
 const badVerifier=crypto.randomBytes(48).toString('base64url');
 const challenge=crypto.createHash('sha256').update(validVerifier).digest('base64url');
 assert.notEqual(crypto.createHash('sha256').update(badVerifier).digest('base64url'),challenge);
 const authorize=new URL(base+'/oauth2/authorize');
 for(const [k,v] of Object.entries({
  response_type:'code',client_id:client.client_id,
  redirect_uri:redirect,scope:'openid email',state:'pkce-isolated-test-state',
  nonce:'pkce-isolated-test-nonce',code_challenge:challenge,code_challenge_method:'S256',
 }))authorize.searchParams.set(k,v);
 const granted=await auth.handler(new Request(authorize,{headers:{cookie},redirect:'manual'}));
 assert.equal(granted.status,302,'fixture must receive real provider authorization code');
 const location=granted.headers.get('location');
 assert.ok(location?.startsWith(redirect),'provider must redirect to registered client only');
 const code=new URL(location).searchParams.get('code');
 assert.ok(code,'fixture must have a real authorization code');
 const exchange=verifier=>auth.handler(new Request(base+'/oauth2/token',{
  method:'POST',headers:{
   'content-type':'application/x-www-form-urlencoded',
   authorization:'Basic '+Buffer.from(client.client_id+':'+client.client_secret).toString('base64'),
  },
  body:new URLSearchParams({grant_type:'authorization_code',client_id:client.client_id,
   code,redirect_uri:redirect,code_verifier:verifier}),
 }));
 const rejected=await exchange(badVerifier);
 assert.equal(rejected.status,400,'wrong verifier must fail at provider token endpoint');
 const result=await rejected.json();
 assert.equal(result.error,'invalid_grant');
 assert.equal(result.access_token,undefined);
 assert.equal(result.id_token,undefined);
});
