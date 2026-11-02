import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {betterAuth} from "better-auth";
import {genericOAuth} from "better-auth/plugins";
import {grokAccountSubject} from "../src/lib/auth/provider-subject.ts";

test("Grok provider identity uses immutable OpenID sub and fails closed",()=>{
 assert.equal(grokAccountSubject({sub:"immutable-sub"}),"immutable-sub");
 assert.equal(grokAccountSubject({sub:42}),"42");
 for(const value of [null,undefined,{},NaN,""])assert.throws(()=>grokAccountSubject({sub:value}),/immutable sub/);
});
test("Better Auth 1.7 email login and generic social PKCE initialize without schema migration",async()=>{
 const origin="http://localhost:3000";
 const auth=betterAuth({
  baseURL:origin,secret:"synthetic-ci-only-auth-secret-20261102",
  emailAndPassword:{enabled:true,autoSignIn:false},
  plugins:[genericOAuth({config:[{
   providerId:"grok-test",clientId:"synthetic-client",clientSecret:"synthetic-secret",
   authorizationUrl:"https://broker.example.invalid/authorize",tokenUrl:"https://broker.example.invalid/token",
   userInfoUrl:"https://broker.example.invalid/userinfo",scopes:["openid","profile","email"],
   accountSubject:({profile})=>grokAccountSubject(profile),
  }]})],
 });
 const post=(path,body)=>auth.handler(new Request(origin+"/api/auth/"+path,{method:"POST",headers:{"content-type":"application/json",origin},body:JSON.stringify(body)}));
 const credentials={email:"synthetic-audit@example.invalid",password:"Synthetic-only-password-2026",name:"Synthetic CI"};
 const created=await post("sign-up/email",credentials);
 assert.ok(created.ok,"Synthetic signup must succeed");
 const signed=await post("sign-in/email",credentials);
 assert.ok(signed.ok,"Existing email/password contract must succeed");
 const cookies=signed.headers.getSetCookie().map(c=>c.split(";")[0]).join("; ");
 const session=await auth.handler(new Request(origin+"/api/auth/get-session",{headers:{cookie:cookies}}));
 assert.equal((await session.json()).user.email,credentials.email);
 const oauth=await post("sign-in/social",{provider:"grok-test",callbackURL:origin+"/command",disableRedirect:true});
 assert.ok(oauth.ok,"Standard social-provider API must initialize");
 const authorization=new URL((await oauth.json()).url);
 assert.equal(authorization.searchParams.get("redirect_uri"),origin+"/api/auth/callback/grok-test");
 assert.ok(authorization.searchParams.get("code_challenge"));
 assert.equal(authorization.searchParams.get("code_challenge_method"),"S256");
});
test("application uses supported 1.7 social client and popup APIs",async()=>{
 const client=await readFile(new URL("../src/lib/auth/client.ts",import.meta.url),"utf8");
 const popup=await readFile(new URL("../src/lib/auth/popup.server.ts",import.meta.url),"utf8");
 assert.doesNotMatch(client,/genericOAuthClient|signIn\.oauth2/);
 assert.match(client,/authClient\.signIn\.social/);
 assert.match(popup,/auth\.api\.signInSocial/);
 assert.doesNotMatch(popup,/signInWithOAuth2/);
});
