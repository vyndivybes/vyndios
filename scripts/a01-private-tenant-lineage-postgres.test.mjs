import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import pg from 'pg';

const dsn=process.env.A01_TEST_DATABASE_URL;
assert.ok(dsn,'Disposable A01_TEST_DATABASE_URL is mandatory');
const u=new URL(dsn);
assert.ok(['localhost','127.0.0.1','::1'].includes(u.hostname),'Never access a remote database');
assert.equal(u.pathname,'/a01_test','Only isolated a01_test database is accepted');
const root=join(dirname(fileURLToPath(import.meta.url)),'..');
const {Client}=pg;
const H='a'.repeat(64);

test('A01 private tenant membership and object ownership never promote unverified business source',async t=>{
 const db=new Client({connectionString:dsn,connectionTimeoutMillis:3000,statement_timeout:8000});
 await db.connect();t.after(()=>db.end());
 await db.query(`
  CREATE FUNCTION public.vyndi_canonical_unit(x text) RETURNS text
  LANGUAGE sql IMMUTABLE STRICT AS $$
    SELECT CASE lower(trim(x)) WHEN 'unit' THEN 'ea' WHEN 'each' THEN 'ea'
    ELSE lower(trim(x)) END $$;
  CREATE TABLE public.vyndi_sales_orders(id text PRIMARY KEY,revision integer NOT NULL);
  CREATE TABLE public.epr_production_job_cards(
   id text PRIMARY KEY,sales_order_id text NOT NULL,sales_order_revision integer NOT NULL);
  CREATE TABLE public.epr_production_job_card_lines(
   id text PRIMARY KEY,job_card_id text NOT NULL,sku text,unit text NOT NULL);
  CREATE TABLE public.epr_inventory_reservations(
   id text PRIMARY KEY,job_card_id text NOT NULL,job_card_line_id text NOT NULL,
   sales_order_id text NOT NULL,sales_order_revision integer NOT NULL,
   sku text NOT NULL,unit text NOT NULL,status text NOT NULL);
  CREATE TABLE public.vyndi_purchase_orders(
   id text PRIMARY KEY,job_card_id text);
 `);
 await db.query(`INSERT INTO public.vyndi_sales_orders VALUES ('SO-A',2),('SO-B',1)`);
 await db.query(`INSERT INTO public.epr_production_job_cards
  VALUES ('JOB-A','SO-A',2),('JOB-B','SO-B',1)`);
 await db.query(`INSERT INTO public.epr_production_job_card_lines
  VALUES ('LINE-A','JOB-A','OVERLAP','unit'),('LINE-B','JOB-B','OVERLAP','each')`);
 await db.query(`INSERT INTO public.epr_inventory_reservations
  VALUES
 ('RES-A','JOB-A','LINE-A','SO-A',2,'OVERLAP','unit','active'),
 ('RES-B','JOB-B','LINE-B','SO-B',1,'OVERLAP','each','active'),
 ('RES-CROSS','JOB-B','LINE-B','SO-B',1,'OVERLAP','unit','active'),
 ('RES-UNBOUND','JOB-A','LINE-A','SO-A',2,'OVERLAP','unit','active'),
 ('RES-REV','JOB-A','LINE-A','SO-A',999,'OVERLAP','unit','active')`);
 await db.query(`INSERT INTO public.vyndi_purchase_orders
  VALUES ('PO-A','JOB-A'),('PO-B','JOB-B'),('PO-CROSS','JOB-B'),('PO-NOJOB',NULL)`);

 for(const m of ['0200_a01_private_tenant_ownership_candidate.sql','0201_a01_private_business_lineage_candidate.sql']){
  await db.query(await readFile(join(root,'migrations',m),'utf8'));
 }
 const bind=async(type,id,tenant)=>
  db.query(`INSERT INTO vyndi_a01_tenant_candidate.a01_object_owner_candidates
    (object_type,object_id,tenant_id,source_digest,source_revision,bound_by,reviewed_by)
    VALUES($1,$2,$3,$4,$5,$6,$7)`,[type,id,tenant,H,'fixture-revision-1','maker','checker']);
 await db.query(`INSERT INTO vyndi_a01_tenant_candidate.company_candidates(tenant_id,legal_label)
  VALUES('tenant_alpha','Fixture Alpha'),('tenant_beta','Fixture Beta')`);
 for(const [type,id,tenant] of [
  ['sales_order','SO-A','tenant_alpha'],['sales_order','SO-B','tenant_beta'],
  ['job_card','JOB-A','tenant_alpha'],['job_card','JOB-B','tenant_beta'],
  ['job_line','LINE-A','tenant_alpha'],['job_line','LINE-B','tenant_beta'],
  ['reservation','RES-A','tenant_alpha'],['reservation','RES-B','tenant_beta'],
  ['reservation','RES-CROSS','tenant_alpha'],['reservation','RES-REV','tenant_alpha'],
  ['purchase_order','PO-A','tenant_alpha'],['purchase_order','PO-B','tenant_beta'],
  ['purchase_order','PO-CROSS','tenant_alpha'],['purchase_order','PO-NOJOB','tenant_alpha']
 ])await bind(type,id,tenant);
 const reservations=async()=> (await db.query(`
  SELECT reservation_id,candidate_tenant_id,lineage_status,source_authority_verified,
   production_write_authorized
  FROM vyndi_a01_tenant_candidate.a01_reservation_tenant_lineage_candidate ORDER BY reservation_id`)).rows;
 const po=async()=> (await db.query(`
  SELECT purchase_order_id,candidate_tenant_id,lineage_status
  FROM vyndi_a01_tenant_candidate.a01_purchase_order_tenant_lineage_candidate ORDER BY purchase_order_id`)).rows;

 await t.test('two companies with same SKU have independently named candidate owner, never source authority',async()=>{
  const v=await reservations();
  assert.equal(v.find(x=>x.reservation_id==='RES-A')?.candidate_tenant_id,'tenant_alpha');
  assert.equal(v.find(x=>x.reservation_id==='RES-B')?.candidate_tenant_id,'tenant_beta');
  assert.equal(v.find(x=>x.reservation_id==='RES-A')?.lineage_status,'CANDIDATE_ONLY_UNVERIFIED');
  assert.equal(v.find(x=>x.reservation_id==='RES-B')?.lineage_status,'CANDIDATE_ONLY_UNVERIFIED');
  assert.ok(v.every(x=>x.source_authority_verified===false&&x.production_write_authorized===false));
 });
 await t.test('cross-tenant and missing owner bindings must hold even with matching SKU',async()=>{
  const v=await reservations();
  assert.equal(v.find(x=>x.reservation_id==='RES-CROSS')?.lineage_status,'HOLD_OWNER_OR_PARENT_MISMATCH');
  assert.equal(v.find(x=>x.reservation_id==='RES-CROSS')?.candidate_tenant_id,null);
  assert.equal(v.find(x=>x.reservation_id==='RES-UNBOUND')?.lineage_status,'HOLD_OWNER_OR_PARENT_MISMATCH');
  assert.equal(v.find(x=>x.reservation_id==='RES-REV')?.lineage_status,'HOLD_OWNER_OR_PARENT_MISMATCH');
 });
 await t.test('POs hold missing job and cross-tenant parent while preserving candidates',async()=>{
  const v=await po();
  assert.equal(v.find(x=>x.purchase_order_id==='PO-A')?.lineage_status,'CANDIDATE_ONLY_UNVERIFIED');
  assert.equal(v.find(x=>x.purchase_order_id==='PO-B')?.candidate_tenant_id,'tenant_beta');
  assert.equal(v.find(x=>x.purchase_order_id==='PO-CROSS')?.lineage_status,'HOLD_OWNER_OR_PARENT_MISMATCH');
  assert.equal(v.find(x=>x.purchase_order_id==='PO-NOJOB')?.lineage_status,'HOLD_OWNER_OR_PARENT_MISMATCH');
 });
 await t.test('membership is append-only and latest REVOKE denies subsequent candidate',async()=>{
  await db.query(`INSERT INTO vyndi_a01_tenant_candidate.a01_membership_events
   (tenant_id,principal_id,event_type,evidence_digest,approved_by)
   VALUES('tenant_alpha','principal-A','GRANT',$1,'independent-reviewer')`,[H]);
  await db.query(`INSERT INTO vyndi_a01_tenant_candidate.a01_membership_events
   (tenant_id,principal_id,event_type,evidence_digest,approved_by)
   VALUES('tenant_beta','principal-B','GRANT',$1,'independent-reviewer')`,[H]);
  await db.query(`INSERT INTO vyndi_a01_tenant_candidate.a01_membership_events
   (tenant_id,principal_id,event_type,evidence_digest,approved_by)
   VALUES('tenant_alpha','principal-A','REVOKE',$1,'independent-reviewer')`,[H]);
  const {rows}=await db.query(`SELECT tenant_id,principal_id,is_active
    FROM vyndi_a01_tenant_candidate.a01_member_state_candidate ORDER BY tenant_id`);
  assert.deepEqual(rows,[{tenant_id:'tenant_alpha',principal_id:'principal-A',is_active:false},
   {tenant_id:'tenant_beta',principal_id:'principal-B',is_active:true}]);
 });
 await t.test('a newer REVOKE event must deny pre-existing RLS visibility, not just mark a separate ledger',async()=>{
  const role='a01_runtime_candidate';
  await db.query('CREATE ROLE '+role+' NOLOGIN NOSUPERUSER NOBYPASSRLS');
  await db.query(`INSERT INTO vyndi_a01_tenant_candidate.actor_memberships
    (tenant_id,db_role,membership_state,approval_sha256)
    VALUES ('tenant_alpha',$1,'approved',$2)`,[role,H]);
  await db.query(`INSERT INTO vyndi_a01_tenant_candidate.source_ownership_candidates
   (tenant_id,entity_type,entity_id,attribution_state,provenance_sha256)
   VALUES ('tenant_alpha','inventory_ledger','FIXTURE-ID','observed',$1)`,[H]);
  await db.query(`INSERT INTO vyndi_a01_tenant_candidate.a01_membership_events
   (tenant_id,principal_id,event_type,evidence_digest,approved_by)
   VALUES ('tenant_alpha',$1,'GRANT',$2,'checker')`,[role,H]);
  await db.query(`GRANT USAGE ON SCHEMA vyndi_a01_tenant_candidate TO a01_runtime_candidate;
   GRANT SELECT ON vyndi_a01_tenant_candidate.actor_memberships,
   vyndi_a01_tenant_candidate.source_ownership_candidates,
   vyndi_a01_tenant_candidate.visible_ownership_candidates,
   vyndi_a01_tenant_candidate.a01_membership_events TO a01_runtime_candidate`);
  const readAsRole=async()=>{
   await db.query('SET ROLE '+role);
   try{return (await db.query(`SELECT entity_id
      FROM vyndi_a01_tenant_candidate.visible_ownership_candidates`)).rows;}
   finally{await db.query('RESET ROLE');}
  };
  assert.deepEqual(await readAsRole(),[{entity_id:'FIXTURE-ID'}]);
  await db.query(`INSERT INTO vyndi_a01_tenant_candidate.a01_membership_events
   (tenant_id,principal_id,event_type,evidence_digest,approved_by)
   VALUES ('tenant_alpha',$1,'REVOKE',$2,'checker')`,[role,H]);
  assert.deepEqual(await readAsRole(),[],
   'RLS must deny revoked principals despite old mutable membership showing approved');
 });
 await t.test('history and owner bindings are immutable; maker cannot approve self',async()=>{
  await assert.rejects(db.query(`UPDATE vyndi_a01_tenant_candidate.a01_object_owner_candidates
    SET tenant_id='tenant_beta' WHERE object_type='reservation' AND object_id='RES-A'`),/append-only/i);
  await assert.rejects(db.query(`DELETE FROM vyndi_a01_tenant_candidate.a01_membership_events WHERE tenant_id='tenant_alpha'`),/append-only/i);
  await assert.rejects(bind('reservation','RES-A','tenant_beta'),e=>e?.code==='23505');
  await assert.rejects(db.query(`INSERT INTO vyndi_a01_tenant_candidate.a01_membership_events
   (tenant_id,principal_id,event_type,evidence_digest,approved_by)
   VALUES ('tenant_alpha','same','GRANT',$1,'same')`,[H]),e=>e?.code==='23514');
 });
 await t.test('no PUBLIC read grants; direct untrusted reader gets permission denied',async()=>{
  const {rows:[scope]}=await db.query(`SELECT
   has_schema_privilege('public','vyndi_a01_tenant_candidate','USAGE') AS schema_grant,
   has_table_privilege('public','vyndi_a01_tenant_candidate.a01_object_owner_candidates','SELECT') AS binding_grant,
   has_table_privilege('public','vyndi_a01_tenant_candidate.a01_member_state_candidate','SELECT') AS member_grant`);
  assert.deepEqual(scope,{schema_grant:false,binding_grant:false,member_grant:false});
  await db.query('CREATE ROLE a01_untrusted NOLOGIN');
  await db.query('SET ROLE a01_untrusted');
  try{await assert.rejects(db.query('SELECT * FROM vyndi_a01_tenant_candidate.a01_member_state_candidate'),
   e=>e?.code==='42501');}finally{await db.query('RESET ROLE');}
 });
});
