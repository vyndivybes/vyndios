import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const dsn=process.env.A01_TENANT_TEST_DATABASE_URL;
assert.ok(dsn,'Dedicated A01 tenant test database required');
const u=new URL(dsn);
assert.ok(['localhost','127.0.0.1','::1'].includes(u.hostname),'Refuse remote database');
assert.equal(u.pathname,'/a01_tenant_test','Refuse any non-test database');
const path=join(dirname(fileURLToPath(import.meta.url)),'../migrations/0210_a01_private_tenant_ownership_candidate.sql');
const A='a'.repeat(64);
const B='b'.repeat(64);

test('A01 private two-company tenant ownership is RLS-isolated, not a production identity grant',async t=>{
 const client=new pg.Client({connectionString:dsn,connectionTimeoutMillis:5000,statement_timeout:10000});
 await client.connect();t.after(()=>client.end());
 const migration=await readFile(path,'utf8');
 assert.doesNotMatch(migration,/GRANT\s+(SELECT|INSERT|UPDATE|DELETE|EXECUTE)\s+.*TO\s+(hyperdrive|PUBLIC)/i);
 assert.doesNotMatch(migration,/\bBYPASSRLS\b\s*(?:=|TO)/i);
 await client.query(migration);

 const s='vyndi_a01_tenant_candidate';
 await client.query(`
 CREATE ROLE a01_tenant_alpha NOLOGIN NOSUPERUSER NOBYPASSRLS;
 CREATE ROLE a01_tenant_beta NOLOGIN NOSUPERUSER NOBYPASSRLS;
 CREATE ROLE a01_tenant_intruder NOLOGIN NOSUPERUSER NOBYPASSRLS;
 CREATE ROLE a01_tenant_revoked NOLOGIN NOSUPERUSER NOBYPASSRLS;
 INSERT INTO ${s}.company_candidates(tenant_id,legal_label)
 VALUES ('tenant_alpha','TEST: Alpha'),('tenant_beta','TEST: Beta');
 INSERT INTO ${s}.actor_memberships(tenant_id,db_role,membership_state,approval_sha256)
 VALUES ('tenant_alpha','a01_tenant_alpha','approved','${A}'),
        ('tenant_beta','a01_tenant_beta','approved','${B}'),
        ('tenant_alpha','a01_tenant_revoked','revoked','${A}');
 INSERT INTO ${s}.source_ownership_candidates(tenant_id,entity_type,entity_id,attribution_state,provenance_sha256)
 VALUES ('tenant_alpha','inventory_ledger','same-sku-alpha','observed','${A}'),
        ('tenant_beta','inventory_ledger','same-sku-beta','observed','${B}'),
        ('tenant_beta','purchase_order','po-beta','observed','${B}'),
        ('tenant_alpha','inventory_reservation','pending-alpha','candidate',NULL);
 GRANT USAGE ON SCHEMA ${s} TO a01_tenant_alpha,a01_tenant_beta,a01_tenant_intruder,a01_tenant_revoked;
 GRANT SELECT ON ${s}.actor_memberships,${s}.source_ownership_candidates,${s}.visible_ownership_candidates
   TO a01_tenant_alpha,a01_tenant_beta,a01_tenant_intruder,a01_tenant_revoked;`);
 const asRole=async(role,fn)=>{
  await client.query('SET ROLE '+role);
  try{return await fn();}finally{await client.query('RESET ROLE');}
 };
 const visible=()=>client.query(`SELECT tenant_id,entity_type,entity_id,source_completeness_verified,
 business_write_authorized FROM ${s}.visible_ownership_candidates ORDER BY entity_type,entity_id`);
 await t.test('two independently signed fixture companies see exactly their own observed objects',async()=>{
  const rowsAlpha=await asRole('a01_tenant_alpha',async()=> (await visible()).rows);
  const rowsBeta=await asRole('a01_tenant_beta',async()=> (await visible()).rows);
  assert.deepEqual(rowsAlpha.map(x=>x.entity_id),['same-sku-alpha']);
  assert.deepEqual(rowsBeta.map(x=>x.entity_id).sort(),['po-beta','same-sku-beta']);
  assert.ok(rowsAlpha.every(x=>x.tenant_id==='tenant_alpha'));
  assert.ok(rowsBeta.every(x=>x.tenant_id==='tenant_beta'));
  assert.ok([...rowsAlpha,...rowsBeta].every(x=>x.source_completeness_verified===false&&x.business_write_authorized===false));
 });
 await t.test('unaffiliated and revoked roles see zero rows',async()=>{
  assert.equal((await asRole('a01_tenant_intruder',async()=> (await visible()).rows)).length,0);
  assert.equal((await asRole('a01_tenant_revoked',async()=> (await visible()).rows)).length,0);
 });
 await t.test('forgeable app.tenant_id setting grants no foreign ownership',async()=>{
  const rows=await asRole('a01_tenant_alpha',async()=>{
   await client.query("SELECT set_config('app.tenant_id','tenant_beta',false)");
   return (await visible()).rows;
  });
  assert.deepEqual(rows.map(x=>x.entity_id),['same-sku-alpha']);
 });
 await t.test('pending source ownership is invisible; reassignment with duplicate key is rejected',async()=>{
  const rows=await asRole('a01_tenant_alpha',async()=> (await visible()).rows);
  assert.ok(!rows.some(x=>x.entity_id==='pending-alpha'));
  await assert.rejects(client.query(`INSERT INTO ${s}.source_ownership_candidates
   (tenant_id,entity_type,entity_id,attribution_state,provenance_sha256)
   VALUES ('tenant_beta','inventory_ledger','same-sku-alpha','observed','${B}')`),e=>e.code==='23505');
 });
 await t.test('no tenant observer can mutate membership or cross-tenant ownership',async()=>{
  await asRole('a01_tenant_alpha',async()=>{
    await assert.rejects(client.query(`UPDATE ${s}.actor_memberships SET membership_state='approved'
      WHERE db_role='a01_tenant_revoked'`),e=>e.code==='42501');
    await assert.rejects(client.query(`INSERT INTO ${s}.source_ownership_candidates
      (tenant_id,entity_type,entity_id,attribution_state,provenance_sha256)
      VALUES('tenant_beta','purchase_order','forged','observed','${B}')`),e=>e.code==='42501');
  });
 });
 await t.test('privileged fixture revocation takes effect on next read, no stale authorization',async()=>{
  await client.query(`UPDATE ${s}.actor_memberships SET membership_state='revoked'
    WHERE db_role='a01_tenant_alpha'`);
  assert.equal((await asRole('a01_tenant_alpha',async()=> (await visible()).rows)).length,0);
 });
 await t.test('the migration grants no access to PUBLIC or current broad runtime role',async()=>{
  const {rows:[p]}=await client.query(`SELECT
    has_schema_privilege('public','${s}','USAGE') public_schema,
    has_table_privilege('public','${s}.source_ownership_candidates','SELECT') public_source_select,
    (SELECT relrowsecurity AND relforcerowsecurity FROM pg_class WHERE oid='${s}.actor_memberships'::regclass) membership_forced_rls,
    (SELECT relrowsecurity AND relforcerowsecurity FROM pg_class WHERE oid='${s}.source_ownership_candidates'::regclass) ownership_forced_rls`);
  assert.deepEqual(p,{public_schema:false,public_source_select:false,membership_forced_rls:true,ownership_forced_rls:true});
 });
});
