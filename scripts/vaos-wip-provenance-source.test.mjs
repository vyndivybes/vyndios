import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {assertVaosWipSource,VAOS_WIP_ATOMIC_SOURCE_SQL} from '../src/lib/vaos-wip-source-read.mjs';

test('WIP source cannot turn cancelled in-build travellers and consumed stock into authorised WIP',async t=>{
 const db=new PGlite();await db.waitReady;t.after(()=>db.close());
 await db.exec(`CREATE TABLE epr_production_job_cards (id text primary key,status text,created_at timestamptz);
 CREATE TABLE epr_travellers (id text primary key,job_card_id text,status text);
 CREATE TABLE epr_inventory_reservations (id text primary key,job_card_id text,status text);
 INSERT INTO epr_production_job_cards VALUES
 ('CANCEL','cancelled','2026-10-01T00:00:00Z'),
 ('LIVE','released','2026-10-02T00:00:00Z');
 INSERT INTO epr_travellers VALUES('T-CANCEL','CANCEL','in_build');
 INSERT INTO epr_inventory_reservations VALUES('R-CANCEL','CANCEL','consumed');`);
 const x=await db.query(VAOS_WIP_ATOMIC_SOURCE_SQL,[50]);
 assert.equal(x.rows.length,1);
 assert.equal(x.rows[0].active_cancelled_traveller,true);
 assert.equal(x.rows[0].consumed_cancelled_reservation,true);
 assert.throws(()=>assertVaosWipSource(x.rows[0]),/VYNDI_WIP_CANCELLED_LINEAGE_UNRECONCILED/);
 // Test-fixture-only transitions, never touch historical production records.
 await db.exec("UPDATE epr_travellers SET status='hold' WHERE id='T-CANCEL'");
 const y=await db.query(VAOS_WIP_ATOMIC_SOURCE_SQL,[50]);
 assert.throws(()=>assertVaosWipSource(y.rows[0]),/VYNDI_WIP_CANCELLED_LINEAGE_UNRECONCILED/);
 await db.exec("UPDATE epr_inventory_reservations SET status='released' WHERE id='R-CANCEL'");
 const z=await db.query(VAOS_WIP_ATOMIC_SOURCE_SQL,[50]);
 const safe=assertVaosWipSource(z.rows[0]);
 assert.equal(safe.records.length,1);
 assert.equal(safe.records[0].id,'LIVE');
 assert.equal(safe.records.some(record=>record.id==='CANCEL'),false);
});
test('unproven or malformed DB source snapshots cannot be represented as empty or healthy WIP',()=>{
 for(const row of [undefined,{},null,{records:[],active_cancelled_traveller:false},
 {records:[],active_cancelled_traveller:false,consumed_cancelled_reservation:0},
 {records:'[]',active_cancelled_traveller:false,consumed_cancelled_reservation:false},
 {records:[],active_cancelled_traveller:'false',consumed_cancelled_reservation:false}]){
  assert.throws(()=>assertVaosWipSource(row),/VYNDI_WIP_SOURCE_INVALID/);
 }
 assert.deepEqual(assertVaosWipSource({records:[],active_cancelled_traveller:false,consumed_cancelled_reservation:false}),{records:[]});
});
test('signed WIP bridge uses one bounded atomic snapshot and a nonce-claimed explicit 409 HOLD',async()=>{
 const route=await readFile(new URL('../src/routes/api/vaos/bridge.ts',import.meta.url),'utf8');
 const b=route.split('if (actionType === "PRODUCTION.OBSERVE_WIP") {')[1]?.split('if (actionType === "MAINTENANCE.OBSERVE_ASSET")')[0]||'';
 assert.match(b,/VAOS_WIP_ATOMIC_SOURCE_SQL/);
 assert.match(b,/assertVaosWipSource\(rows\[0\]\)/);
 assert.doesNotMatch(b,/select to_jsonb\(j\) as record from epr_production_job_cards/);
 assert.match(route,/claim_vyndi_vaos_bridge_nonce/);
 assert.match(route,/source_wip_provenance_unverified/);
 assert.match(route,/VYNDI_WIP_CANCELLED_LINEAGE_UNRECONCILED/);
 assert.match(route,/error:"source_wip_provenance_unverified"\},409/);
 assert.match(VAOS_WIP_ATOMIC_SOURCE_SQL,/j\.status IN \('released','in_progress'\)/);
 assert.match(VAOS_WIP_ATOMIC_SOURCE_SQL,/c\.status='cancelled'/);
 assert.match(VAOS_WIP_ATOMIC_SOURCE_SQL,/t\.status IN \('released','in_build','completed'\)/);
 assert.match(VAOS_WIP_ATOMIC_SOURCE_SQL,/r\.status='consumed'/);
 assert.match(VAOS_WIP_ATOMIC_SOURCE_SQL,/LIMIT \$1/);
});
