import assert from 'node:assert/strict';
import test from 'node:test';
import pg from 'pg';
import {A01_SINGLE_VENTURE_GUARD_CTE, assertSingleVentureSource} from '../src/lib/vaos-single-venture-source-guard.ts';

const dsn=process.env.A01_TEST_DATABASE_URL;
assert.ok(dsn,'Dedicated A01_TEST_DATABASE_URL is required');
const u=new URL(dsn);
assert.ok(['127.0.0.1','localhost','::1'].includes(u.hostname),'A01 PostgreSQL fixture must be loopback');
assert.equal(u.pathname,'/a01_test','A01 PostgreSQL fixture must use a01_test');
const {Client}=pg;

test('A01 real PostgreSQL isolation rejects two ventures sharing stock SKUs',async t=>{
 const db=new Client({connectionString:dsn,connectionTimeoutMillis:3000,statement_timeout:6000});
 await db.connect();
 t.after(()=>db.end());
 await db.query('CREATE TABLE public.epr_inventory_ledger(venture text NOT NULL,sku text NOT NULL,unit text NOT NULL,quantity_delta integer NOT NULL)');
 await db.query('CREATE TABLE public.epr_inventory_cost_ledger(venture text NOT NULL,sku text NOT NULL,unit text NOT NULL,value_delta_inr integer NOT NULL)');
 const readCount=async()=>{
  const {rows}=await db.query(`WITH ${A01_SINGLE_VENTURE_GUARD_CTE}
   SELECT (SELECT venture_count FROM venture_guard) AS venture_count`);
  return rows[0].venture_count;
 };
 await t.test('empty ledger is not a certified single-venture source',async()=>{
  assert.equal(await readCount(),0);
  assert.throws(()=>assertSingleVentureSource(await readCount()),/VYNDI_ONTOLOGY_VENTURE_SCOPE_UNVERIFIED/);
 });
 await t.test('one venture with quantity and value ledgers can make bounded observation',async()=>{
  await db.query("INSERT INTO public.epr_inventory_ledger VALUES ('V1','SKU-1','pcs',10)");
  await db.query("INSERT INTO public.epr_inventory_cost_ledger VALUES ('V1','SKU-1','pcs',800)");
  assert.equal(await readCount(),1);
  assert.doesNotThrow(()=>assertSingleVentureSource(1));
 });
 await t.test('separate venture with SAME SKU and unit fails closed',async()=>{
  await db.query("INSERT INTO public.epr_inventory_ledger VALUES ('V2','SKU-1','pcs',99)");
  assert.equal(await readCount(),2);
  assert.throws(()=>assertSingleVentureSource(await readCount()),/VYNDI_ONTOLOGY_VENTURE_SCOPE_UNVERIFIED/);
 });
 await t.test('venture can appear in cost ledger alone and still be detected',async()=>{
  await db.query("DELETE FROM public.epr_inventory_ledger WHERE venture='V2'");
  await db.query("INSERT INTO public.epr_inventory_cost_ledger VALUES ('V2','SKU-1','pcs',999)");
  assert.equal(await readCount(),2);
 });
 await t.test('removing other venture restores single-venture observation eligibility',async()=>{
  await db.query("DELETE FROM public.epr_inventory_cost_ledger WHERE venture='V2'");
  assert.equal(await readCount(),1);
 });
});
