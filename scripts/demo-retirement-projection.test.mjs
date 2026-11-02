import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const migration = new URL("../migrations/0196_demo_retirement_scope.sql", import.meta.url);
async function setup(t) {
  const db = new PGlite();
  await db.waitReady;
  t.after(() => db.close());
  await db.exec(`
    create table vyndi_sales_orders(id text primary key, revision integer not null, status text not null);
    create table epr_production_job_cards(id text primary key, sales_order_id text not null,
      sales_order_revision integer not null, status text not null, superseded_at timestamptz);
    create table vyndi_live_job_card_requirements(sales_order_id text, due_month integer,
      sku text, unit text, required_quantity numeric, reserved_quantity numeric,
      physical_quantity numeric, available_to_promise numeric,job_card_status text,issue_status text);
    insert into vyndi_live_job_card_requirements values
      ('DEMO-SO',1,'DEMO-SKU','pcs',1,0,0,0,'released','required'),
      ('REAL-SO-1',1,'REAL-SKU-1','pcs',1,0,0,0,'released','required'),
      ('REAL-SO-2',1,'REAL-SKU-2','pcs',1,0,0,0,'released','required'),
      ('REAL-SO-3',1,'REAL-SKU-3','pcs',1,0,0,0,'released','required');
    insert into vyndi_sales_orders values ('DEMO-SO',3,'confirmed'),('REAL-SO-1',2,'confirmed'),
      ('REAL-SO-2',3,'confirmed'),('REAL-SO-3',2,'confirmed');
    insert into epr_production_job_cards values
      ('DEMO-CARD','DEMO-SO',2,'hold',null),
      ('REAL-CARD-1','REAL-SO-1',2,'released',null),
      ('REAL-CARD-2','REAL-SO-2',3,'released',null),
      ('REAL-CARD-3','REAL-SO-3',2,'released',null);
  `);
  await db.exec(await readFile(migration, "utf8"));
  return db;
}
async function proposed(db, user = "maker") {
  await db.query(`insert into vyndi_demo_retirement_cases
   (case_id,sales_order_id,source_order_revision,source_card_id,source_card_revision,evidence_sha256,reason,created_by)
   values ('CASE-DEMO','DEMO-SO',3,'DEMO-CARD',2,$1,'Verified synthetic production exercise', $2)`,["a".repeat(64),user]);
  await db.query(`insert into vyndi_demo_retirement_events(case_id,event_type,actor_user_id,idempotency_key,reason)
   values ('CASE-DEMO','proposed',$1,'req-propose','Proof preserved')`,[user]);
}
const visible = (db) => db.query("select id from vyndi_operational_sales_orders where status='confirmed' order by id");
const act = (db, event, actor, key) => db.query(
  `insert into vyndi_demo_retirement_events(case_id,event_type,actor_user_id,idempotency_key,reason)
   values('CASE-DEMO',$1,$2,$3,'Independent case disposition')`, [event,actor,key],
);

test("no records are excluded without independent approval and activation",async(t)=>{
  const db=await setup(t);
  assert.equal((await visible(db)).rows.length,4);
  await proposed(db);
  assert.equal((await visible(db)).rows.length,4);
  await act(db,"approved","checker","req-approve");
  assert.equal((await visible(db)).rows.length,4);
});

test("active demo exclusion affects exactly one order and reversal restores the original view and source hashes",async(t)=>{
  const db=await setup(t);
  const before=await db.query(`select md5(string_agg(to_jsonb(o)::text,',' order by id)) as digest from vyndi_sales_orders o`);
  await proposed(db);
  await act(db,"approved","checker","req-approve");
  await act(db,"activated","checker","req-activate");
  assert.deepEqual((await visible(db)).rows.map(row=>row.id),["REAL-SO-1","REAL-SO-2","REAL-SO-3"]);
  const prospective=await db.query("select sku from vyndi_committed_procurement_requirements order by sku");
  assert.deepEqual(prospective.rows.map(row=>row.sku),["REAL-SKU-1","REAL-SKU-2","REAL-SKU-3"]);
  const originals=await db.query("select count(*)::int AS n from vyndi_sales_orders");
  assert.equal(originals.rows[0].n,4,"original truth is never removed");
  await act(db,"reversed","checker","req-reverse");
  assert.equal((await visible(db)).rows.length,4);
  const after=await db.query(`select md5(string_agg(to_jsonb(o)::text,',' order by id)) as digest from vyndi_sales_orders o`);
  assert.equal(after.rows[0].digest,before.rows[0].digest,"rollback changes only projection, not source rows");
});

test("self-approval, skipped transitions and stale source revision all fail closed",async(t)=>{
  const db=await setup(t);
  await proposed(db);
  await assert.rejects(act(db,"approved","maker","bad-self"),/independent|maker|checker/i);
  await assert.rejects(act(db,"activated","checker","bad-skip"),/transition|approved/i);
  await db.exec("update vyndi_sales_orders set revision=4 where id='DEMO-SO'");
  await act(db,"approved","checker","req-approve");
  await assert.rejects(act(db,"activated","checker","bad-drift"),/revision|drift|stale/i);
});

test("audit case and events cannot be modified or removed",async(t)=>{
  const db=await setup(t);
  await proposed(db);
  await assert.rejects(db.query("delete from vyndi_demo_retirement_cases where case_id='CASE-DEMO'"),/append.only|immutable|cannot|protected/i);
  await assert.rejects(db.query("update vyndi_demo_retirement_events set actor_user_id='forged'"),/append.only|immutable|cannot|protected/i);
  await assert.rejects(act(db,"proposed","maker","req-second-propose"),/transition|duplicate/i);
});

test("business projections use the active-only view, while original source tables remain audit-accessible",async()=>{
  const ibpe=await readFile(new URL("../src/lib/ibpe-authority.ts",import.meta.url),"utf8");
  const production=await readFile(new URL("../src/lib/production-job-card-view.ts",import.meta.url),"utf8");
  const sql=await readFile(migration,"utf8");
  assert.match(ibpe,/from vyndi_operational_sales_orders o/);
  assert.match(ibpe,/from vyndi_operational_sales_orders where status='confirmed'/);
  assert.match(production,/from vyndi_operational_sales_orders o/);
  assert.match(sql,/create or replace view vyndi_committed_procurement_requirements/);
  assert.match(sql,/join vyndi_operational_sales_orders/);
  assert.doesNotMatch(sql,/delete\s+from\s+(vyndi_sales_orders|epr_production_job_cards|epr_inventory)/i);
  assert.doesNotMatch(sql,/update\s+(vyndi_sales_orders|epr_production_job_cards|epr_inventory)/i);
});
