import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import pg from 'pg';

const root=join(dirname(fileURLToPath(import.meta.url)),'..');
const dsn=process.env.A01_TEST_DATABASE_URL;
assert.ok(dsn,'A01 dedicated test database URL required');
const target=new URL(dsn);
assert.ok(['127.0.0.1','localhost','::1'].includes(target.hostname),'A01 fixture refuses external databases');
assert.equal(target.pathname,'/a01_test','A01 fixture refuses non-test database');
const {Client}=pg;

test('A01 private inventory aggregate never blends quantity or cost between two ventures',async t=>{
 const db=new Client({connectionString:dsn,connectionTimeoutMillis:3000,statement_timeout:7000});
 await db.connect();
 t.after(()=>db.end());
 await db.query('CREATE SCHEMA vyndi_vaos_authority; REVOKE ALL ON SCHEMA vyndi_vaos_authority FROM PUBLIC');
 await db.query(`CREATE FUNCTION public.vyndi_canonical_unit(x text) RETURNS text LANGUAGE sql IMMUTABLE
     AS $$ SELECT lower(btrim(x)) $$`);
 await db.query(`CREATE TABLE public.epr_inventory_ledger(
   venture text NOT NULL,sku text NOT NULL,unit text NOT NULL,quantity_delta numeric NOT NULL,
   created_at timestamptz NOT NULL DEFAULT now())`);
 await db.query(`CREATE TABLE public.epr_inventory_cost_ledger(
   venture text NOT NULL,sku text NOT NULL,unit text NOT NULL,value_delta_inr numeric NOT NULL)`);
 const source=await readFile(join(root,'migrations/0197_vaos_venture_isolated_inventory_candidate.sql'),'utf8');
 assert.ok(!/CREATE OR REPLACE VIEW public\.vyndi_inventory_balance/i.test(source),
  'legacy global inventory view cannot be silently replaced');
 await db.query(source);
 await db.query(`INSERT INTO public.epr_inventory_ledger(venture,sku,unit,quantity_delta)
   VALUES ('VENTURE-A','OVERLAP','PCS',3),('VENTURE-B','OVERLAP','pcs',8),
          ('VENTURE-A','ORPHAN-COST','pcs',2)`);
 await db.query(`INSERT INTO public.epr_inventory_cost_ledger(venture,sku,unit,value_delta_inr)
   VALUES ('VENTURE-A','OVERLAP','PCS',30),('VENTURE-B','OVERLAP','pcs',800),
          ('VENTURE-B','ORPHAN-COST','pcs',999)`);
 const rows=(await db.query(`SELECT venture,sku,unit,quantity_balance,inventory_value_inr,
 weighted_average_cost_inr FROM vyndi_vaos_authority.inventory_balance_by_venture
 ORDER BY venture,sku`)).rows;
 await t.test('overlapping SKU has two separate venture keys and independent totals',()=>{
  const a=rows.find(x=>x.venture==='VENTURE-A'&&x.sku==='OVERLAP');
  const b=rows.find(x=>x.venture==='VENTURE-B'&&x.sku==='OVERLAP');
  assert.equal(rows.length,3);
  assert.deepEqual([a?.unit,Number(a?.quantity_balance),Number(a?.inventory_value_inr),Number(a?.weighted_average_cost_inr)],
   ['pcs',3,30,10]);
  assert.deepEqual([b?.unit,Number(b?.quantity_balance),Number(b?.inventory_value_inr),Number(b?.weighted_average_cost_inr)],
   ['pcs',8,800,100]);
 });
 await t.test('other-venture cost cannot join same-SKU unmatched physical ledger',()=>{
  const lonely=rows.find(x=>x.venture==='VENTURE-A'&&x.sku==='ORPHAN-COST');
  assert.equal(Number(lonely?.quantity_balance),2);
  assert.equal(Number(lonely?.inventory_value_inr),0);
  assert.equal(Number(lonely?.weighted_average_cost_inr),0);
 });
 await t.test('view is private, invoker-aware and excludes public read privileges',async()=>{
  const meta=(await db.query(`SELECT c.reloptions,
    has_schema_privilege('public','vyndi_vaos_authority','USAGE') AS public_usage,
    has_table_privilege('public','vyndi_vaos_authority.inventory_balance_by_venture','SELECT') AS public_select
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='vyndi_vaos_authority' AND c.relname='inventory_balance_by_venture'`)).rows[0];
  assert.ok(meta.reloptions.includes('security_invoker=true'));
  assert.ok(meta.reloptions.includes('security_barrier=true'));
  assert.equal(meta.public_usage,false);
  assert.equal(meta.public_select,false);
  await db.query('CREATE ROLE a01_untrusted NOLOGIN');
  await db.query('SET ROLE a01_untrusted');
  try{
   await assert.rejects(db.query('SELECT * FROM vyndi_vaos_authority.inventory_balance_by_venture'),
    err=>err?.code==='42501');
  }finally{
   await db.query('RESET ROLE');
  }
 });
});
