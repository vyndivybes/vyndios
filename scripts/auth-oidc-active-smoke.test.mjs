import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {betterAuth} from 'better-auth';
import {jwt} from 'better-auth/plugins';
import {oauthProvider} from '@better-auth/oauth-provider';
import {pgliteDialect} from '../src/lib/auth/pglite-dialect.ts';
import {founderOidcProviderOptions} from '../src/lib/auth/founder-oidc-provider.mjs';

test('feature flag requires exact controlled issuer commissioning, never password/login cutover',async()=>{
 const file=JSON.parse(await readFile(new URL('../wrangler.jsonc',import.meta.url),'utf8'));
 assert.equal(file.name,'vyndios');
 assert.equal(file.vars.VYNDI_SSO_PROVIDER_ENABLED,'commissioned-v1');
 assert.equal(file.vars.VYNDI_SSO_TRUSTED_CLIENT_ID,undefined);
 assert.equal(file.vars.VAOS_VYNDI_OIDC_ENABLED,undefined);
 assert.doesNotMatch(JSON.stringify(file.vars),/client_secret|password|privateKey|access_token/i);
});
test('official VYNDI issuer discovers OIDC over active JWT plugin and isolated real PostgreSQL-compatible schema',async t=>{
 const db=new PGlite();await db.waitReady;t.after(()=>db.close());
 const core=await readFile(new URL('../migrations/0001_auth.sql',import.meta.url),'utf8');
 const newTables=await readFile(new URL('../migrations/0201_founder_oauth_identity_provider.sql',import.meta.url),'utf8');
 await db.exec(core);
 await db.exec(newTables);
 const options=founderOidcProviderOptions({VYNDI_SSO_PROVIDER_ENABLED:'commissioned-v1'});
 assert.ok(options);
 const auth=betterAuth({
  baseURL:'https://vyndi-local.test/api/auth',
  secret:'isolated-only-not-production-jwt-issuer-20261120',
  database:{dialect:pgliteDialect(()=>db),type:'postgres'},
  disabledPaths:['/token'],
  plugins:[jwt({disableSettingJwtHeader:true}),oauthProvider(options)],
 });
 const response=await auth.handler(new Request('https://vyndi-local.test/api/auth/.well-known/openid-configuration'));
 assert.equal(response.status,200,'active issuer must return OIDC discovery');
 const metadata=await response.json();
 assert.equal(metadata.issuer,'https://vyndi-local.test/api/auth');
 assert.ok(typeof metadata.authorization_endpoint==='string'&&metadata.authorization_endpoint.includes('/oauth2/authorize'));
 assert.ok(typeof metadata.token_endpoint==='string'&&metadata.token_endpoint.includes('/oauth2/token'));
 assert.ok(typeof metadata.jwks_uri==='string'&&metadata.jwks_uri.startsWith('https://vyndi-local.test/api/auth/'));
 assert.equal(metadata.scopes_supported.includes('openid'),true);
 const jwtEndpoint=await auth.handler(new Request('https://vyndi-local.test/api/auth/token'));
 assert.notEqual(jwtEndpoint.status,200,'generic /token cannot issue session JWTs for provider');
});
