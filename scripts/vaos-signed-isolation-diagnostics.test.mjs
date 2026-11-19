import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {readVaosIsolationDiagnostics} from '../src/lib/vaos-isolation-diagnostics.mjs';

test('isolation diagnostic emits only aggregate HOLD, no venture names or business rows',async()=>{
 const queryLog=[];
 const sql={query:async (query,args)=>{
  queryLog.push({query,args});
  if(query.includes('WITH quantity AS MATERIALIZED'))return [{
   source_count:2,venture_count:2,unpaired_count:0,negative_count:1,
   invalid_identity_count:0,records:[
    {venture:'PRIVATE-ALPHA',sku:'PRIVATE-SKU',unit:'ea',quantity_balance:'5'},
    {venture:'PRIVATE-BETA',sku:'PRIVATE-SKU',unit:'ea',quantity_balance:'-4'}]}];
  return [{overlapping_key_groups:1,job_cards_total:4,jobs_without_traveller_venture:3,
   ambiguous_job_venture_count:0,reservations_total:1,reservations_with_broken_lineage:1,
   purchase_orders_total:48,purchase_orders_with_broken_lineage:48}];
 }};
 const d=await readVaosIsolationDiagnostics({sql});
 assert.equal(queryLog.length,2);
 assert.equal(d.schemaVersion,'VYNDI_A01_ISOLATION_DIAGNOSTIC_V1');
 assert.equal(d.status,'HOLD');
 assert.equal(d.tenantIdentityVerified,false);
 assert.equal(d.businessWritesAuthorized,false);
 assert.equal(d.sourceCompletenessVerified,false);
 assert.equal(d.availableToPromiseAuthorized,false);
 assert.equal(d.inventory.ventureCount,2);
 assert.equal(d.inventory.negativeCount,1);
 assert.equal(d.inventory.overlappingKeyGroups,1);
 assert.equal(d.lineage.purchaseOrdersWithBrokenLineage,48);
 assert.ok(d.holds.includes('CROSS_VENTURE_SKU_COLLISION'));
 assert.ok(d.holds.includes('PO_PARENT_REVISION_UNVERIFIED'));
 const serial=JSON.stringify(d);
 for(const secret of ['PRIVATE-ALPHA','PRIVATE-BETA','PRIVATE-SKU','quantity_balance','source_mvcc_snapshot','records'])
  assert.equal(serial.includes(secret),false,'sensitive row fields must never leave service');
});
test('diagnostic refuses caller-selected identity and malformed counts',async()=>{
 const sql={query:async()=>[]};
 for(const input of [{tenantId:'tenant_a'},{venture:'category_a'},{principal:'founder'}])
  await assert.rejects(()=>readVaosIsolationDiagnostics({sql,...input}),/ISOLATION_SCOPE_FORBIDDEN/);
 await assert.rejects(()=>readVaosIsolationDiagnostics({sql}),/SHADOW_SOURCE_INVALID/);
});
test('signed bridge retains P-256 context and no write authority',async()=>{
 const route=await readFile(new URL('../src/routes/api/vaos/bridge.ts',import.meta.url),'utf8');
 assert.match(route,/INVENTORY\.OBSERVE_ISOLATION_DIAGNOSTICS/);
 assert.match(route,/readVaosIsolationDiagnostics/);
 assert.match(route,/verifyVaosBridgeSignature/);
 assert.match(route,/claim_vyndi_vaos_bridge_nonce/);
 assert.match(route,/write_execution_not_commissioned/);
 assert.match(route,/source_venture_scope_unverified/);
});
test('isolated SQL identifies two ventures sharing canonical SKU and orphan parent chains',async t=>{
 const db=new PGlite(); await db.waitReady; t.after(()=>db.close());
 const ddl=[
  "CREATE FUNCTION public.vyndi_canonical_unit(unit text) RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT CASE lower(btrim(unit)) WHEN 'each' THEN 'ea' ELSE lower(btrim(unit)) END $$;",
  'CREATE TABLE public.epr_inventory_ledger(venture text,sku text,unit text,quantity_delta numeric,created_at timestamptz DEFAULT now());',
  'CREATE TABLE public.epr_inventory_cost_ledger(venture text,sku text,unit text,value_delta_inr numeric);',
  'CREATE TABLE public.epr_travellers(job_card_id text,venture text);',
  'CREATE TABLE public.epr_production_job_cards(id text PRIMARY KEY,sales_order_id text,sales_order_revision integer);',
  'CREATE TABLE public.epr_production_job_card_lines(id text PRIMARY KEY,job_card_id text,sku text,unit text);',
  'CREATE TABLE public.vyndi_sales_orders(id text PRIMARY KEY,revision integer);',
  'CREATE TABLE public.epr_inventory_reservations(id text,job_card_id text,job_card_line_id text,sales_order_id text,sales_order_revision integer,sku text,unit text);',
  'CREATE TABLE public.vyndi_purchase_orders(id text,job_card_id text);',
  "INSERT INTO public.epr_inventory_ledger(venture,sku,unit,quantity_delta) VALUES('A','OVERLAP','each',12),('B','OVERLAP','ea',-7);",
  "INSERT INTO public.epr_inventory_cost_ledger VALUES('A','OVERLAP','ea',120),('B','OVERLAP','ea',-70);",
  "INSERT INTO public.vyndi_sales_orders VALUES('SO-1',2);",
  "INSERT INTO public.epr_production_job_cards VALUES('J-1','SO-1',1),('J-2',NULL,NULL);",
  "INSERT INTO public.epr_travellers VALUES('J-1','A');",
  "INSERT INTO public.epr_production_job_card_lines VALUES('L-1','J-1','OVERLAP','ea');",
  "INSERT INTO public.epr_inventory_reservations VALUES('R-1','J-1','L-1','SO-1',1,'OVERLAP','ea');",
  "INSERT INTO public.vyndi_purchase_orders VALUES('PO-1','J-1'),('PO-2','MISSING');"
 ];
 await db.exec(ddl.join('\n'));
 const sql={query:async(q,p)=>(await db.query(q,p)).rows};
 const before=(await db.query('SELECT count(*)::int AS c FROM epr_inventory_ledger')).rows[0].c;
 const result=await readVaosIsolationDiagnostics({sql});
 assert.equal(result.inventory.ventureCount,2);
 assert.equal(result.inventory.overlappingKeyGroups,1);
 assert.equal(result.inventory.negativeCount,1);
 assert.equal(result.lineage.jobCardsWithoutTravellerVenture,1);
 assert.equal(result.lineage.reservationsWithBrokenLineage,1);
 assert.equal(result.lineage.purchaseOrdersWithBrokenLineage,2);
 assert.equal(result.status,'HOLD');
 assert.equal((await db.query('SELECT count(*)::int AS c FROM epr_inventory_ledger')).rows[0].c,before);
});
