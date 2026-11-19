import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import pg from 'pg';

const root=join(dirname(fileURLToPath(import.meta.url)),'..');
const url=process.env.A01_TEST_DATABASE_URL;
assert.ok(url,'Disposable A01_TEST_DATABASE_URL required');
const u=new URL(url);
assert.ok(['127.0.0.1','localhost','::1'].includes(u.hostname),
 'Never connect this fixture to a remote database');
assert.equal(u.pathname,'/a01_test','Refuse any database except a01_test');
const {Client}=pg;

test('A01 venture-aware ATP candidate must fail closed on every unscoped reservation or overlapping SKU',async t=>{
 const db=new Client({connectionString:url,connectionTimeoutMillis:3000,statement_timeout:7000});
 await db.connect();t.after(()=>db.end());
 await db.query('CREATE SCHEMA vyndi_vaos_authority; REVOKE ALL ON SCHEMA vyndi_vaos_authority FROM PUBLIC');
 await db.query(`CREATE FUNCTION public.vyndi_canonical_unit(x text) RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT lower(btrim(x)) $$`);
 await db.query(`CREATE TABLE public.epr_inventory_ledger(
  venture text NOT NULL, sku text NOT NULL, unit text NOT NULL,quantity_delta numeric NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now())`);
 await db.query(`CREATE TABLE public.epr_inventory_cost_ledger(
  venture text NOT NULL, sku text NOT NULL, unit text NOT NULL,value_delta_inr numeric NOT NULL)`);
 await db.query(`CREATE TABLE public.epr_inventory_reservations(
  id text PRIMARY KEY, sku text NOT NULL,unit text NOT NULL,
  quantity_reserved numeric NOT NULL,status text NOT NULL)`);
 await db.query(await readFile(join(root,'migrations/0197_vaos_venture_isolated_inventory_candidate.sql'),'utf8'));
 await db.query(await readFile(join(root,'migrations/0198_vaos_venture_atp_hold_candidate.sql'),'utf8'));
 const read=async()=>(await db.query(`SELECT venture,sku,unit,physical_quantity,atp_candidate_quantity,
  scope_status,source_completeness_verified,action_authorized,production_write_authorized
  FROM vyndi_vaos_authority.inventory_atp_hold_candidate
  ORDER BY venture,sku`)).rows;
 await db.query(`INSERT INTO public.epr_inventory_ledger(venture,sku,unit,quantity_delta)
  VALUES ('V1','OVERLAP','pcs',3),('V2','OVERLAP','PCS',8),('V1','SINGLE','pcs',4)`);
 await db.query(`INSERT INTO public.epr_inventory_cost_ledger(venture,sku,unit,value_delta_inr)
  VALUES ('V1','OVERLAP','pcs',30),('V2','OVERLAP','PCS',800),('V1','SINGLE','pcs',16)`);
 await t.test('shared SKU cannot acquire a venture-specific ATP number from global source',async()=>{
  const rows=await read();
  const overlap=rows.filter(x=>x.sku==='OVERLAP');
  assert.equal(overlap.length,2);
  assert.ok(overlap.every(x=>x.scope_status==='HOLD_MULTI_VENTURE_SKU'));
  assert.ok(overlap.every(x=>x.atp_candidate_quantity===null));
  assert.deepEqual(overlap.map(x=>Number(x.physical_quantity)),[3,8]);
 });
 await t.test('unique unreserved SKU is only an uncertified physical candidate',async()=>{
  const rows=await read();const single=rows.find(x=>x.sku==='SINGLE');
  assert.equal(single?.scope_status,'CANDIDATE_ONLY_UNVERIFIED');
  assert.equal(Number(single?.atp_candidate_quantity),4);
  assert.ok(rows.every(x=>x.source_completeness_verified===false
   &&x.action_authorized===false&&x.production_write_authorized===false));
 });
 await t.test('active reservations without venture attribution HOLD ALL keys, including unrelated stock',async()=>{
  await db.query("INSERT INTO public.epr_inventory_reservations VALUES ('R1','OUTSIDE-ALL-LEDGERS','pcs',2,'active')");
  const rows=await read();
  assert.equal(rows.length,3);
  assert.ok(rows.every(x=>x.scope_status==='HOLD_UNATTRIBUTED_ACTIVE_RESERVATIONS'));
  assert.ok(rows.every(x=>x.atp_candidate_quantity===null));
 });
 await t.test('nonactive reservations cannot silently become deducted stock',async()=>{
  await db.query("UPDATE public.epr_inventory_reservations SET status='released' WHERE id='R1'");
  const rows=await read();
  assert.equal(rows.find(x=>x.sku==='SINGLE')?.scope_status,'CANDIDATE_ONLY_UNVERIFIED');
  assert.ok(rows.filter(x=>x.sku==='OVERLAP').every(x=>x.atp_candidate_quantity===null));
 });
 await t.test('private invoker view rejects untrusted direct SELECT and offers no runtime grant',async()=>{
  const {rows:[meta]}=await db.query(`SELECT c.reloptions,
   has_schema_privilege('public','vyndi_vaos_authority','USAGE') AS public_schema,
   has_table_privilege('public','vyndi_vaos_authority.inventory_atp_hold_candidate','SELECT') AS public_select
   FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname='vyndi_vaos_authority' AND c.relname='inventory_atp_hold_candidate'`);
  assert.ok(meta.reloptions.includes('security_invoker=true'));
  assert.ok(meta.reloptions.includes('security_barrier=true'));
  assert.equal(meta.public_schema,false);
  assert.equal(meta.public_select,false);
  await db.query('CREATE ROLE a01_untrusted NOLOGIN');
  await db.query('SET ROLE a01_untrusted');
  try{
   await assert.rejects(db.query('SELECT * FROM vyndi_vaos_authority.inventory_atp_hold_candidate'),
    e=>e?.code==='42501');
  }finally{await db.query('RESET ROLE');}
 });
});
