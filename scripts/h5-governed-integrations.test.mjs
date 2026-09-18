import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { pendingMigrations } from "./migration-plan.mjs";

const here=dirname(fileURLToPath(import.meta.url));
const root=join(here,"..");
const migrationsDir=join(root,"migrations");

async function db() {
  const instance=new PGlite();
  await instance.waitReady;
  const files=await readdir(migrationsDir);
  for(const migration of pendingMigrations(files,[])) {
    await instance.exec(await readFile(join(migrationsDir,migration.path),"utf8"));
  }
  return instance;
}

async function contract(database,{id="INT-TEST",direction="bidirectional",attempts=2}={}) {
  await database.query(
    `select propose_vyndi_integration_contract($1,'supplier','test-provider',$2,'v1','procurement','CFG-H5',null,true,$3,'ADMIN-MAKER','admin')`,
    [id,direction,attempts],
  );
  await assert.rejects(
    ()=>database.query(`select approve_vyndi_integration_contract($1,'SELF','ADMIN-MAKER','admin')`,[id]),
    /different Admin|self-approval/i,
  );
  await database.query(
    `select approve_vyndi_integration_contract($1,'APPROVED-H5','ADMIN-CHECKER','admin')`,
    [id],
  );
}

test("H5 contract approval is maker/checker and approved configuration is immutable", async(t)=>{
  const database=await db(); t.after(()=>database.close());
  await contract(database);
  const row=await database.query(`select status,prepared_by,approved_by from vyndi_integration_contracts where id='INT-TEST'`);
  assert.deepEqual(row.rows[0],{status:"approved",prepared_by:"ADMIN-MAKER",approved_by:"ADMIN-CHECKER"});
  await assert.rejects(
    ()=>database.query(`update vyndi_integration_contracts set provider_code='tampered' where id='INT-TEST'`),
    /immutable/i,
  );
});

test("inbound idempotency quarantines unverified signatures and never duplicates a provider event", async(t)=>{
  const database=await db(); t.after(()=>database.close());
  await contract(database);
  const accepted=await database.query(
    `select * from record_vyndi_integration_inbound('IN-1','INT-TEST','EXT-1','supplier.updated',$1::jsonb,true,'SIG-1','adapter:test')`,
    [JSON.stringify({supplier:"S1",status:"active"})],
  );
  assert.equal(accepted.rows[0].disposition,"accepted");

  const duplicate=await database.query(
    `select * from record_vyndi_integration_inbound('IN-2','INT-TEST','EXT-1','supplier.updated',$1::jsonb,true,'SIG-2','adapter:test')`,
    [JSON.stringify({supplier:"S1",status:"active"})],
  );
  assert.equal(duplicate.rows[0].disposition,"duplicate");

  const conflict=await database.query(
    `select * from record_vyndi_integration_inbound('IN-3','INT-TEST','EXT-1','supplier.updated',$1::jsonb,true,'SIG-3','adapter:test')`,
    [JSON.stringify({supplier:"S1",status:"changed"})],
  );
  assert.equal(conflict.rows[0].disposition,"idempotency_conflict");

  const quarantine=await database.query(
    `select * from record_vyndi_integration_inbound('IN-4','INT-TEST','EXT-2','supplier.updated','{}'::jsonb,false,'SIG-FAIL','adapter:test')`,
  );
  assert.equal(quarantine.rows[0].disposition,"quarantined");
  await assert.rejects(
    ()=>database.query(`select mark_vyndi_integration_inbound_processed('IN-4','supplier','SUP-1','EVID','adapter:test')`),
    /accepted inbound/i,
  );

  await database.query(`select mark_vyndi_integration_inbound_processed('IN-1','supplier','SUP-1','CANONICAL-SUP-1','adapter:test')`);
  const inbox=await database.query(`select external_event_id,status,linked_entity_type,linked_entity_id from vyndi_integration_inbox order by external_event_id`);
  assert.equal(inbox.rows.length,2);
  assert.deepEqual(inbox.rows[0],{external_event_id:"EXT-1",status:"processed",linked_entity_type:"supplier",linked_entity_id:"SUP-1"});
  assert.equal(inbox.rows[1].status,"quarantined");
});

test("outbox has stable idempotency, bounded retry, dead-letter and independent replay approval", async(t)=>{
  const database=await db(); t.after(()=>database.close());
  await contract(database,{attempts:2});

  const queued=await database.query(
    `select * from queue_vyndi_integration_outbound('OUT-1','INT-TEST','ORDER-1:v1','purchase_order.released','purchase_order','PO-1',$1::jsonb,'authority:procurement')`,
    [JSON.stringify({purchaseOrderId:"PO-1",revision:1})],
  );
  assert.equal(queued.rows[0].disposition,"queued");

  const duplicate=await database.query(
    `select * from queue_vyndi_integration_outbound('OUT-2','INT-TEST','ORDER-1:v1','purchase_order.released','purchase_order','PO-1',$1::jsonb,'authority:procurement')`,
    [JSON.stringify({purchaseOrderId:"PO-1",revision:1})],
  );
  assert.equal(duplicate.rows[0].disposition,"duplicate");

  const conflict=await database.query(
    `select * from queue_vyndi_integration_outbound('OUT-3','INT-TEST','ORDER-1:v1','purchase_order.released','purchase_order','PO-1',$1::jsonb,'authority:procurement')`,
    [JSON.stringify({purchaseOrderId:"PO-1",revision:2})],
  );
  assert.equal(conflict.rows[0].disposition,"idempotency_conflict");

  let attempt=await database.query(`select * from record_vyndi_integration_delivery_attempt('OUT-1',false,503,'RESP-1','upstream_unavailable','worker:h5')`);
  assert.equal(attempt.rows[0].outbox_status,"pending");
  attempt=await database.query(`select * from record_vyndi_integration_delivery_attempt('OUT-1',false,503,'RESP-2','upstream_unavailable','worker:h5')`);
  assert.equal(attempt.rows[0].outbox_status,"dead_letter");

  await database.query(`select request_vyndi_integration_replay('REPLAY-1','OUT-1','Provider restored','OPS-EVID','ADMIN-MAKER','admin')`);
  await assert.rejects(
    ()=>database.query(`select approve_vyndi_integration_replay('REPLAY-1','SELF','ADMIN-MAKER','admin')`),
    /different Admin|self-approval/i,
  );
  await database.query(`select approve_vyndi_integration_replay('REPLAY-1','CHECKER-EVID','ADMIN-CHECKER','admin')`);
  const reset=await database.query(`select status,attempt_count,replay_count from vyndi_integration_outbox where id='OUT-1'`);
  assert.deepEqual(reset.rows[0],{status:"pending",attempt_count:0,replay_count:1});

  attempt=await database.query(`select * from record_vyndi_integration_delivery_attempt('OUT-1',true,200,'RESP-OK','','worker:h5')`);
  assert.equal(attempt.rows[0].outbox_status,"delivered");
  const replay=await database.query(`select status,approved_by from vyndi_integration_replay_requests where id='REPLAY-1'`);
  assert.deepEqual(replay.rows[0],{status:"executed",approved_by:"ADMIN-CHECKER"});

  const attempts=await database.query(`select attempt_no,replay_count,success from vyndi_integration_delivery_attempts where outbox_id='OUT-1' order by replay_count,attempt_no`);
  assert.deepEqual(attempts.rows.map(r=>[r.attempt_no,r.replay_count,r.success]),[[1,0,false],[2,0,false],[1,1,true]]);
  await assert.rejects(
    ()=>database.query(`delete from vyndi_integration_delivery_attempts where outbox_id='OUT-1'`),
    /append-only/i,
  );
});

test("H5 event evidence is append-only and implementation preserves one-truth boundary", async(t)=>{
  const database=await db(); t.after(()=>database.close());
  await contract(database);
  const events=await database.query(`select event_type from vyndi_integration_events where contract_id='INT-TEST' order by created_at,id`);
  assert.deepEqual(events.rows.map(r=>r.event_type),["contract_proposed","contract_approved"]);
  await assert.rejects(
    ()=>database.query(`update vyndi_integration_events set evidence_reference='tampered' where contract_id='INT-TEST'`),
    /append-only/i,
  );

  const [migration,authority,freeze]=await Promise.all([
    readFile(join(root,"migrations/0088_h5_governed_integrations.sql"),"utf8"),
    readFile(join(root,"src/lib/integration-control.ts"),"utf8"),
    readFile(join(root,"docs/VYNDI-V1-FUNCTIONAL-DESIGN-FREEZE.md"),"utf8"),
  ]);
  assert.match(migration,/External systems exchange evidence\/events through controlled inbox\/outbox records/);
  assert.doesNotMatch(migration,/insert into epr_inventory_ledger/i);
  assert.doesNotMatch(migration,/insert into epr_finance_journal/i);
  assert.doesNotMatch(migration,/insert into vyndi_purchase_orders/i);
  assert.match(authority,/actor\.role !== "admin"/);
  assert.match(freeze,/H5 governed external integration contracts/);
});
