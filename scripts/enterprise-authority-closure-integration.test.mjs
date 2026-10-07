import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { pendingMigrations } from "./migration-plan.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(here, "..", "migrations");

async function canonicalDb() {
  const db = new PGlite();
  await db.waitReady;
  const files = await readdir(migrationsDir);
  for (const migration of pendingMigrations(files, [])) {
    await db.exec(await readFile(join(migrationsDir, migration.path), "utf8"));
  }
  return db;
}

async function seedTraveller(db, suffix) {
  const salesOrderId = `SO-${suffix}`;
  const cardId = `CARD-${suffix}`;
  const travellerId = `TRV-${suffix}`;

  await db.query(
    `select * from save_vyndi_sales_order(
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13,$14
    )`,
    [
      salesOrderId, 6, "aluminium", 1, 1.25, "direct", "confirmed", "core", "core-tiagra",
      "VYNDI Longitude Tiagra", JSON.stringify({ groupset: "gs-tiagra-4700" }),
      "authority closure integration", "test-user", "operations",
    ],
  );

  await db.query(
    `insert into epr_production_job_cards
      (id,sales_order_id,product_id,product_label,units,bom_tier,due_month,status,production_owner,created_by,
       model_tier,variant_id,configuration,sales_order_revision,bom_revision,released_mapping_set,updated_by)
     values
      ($1,$2,'aluminium','VYNDI Longitude Tiagra',1,'core',6,'released',
       'operations','test-user','core','core-tiagra',$3::jsonb,1,$4,$5::jsonb,'test-user')`,
    [cardId, salesOrderId, JSON.stringify({ groupset: "gs-tiagra-4700" }), `BOM-${suffix}`, JSON.stringify([])],
  );

  await db.query(
    `insert into epr_travellers
      (id,venture,model_id,model_name,sku,bom_revision,engineering_revision,serial_number,supplier,status,created_by,job_card_id,job_card_revision)
     values ($1,'aluminium','core','Longitude','TEST-SKU',$2,'ENG-TEST',$3,'Test OEM','released','test-user',$4,1)`,
    [travellerId, `BOM-${suffix}`, `SERIAL-${suffix}`, cardId],
  );

  return { salesOrderId, cardId, travellerId };
}

test("latest-effective Quality evidence invalidates an older pass and includes later EPR evidence", async (t) => {
  const db = await canonicalDb();
  t.after(() => db.close());
  const { salesOrderId, cardId, travellerId } = await seedTraveller(db, "QUALITY-CLOSURE");

  await db.query(
    `insert into vyndi_quality_inspections
      (id,inspection_stage,inspection_type,sales_order_id,job_card_id,traveller_id,sample_size,defect_quantity,
       result,disposition,criteria_ref,evidence_ref,recorded_by,recorded_role,recorded_at)
     values
      ('Q-FINAL-PASS','final','final release',$1,$2,$3,1,0,'pass','accepted','QC-FINAL','EVID-PASS',
       'quality-user','quality','2026-10-01T10:00:00Z')`,
    [salesOrderId, cardId, travellerId],
  );

  let gate = await db.query("select * from vyndi_quality_release_gate($1)", [travellerId]);
  assert.equal(gate.rows[0].can_release, true);

  await db.query(
    `insert into vyndi_quality_inspections
      (id,inspection_stage,inspection_type,sales_order_id,job_card_id,traveller_id,sample_size,defect_quantity,
       result,disposition,criteria_ref,evidence_ref,recorded_by,recorded_role,recorded_at)
     values
      ('Q-FINAL-FAIL','final','final release',$1,$2,$3,1,1,'fail','quarantine','QC-FINAL','EVID-FAIL',
       'quality-user','quality','2026-10-01T11:00:00Z')`,
    [salesOrderId, cardId, travellerId],
  );

  gate = await db.query("select * from vyndi_quality_release_gate($1)", [travellerId]);
  assert.equal(gate.rows[0].can_release, false);
  assert.match(String(gate.rows[0].blocking_reason), /latest effective final inspection is fail/i);

  await db.query("delete from vyndi_quality_inspections where id='Q-FINAL-FAIL'");
  await db.query(
    `insert into epr_inspections
      (id,traveller_id,venture,inspection_type,characteristic,result,evidence_reference,inspected_by,inspected_at)
     values
      ('EPR-LATER-FAIL',$1,'aluminium','dimensional','post-final dimensional recheck','fail',
       'EPR-EVID-FAIL','epr-user','2026-10-01T12:00:00Z')`,
    [travellerId],
  );

  gate = await db.query("select * from vyndi_quality_release_gate($1)", [travellerId]);
  assert.equal(gate.rows[0].can_release, false);
  assert.match(String(gate.rows[0].blocking_reason), /adverse EPR inspection evidence/i);
});

test("Maintenance closeout rolls back inventory and work-order state when FIFO stock is insufficient", async (t) => {
  const db = await canonicalDb();
  t.after(() => db.close());

  await db.query(
    `insert into master_data_records(
      id,domain,code,name,revision,status,owner_role,approver_role,effective_from,
      source_ref,attributes,created_by,approved_by,approved_at
    ) values (
      '00000000-0000-0000-0000-000000000144','inventory','MAINT-PART-TEST',
      'Maintenance test part',1,'approved','operations','operations',null,
      'TEST:MAINT:MASTER',$1::jsonb,'inventory-user','inventory-approver',now()
    )`,
    [JSON.stringify({category:"service-part",unit:"ea",controlState:"controlled"})],
  );

  await db.query(
    `select * from save_vyndi_master_inventory_entry(
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::date,$14::date,$15::date,$16,$17,$18,$19
    )`,
    [
      "ITEM-MAINT-CLOSURE","MOV-MAINT-RECEIPT","LED-MAINT-RECEIPT","components",
      "MAINT-PART-TEST","Maintenance test part","service-part","ea",0,0,1,100,
      "2026-10-01",null,null,"GRN-MAINT-CLOSURE","authority closure stock","inventory-user","operations",
    ],
  );

  await db.query(
    `insert into epr_equipment(id,asset_tag,equipment_type,description,status,calibration_required)
     values ('EQ-MAINT-CLOSURE','ASSET-MAINT-CLOSURE','test-rig','Authority closure test','maintenance',false)`,
  );
  await db.query(
    `insert into vyndi_maintenance_work_orders
      (id,equipment_id,work_order_type,priority,status,title,description,started_at,downtime_started_at,created_by,source_reference)
     values
      ('WO-MAINT-CLOSURE','EQ-MAINT-CLOSURE','corrective','normal','in_progress',
       'Replace service part','Integration rollback proof',now(),now(),'maintenance-user','TEST:MAINT')`,
  );

  const parts = JSON.stringify([{
    sku: "MAINT-PART-TEST",
    quantity: 2,
    sourceReference: "TEST:PART",
  }]);

  await assert.rejects(
    db.query(
      "select * from complete_vyndi_maintenance_work_order($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11)",
      [
        "WO-MAINT-CLOSURE","failed test part","replaced service part",1,0,
        "EVID-MAINT","RTS-MAINT",parts,"TEST:COMPLETE","maintenance-user","quality",
      ],
    ),
    /Insufficient available-to-promise stock/i,
  );

  let wo = await db.query("select status,parts_cost_inr from vyndi_maintenance_work_orders where id='WO-MAINT-CLOSURE'");
  assert.equal(wo.rows[0].status, "in_progress");
  assert.equal(Number(wo.rows[0].parts_cost_inr), 0);

  let balance = await db.query(
    "select coalesce(sum(quantity_delta),0) as balance from epr_inventory_ledger where sku='MAINT-PART-TEST'",
  );
  assert.equal(Number(balance.rows[0].balance), 1);

  let partsEvidence = await db.query(
    "select count(*)::int as count from vyndi_maintenance_parts where work_order_id='WO-MAINT-CLOSURE'",
  );
  assert.equal(Number(partsEvidence.rows[0].count), 0);

  const successfulParts = JSON.stringify([{
    sku: "MAINT-PART-TEST",
    quantity: 1,
    sourceReference: "TEST:PART",
  }]);
  const completed = await db.query(
    "select * from complete_vyndi_maintenance_work_order($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11)",
    [
      "WO-MAINT-CLOSURE","failed test part","replaced service part",1,0,
      "EVID-MAINT","RTS-MAINT",successfulParts,"TEST:COMPLETE","maintenance-user","quality",
    ],
  );

  assert.equal(completed.rows[0].work_order_status, "completed");
  assert.equal(completed.rows[0].release_status, "available");
  assert.equal(Number(completed.rows[0].parts_cost_inr), 100);

  wo = await db.query("select status,parts_cost_inr,returned_to_service_by from vyndi_maintenance_work_orders where id='WO-MAINT-CLOSURE'");
  assert.equal(wo.rows[0].status, "completed");
  assert.equal(Number(wo.rows[0].parts_cost_inr), 100);
  assert.equal(wo.rows[0].returned_to_service_by, "maintenance-user");

  balance = await db.query(
    "select coalesce(sum(quantity_delta),0) as balance from epr_inventory_ledger where sku='MAINT-PART-TEST'",
  );
  assert.equal(Number(balance.rows[0].balance), 0);

  partsEvidence = await db.query(
    `select inventory_movement_id,inventory_ledger_id,fifo_cost_inr,unit_cost_inr
       from vyndi_maintenance_parts where work_order_id='WO-MAINT-CLOSURE'`,
  );
  assert.equal(partsEvidence.rows.length, 1);
  assert.ok(partsEvidence.rows[0].inventory_movement_id);
  assert.ok(partsEvidence.rows[0].inventory_ledger_id);
  assert.equal(Number(partsEvidence.rows[0].fifo_cost_inr), 100);
  assert.equal(Number(partsEvidence.rows[0].unit_cost_inr), 100);
});
