import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {requireSingleVentureInventorySource,INVENTORY_SCOPE_SQL} from '../src/lib/inventory-venture-source-guard.mjs';

test('no inventory source, two venture sources and null/unreadable results all HOLD; one source does not certify business authority',async t=>{
 const db=new PGlite();await db.waitReady;t.after(()=>db.close());
 await db.exec(`create table epr_inventory_ledger(id text primary key,venture text,sku text);
 create table epr_inventory_cost_ledger(id text primary key,venture text,sku text);`);
 const sql={query:async (query)=> (await db.query(query)).rows};
 assert.match(INVENTORY_SCOPE_SQL,/epr_inventory_ledger/);
 assert.match(INVENTORY_SCOPE_SQL,/epr_inventory_cost_ledger/);
 await assert.rejects(requireSingleVentureInventorySource(sql),/VYNDI_INVENTORY_VENTURE_SCOPE_HOLD/);
 await db.exec(`insert into epr_inventory_ledger values ('a','carbon','OVERLAP');
 insert into epr_inventory_cost_ledger values('b','carbon','OVERLAP');`);
 const observed=await requireSingleVentureInventorySource(sql);
 assert.deepEqual(observed,{ventureCount:1,sourceAuthorityCertified:false,productionWriteAuthorized:false});
 await db.exec(`insert into epr_inventory_cost_ledger values ('c','aluminium','OVERLAP');`);
 await assert.rejects(requireSingleVentureInventorySource(sql),/VYNDI_INVENTORY_VENTURE_SCOPE_HOLD/);
 await db.exec(`delete from epr_inventory_cost_ledger where id='c';`);
 await db.exec(`insert into epr_inventory_cost_ledger values ('d',null,'OVERLAP');`);
 await assert.rejects(requireSingleVentureInventorySource(sql),/VYNDI_INVENTORY_VENTURE_SCOPE_HOLD/);
 await assert.rejects(requireSingleVentureInventorySource({query:async()=>[]}),/VYNDI_INVENTORY_VENTURE_SCOPE_HOLD/);
 await assert.rejects(requireSingleVentureInventorySource({query:async()=>{throw Error('connection failed')}}),/connection failed/);
});
test('master inventory read and physical receipt/issue fail closed before legacy global ATP or physical posting',async()=>{
 const source=await readFile(new URL('../src/lib/master-inventory.ts',import.meta.url),'utf8');
 assert.match(source,/import \{requireSingleVentureInventorySource\} from "@\/lib\/inventory-venture-source-guard.mjs"/);
 assert.match(source,/getMasterInventoryItems[\s\S]*?await requireSingleVentureInventorySource\(sql\);[\s\S]*?vyndi_inventory_available_to_promise/);
 assert.match(source,/getMasterInventoryData[\s\S]*?await requireSingleVentureInventorySource\(sql\);[\s\S]*?vyndi_inventory_available_to_promise/);
 assert.match(source,/saveMasterInventoryEntry[\s\S]*?await requireSingleVentureInventorySource\(sql\);[\s\S]*?save_vyndi_master_inventory_entry/);
 assert.match(source,/issueMasterInventoryFifo[\s\S]*?await requireSingleVentureInventorySource\(sql\);[\s\S]*?issue_vyndi_master_inventory_fifo/);
});


test('receiving and production physical inventory posting paths require unambiguous source venture',async()=>{
 const p2p=await readFile(new URL('../src/lib/procure-to-pay-authority.ts',import.meta.url),'utf8');
 const cards=await readFile(new URL('../src/lib/production-job-card.ts',import.meta.url),'utf8');
 const release=await readFile(new URL('../src/lib/production-release-authority.ts',import.meta.url),'utf8');
 for(const [source,anchor,effect] of [
  [p2p,'postGoodsReceipt','post_vyndi_goods_receipt'],
  [p2p,'resolveGoodsReceipt','resolve_vyndi_goods_receipt'],
  [cards,'refreshProductionReservations','reserve_epr_inventory_for_job_line'],
  [cards,'issueProductionReservation','consume_epr_inventory_reservation'],
  [release,'approveProductionBatch','approve_vyndi_production_batch'],
 ]){
  const s=source.slice(source.indexOf('export const '+anchor+' ='));
  assert.ok(s.includes('await requireSingleVentureInventorySource(sql);'),anchor+' must gate the stock source');
  assert.ok(s.indexOf('await requireSingleVentureInventorySource(sql);')<s.indexOf(effect),anchor+' must gate before stock effect');
 }
});
