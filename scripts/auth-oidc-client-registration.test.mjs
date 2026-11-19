import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
test('VAOS client registration screen is fixed-origin, explicit and not self-authorizing',async()=>{
 const page=await readFile(new URL('../src/routes/sso-client.tsx',import.meta.url),'utf8');
 assert.match(page,/authClient\.getSession/);
 assert.match(page,/user\.emailVerified/);
 assert.match(page,/authClient\.oauth2\.createClient/);
 assert.match(page,/https:\/\/vaos\.vayushastr\.workers\.dev\/api\/founder-sso-callback/);
 assert.match(page,/client_secret_basic/);
 assert.match(page,/authorization_code/);
 assert.doesNotMatch(page,/require_pkce:\s*false/);
 assert.doesNotMatch(page,/localStorage|sessionStorage|console\.log/);
 assert.doesNotMatch(page,/document\.cookie|innerHTML|dangerouslySetInnerHTML/);
});
test('issuer has no bootstrap client secret or dynamic registration in source',async()=>{
 const p=await readFile(new URL('../src/lib/auth/founder-oidc-provider.mjs',import.meta.url),'utf8');
 assert.match(p,/VYNDI_SSO_PROVIDER_ENABLED/);
 assert.match(p,/commissioned-v1/);
 assert.match(p,/allowDynamicClientRegistration:false/);
 assert.match(p,/allowUnauthenticatedClientRegistration:false/);
 assert.doesNotMatch(p,/client_secret\s*:\s*["']/);
});
