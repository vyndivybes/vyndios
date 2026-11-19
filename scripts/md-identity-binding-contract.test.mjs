import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {readManagingDirectorIdentityEvidence} from '../src/lib/vaos-md-identity-read.mjs';

test('a declared MD account is not authenticated without verified email and native session',async()=>{
 const input=[];
 const sql={query:async(query,params)=>{
  input.push({query,params});
  return [{identity_count:1,verified_identity_count:0,admin_assignment_count:1,
   linked_provider_count:1,unexpired_session_count:9}];
 }};
 const r=await readManagingDirectorIdentityEvidence({sql});
 assert.equal(r.schemaVersion,'VYNDI_MD_IDENTITY_EVIDENCE_V1');
 assert.equal(r.status,'HOLD');
 assert.equal(r.existingAccountLocated,true);
 assert.equal(r.emailVerified,false);
 assert.equal(r.adminRoleAssigned,true);
 assert.equal(r.vaosSessionVerifiedHere,false);
 assert.equal(r.vyndiBrowserSessionVerifiedHere,false);
 assert.equal(r.crossPlatformSsoEnabled,false);
 assert.equal(r.mdAuthenticatedAcrossBoth,false);
 assert.equal(r.productionWriteAuthorized,false);
 assert.ok(r.holds.includes('VYNDI_EMAIL_NOT_VERIFIED'));
 assert.ok(r.holds.includes('INDEPENDENT_BROWSER_SESSION_AND_SSO_UNVERIFIED'));
 assert.equal(input.length,1);
 assert.deepEqual(input[0].params,['shyamsundhar1982@gmail.com']);
 assert.doesNotMatch(JSON.stringify(r),/shyamsundhar1982|providerId|sessionToken|password/);
});
test('verified VYNDI identity still does not confer VAOS login or automatic mutation rights',async()=>{
 const sql={query:async()=>[{identity_count:1,verified_identity_count:1,admin_assignment_count:1,
  linked_provider_count:1,unexpired_session_count:1}]};
 const r=await readManagingDirectorIdentityEvidence({sql});
 assert.equal(r.emailVerified,true);
 assert.equal(r.adminRoleAssigned,true);
 assert.equal(r.status,'HOLD');
 assert.equal(r.mdAuthenticatedAcrossBoth,false);
 assert.equal(r.businessApprovalAuthorized,false);
 assert.ok(r.holds.includes('INDEPENDENT_BROWSER_SESSION_AND_SSO_UNVERIFIED'));
});
test('unknown or duplicate accounts and identity spoof selectors fail closed',async()=>{
 const sql={query:async()=>[{identity_count:2,verified_identity_count:1,admin_assignment_count:1,
  linked_provider_count:1,unexpired_session_count:1}]};
 const r=await readManagingDirectorIdentityEvidence({sql});
 assert.equal(r.existingAccountLocated,false);
 assert.equal(r.status,'HOLD');
 assert.ok(r.holds.includes('FOUNDER_IDENTITY_NOT_UNIQUE'));
 for(const scope of [{email:'attacker@invalid.test'},{userId:'forced'},{principal:'fake'},{tenantId:'T-2'}]){
  await assert.rejects(()=>readManagingDirectorIdentityEvidence({sql,...scope}),/MD_IDENTITY_SCOPE_FORBIDDEN/);
 }
});
test('invalid count snapshots are rejected and never upgraded to certified authority',async()=>{
 for(const row of [null,{}, {identity_count:-1}, {identity_count:'1',verified_identity_count:1},
  {identity_count:1,verified_identity_count:2,admin_assignment_count:0,
   linked_provider_count:0,unexpired_session_count:0}]){
  const sql={query:async()=>row?[row]:[]};
  await assert.rejects(()=>readManagingDirectorIdentityEvidence({sql}),/MD_IDENTITY_EVIDENCE_INVALID/);
 }
});
test('real isolated PostgreSQL counts distinguish verified identity from assigned admin role',async t=>{
 const db=new PGlite();await db.waitReady;t.after(()=>db.close());
 await db.exec([
  'CREATE TABLE public."user" (id text PRIMARY KEY,email text NOT NULL,"emailVerified" boolean NOT NULL);',
  'CREATE TABLE public.vindy_user_roles (user_id text PRIMARY KEY,role text NOT NULL);',
  'CREATE TABLE public."account" (id text,userId text,"userId" text,providerId text);'
 ].slice(0,2).join('\n'));
 await db.exec('CREATE TABLE public."account" (id text,"userId" text); CREATE TABLE public."session" (id text,"userId" text,"expiresAt" timestamptz);');
 await db.query('INSERT INTO public."user" VALUES($1,$2,false)', ['u1','shyamsundhar1982@gmail.com']);
 await db.query('INSERT INTO public.vindy_user_roles VALUES($1,$2)',['u1','admin']);
 await db.query('INSERT INTO public."account" VALUES($1,$2)',['account1','u1']);
 await db.query('INSERT INTO public."session" VALUES($1,$2,now()+interval \'1 hour\')',['session1','u1']);
 const sql={query:async (text,params)=>(await db.query(text,params)).rows};
 const hold=await readManagingDirectorIdentityEvidence({sql});
 assert.equal(hold.emailVerified,false);
 assert.equal(hold.adminRoleAssigned,true);
 await db.exec('UPDATE public."user" SET "emailVerified"=true WHERE id=\'u1\'');
 const verified=await readManagingDirectorIdentityEvidence({sql});
 assert.equal(verified.emailVerified,true);
 assert.equal(verified.crossPlatformSsoEnabled,false);
 assert.equal(verified.productionWriteAuthorized,false);
});
test('signed VYNDI endpoint requires a nonce-claimed authenticated service request',async()=>{
 const route=await readFile(new URL('../src/routes/api/vaos/bridge.ts',import.meta.url),'utf8');
 assert.match(route,/GOVERNANCE\.OBSERVE_MD_IDENTITY/);
 assert.match(route,/readManagingDirectorIdentityEvidence/);
 assert.match(route,/verifyVaosBridgeSignature/);
 assert.match(route,/claim_vyndi_vaos_bridge_nonce/);
 assert.match(route,/write_execution_not_commissioned/);
});
