import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';

const EXPECTED=['jwks','oauthClient','oauthResource','oauthClientResource','oauthRefreshToken','oauthAccessToken','oauthConsent','oauthClientAssertion'];
test('new Better Auth OAuth/JWKS migration is additive against a pre-existing identity',async t=>{
 const db=new PGlite();await db.waitReady;t.after(()=>db.close());
 const base=await readFile(new URL('../migrations/0001_auth.sql',import.meta.url),'utf8');
 await db.exec(base);
 const beforeColumns=await db.query("SELECT table_name,column_name,data_type FROM information_schema.columns WHERE table_schema='public' AND table_name IN ('user','session','account','verification') ORDER BY table_name,column_name");
 await db.query('INSERT INTO public."user" ("id","name","email","emailVerified","createdAt","updatedAt") VALUES ($1,$2,$3,$4,now(),now())',
 ['founder-verified','MD','founder@example.invalid',true]);
 const migration=await readFile(new URL('../migrations/0201_founder_oauth_identity_provider.sql',import.meta.url),'utf8');
 assert.doesNotMatch(migration,/^\s*(drop|truncate|alter|delete|update|insert)\s/mi);
 const statements=migration.split(/;\s*(?:\n|$)/).filter(s=>/\bcreate (?:unique )?index\b|\bcreate table\b/i.test(s));
 assert.ok(statements.length>=20);
 await db.exec(migration);
 const tables=(await db.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'")).rows.map(x=>x.table_name);
 for(const table of EXPECTED)assert.ok(tables.includes(table),'missing OAuth table '+table);
 const afterColumns=await db.query("SELECT table_name,column_name,data_type FROM information_schema.columns WHERE table_schema='public' AND table_name IN ('user','session','account','verification') ORDER BY table_name,column_name");
 assert.deepEqual(afterColumns.rows,beforeColumns.rows);
 const matched=await db.query("SELECT id,\"emailVerified\" FROM public.\"user\" WHERE id='founder-verified'");
 assert.deepEqual(matched.rows,[{id:'founder-verified',emailVerified:true}]);
});
test('existing core auth tables must never be part of deployable OAuth migration',async()=>{
 const ddl=await readFile(new URL('../migrations/0201_founder_oauth_identity_provider.sql',import.meta.url),'utf8');
 for(const table of ['user','session','account','verification']){
  assert.doesNotMatch(ddl,new RegExp('create table "'+table+'"','i'));
 }
 for(const table of EXPECTED)assert.match(ddl,new RegExp('create table "'+table+'"','i'));
});
