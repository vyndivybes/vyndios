import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {founderOidcProviderOptions,founderCanManageOidcClient,founderOidcProviderEnabled} from '../src/lib/auth/founder-oidc-provider.mjs';

test('OIDC Provider is OFF by default, even with an existing verified founder',()=>{
 for(const value of [undefined,'','true','1','commissioned','preview','COMMISSIONED-V1'])
  assert.equal(founderOidcProviderEnabled({VYNDI_SSO_PROVIDER_ENABLED:value}),false);
 assert.equal(founderOidcProviderOptions({}),null);
});
test('explicit issuer controls only narrow OIDC scopes, fixed origin and strict private client policy',()=>{
 const options=founderOidcProviderOptions({VYNDI_SSO_PROVIDER_ENABLED:'commissioned-v1',VYNDI_SSO_TRUSTED_CLIENT_ID:'founder-vaos-client'});
 assert.equal(options.loginPage,'/login');
 assert.equal(options.consentPage,'/sso-consent');
 assert.equal(options.allowDynamicClientRegistration,false);
 assert.equal(options.allowUnauthenticatedClientRegistration,false);
 assert.equal(options.clientRegistrationRequirePKCE,true);
 assert.deepEqual(options.scopes,['openid','email']);
 assert.deepEqual([...options.cachedTrustedClients],['founder-vaos-client']);
 assert.equal(typeof options.clientPrivileges,'function');
 assert.equal(options.pairwiseSecret,undefined);
 assert.equal(options.disableJwtPlugin,undefined);
});
test('only the existing verified Better Auth founder can manage OAuth clients',async()=>{
 for(const user of [
  null,{email:'shyamsundhar1982@gmail.com',emailVerified:false},
  {email:'other@example.com',emailVerified:true},
  {email:'shyamsundhar1982+test@gmail.com',emailVerified:true},
  {email:'shyamsundhar1982@gmail.com',emailVerified:'true'},
 ]){
  assert.equal(await founderCanManageOidcClient({user}),false);
 }
 assert.equal(await founderCanManageOidcClient({user:{id:'verified-owner-id',email:'shyamsundhar1982@gmail.com',emailVerified:true},session:{userId:'verified-owner-id'}}),true);
 assert.equal(await founderCanManageOidcClient({user:{id:'verified-owner-id',email:'shyamsundhar1982@gmail.com',emailVerified:true},session:{userId:'another-user-id'}}),false);
});
test('trusted-client id cannot be attacker-controlled or wildcarded',()=>{
 for(const id of ['*','', 'https://evil.invalid','client id with spaces','../../evil', 'a'.repeat(150)]){
  assert.throws(()=>founderOidcProviderOptions({VYNDI_SSO_PROVIDER_ENABLED:'commissioned-v1',VYNDI_SSO_TRUSTED_CLIENT_ID:id}),/OIDC_TRUSTED_CLIENT_INVALID/);
 }
});
test('Better Auth mounts official provider with consent-client plugin and no unauthenticated registration',async()=>{
 const server=await readFile(new URL('../src/lib/auth/server.ts',import.meta.url),'utf8');
 const client=await readFile(new URL('../src/lib/auth/client.ts',import.meta.url),'utf8');
 const pkg=JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8'));
 assert.equal(pkg.dependencies['@better-auth/oauth-provider'],'1.7.26');
 assert.equal(pkg.dependencies['better-auth'],'1.7.26');
 assert.match(server,/import\s*\{\s*oauthProvider\s*\}\s*from\s*["']@better-auth\/oauth-provider["']/);
 assert.match(server,/founderOidcProviderOptions/);
 assert.match(server,/oauthProvider\(founderOidcOptions\)/);
 assert.match(client,/oauthProviderClient\(\)/);
 assert.doesNotMatch(server,/allowUnauthenticatedClientRegistration:\s*true/);
});
test('dedicated consent UI does not silently approve scopes or cross-site redirects',async()=>{
 const page=await readFile(new URL('../src/routes/sso-consent.tsx',import.meta.url),'utf8');
 assert.match(page,/authClient\.oauth2\.consent/);
 assert.match(page,/decision\(false\)/);
 assert.match(page,/decision\(true\)/);
 assert.match(page,/scope:accept\?"openid email":undefined/);
 assert.doesNotMatch(page,/window\.location\.href\s*=\s*.*searchParams/);
});
