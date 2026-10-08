import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { pendingMigrations } from "./migration-plan.mjs";

const here=dirname(fileURLToPath(import.meta.url));
const migrationsDir=join(here,"..","migrations");

async function canonicalDb(){
  const db=new PGlite();
  await db.waitReady;
  const files=await readdir(migrationsDir);
  for(const migration of pendingMigrations(files,[])){
    await db.exec(await readFile(join(migrationsDir,migration.path),"utf8"));
  }
  return db;
}

test("VAOS operational write gaps close through canonical VYNDI authorities without bypassing approval",async(t)=>{
  const db=await canonicalDb();
  t.after(()=>db.close());

  await db.exec(`
    insert into vyndi_suppliers(id,name,currency,payment_terms_days,lead_time_days,approval_status,source_reference,active,created_by,updated_by)
    values('SUP-VAOS','VAOS Test Supplier','INR',30,10,'approved','TEST:SUPPLIER',true,'maker','maker');

    insert into vyndi_purchase_orders(
      id,supplier_id,requirement_month,sku,unit,quantity,unit_price_inr,order_date,expected_receipt_on,
      payment_terms_days,status,source_reference,notes,created_by,updated_by
    ) values(
      'PO-VAOS','SUP-VAOS',1,'VAOS-SKU','ea',10,100,'2026-10-01','2026-10-10',
      30,'approved','TEST:PO','', 'maker','maker'
    );
  `);

  const amended=await db.query(
    `select * from amend_vyndi_purchase_order($1,$2,$3,$4,$5,$6::date,$7,$8,$9,$10,$11)`,
    ['PO-VAOS',1,'SUP-VAOS',12,110,'2026-10-12',45,'VAOS|M1|I1','controlled change','maker','operations'],
  );
  assert.equal(Number(amended.rows[0].record_revision),2);
  assert.equal(amended.rows[0].status,'pending_approval');
  const po=await db.query(`select record_revision,status,approved_by from vyndi_purchase_orders where id='PO-VAOS'`);
  assert.equal(Number(po.rows[0].record_revision),2);
  assert.equal(po.rows[0].status,'pending_approval');
  assert.equal(po.rows[0].approved_by,null);

  await assert.rejects(
    db.query(
      `select * from amend_vyndi_purchase_order($1,$2,$3,$4,$5,$6::date,$7,$8,$9,$10,$11)`,
      ['PO-VAOS',1,'SUP-VAOS',13,111,'2026-10-13',45,'VAOS|M1|I2','stale','maker','operations'],
    ),
    /Stale purchase-order revision/,
  );

  await db.exec(`
    insert into epr_travellers(
      id,venture,model_id,model_name,sku,bom_revision,engineering_revision,serial_number,supplier,status,created_by
    ) values(
      'TRV-VAOS','aluminium','core-tiagra','VYNDI Test','VAOS-BIKE','BOM-VAOS','ENG-VAOS','SER-VAOS','',
      'released','maker'
    );
    insert into epr_gate_events(id,traveller_id,gate_id,status,reason,actor)
    values('GATE-VAOS','TRV-VAOS','EPR-04','passed','test release','checker');
  `);
  const started=await db.query(
    `select * from transition_vyndi_traveller_stage($1,$2,$3,$4,$5,$6,$7,$8)`,
    ['TRV-VAOS','released',1,'in_build','VAOS|M2|I1','start controlled build','operator','operations'],
  );
  assert.equal(started.rows[0].status,'in_build');
  assert.equal(Number(started.rows[0].record_revision),2);

  await assert.rejects(
    db.query(
      `select * from transition_vyndi_traveller_stage($1,$2,$3,$4,$5,$6,$7,$8)`,
      ['TRV-VAOS','in_build',2,'completed','VAOS|M2|I2','complete build','checker','qa'],
    ),
    /Traveller completion blocked by Quality/,
  );

  await db.exec(`
    insert into vyndi_quality_inspections(
      id,inspection_stage,inspection_type,traveller_id,sample_size,defect_quantity,result,disposition,
      criteria_ref,evidence_ref,notes,recorded_by,recorded_role
    ) values(
      'QI-VAOS','final','final_release','TRV-VAOS',1,0,'pass','accepted',
      'TEST:CRITERIA','TEST:EVIDENCE','', 'qa-checker','qa'
    );
  `);
  const completed=await db.query(
    `select * from transition_vyndi_traveller_stage($1,$2,$3,$4,$5,$6,$7,$8)`,
    ['TRV-VAOS','in_build',2,'completed','VAOS|M2|I3','quality-cleared completion','checker','qa'],
  );
  assert.equal(completed.rows[0].status,'completed');
  assert.equal(Number(completed.rows[0].record_revision),3);

  await db.exec(`
    insert into vyndi_supplier_invoices(
      id,purchase_order_id,invoice_number,invoice_on,due_on,quantity_invoiced,amount_ex_gst_inr,gst_inr,
      status,match_message,source_reference,created_by,approved_by,approved_at
    ) values(
      'INV-VAOS','PO-VAOS','INV-001','2026-10-02','2026-11-01',12,10000,0,
      'approved','matched','TEST:INVOICE','maker','checker',now()
    );
  `);

  const prepared=await db.query(
    `select * from prepare_vyndi_supplier_payment($1,$2,$3,$4,$5::date,$6,$7,$8,$9,$10)`,
    ['PREP-VAOS','VAOS-IDEMPOTENCY-001','INV-VAOS',1,'2026-10-20',5000,'VAOS|M3|I1','prepare only','finance-maker','finance'],
  );
  assert.equal(prepared.rows[0].status,'pending_approval');
  assert.equal(Number(prepared.rows[0].record_revision),1);

  const paymentCountBefore=await db.query(`select count(*)::int as count from vyndi_supplier_payments where supplier_invoice_id='INV-VAOS'`);
  assert.equal(Number(paymentCountBefore.rows[0].count),0,'preparation must not post cash/payment');

  await assert.rejects(
    db.query(
      `select * from approve_vyndi_supplier_payment_preparation($1,$2,$3,$4,$5)`,
      ['PREP-VAOS',1,'VAOS|M3|APPROVE-SELF','finance-maker','finance'],
    ),
    /requires a different authorised user/,
  );

  const approved=await db.query(
    `select * from approve_vyndi_supplier_payment_preparation($1,$2,$3,$4,$5)`,
    ['PREP-VAOS',1,'VAOS|M3|APPROVE','finance-checker','finance'],
  );
  assert.equal(approved.rows[0].status,'approved');
  assert.equal(Number(approved.rows[0].record_revision),2);

  const paymentCountAfter=await db.query(`select count(*)::int as count from vyndi_supplier_payments where supplier_invoice_id='INV-VAOS'`);
  assert.equal(Number(paymentCountAfter.rows[0].count),0,'approval of preparation still must not post cash/payment');

  const audit=await db.query(
    `select action from vyndi_audit_events
      where entity_id in ('PO-VAOS','TRV-VAOS','PREP-VAOS')
      order by created_at`,
  );
  const actions=audit.rows.map(row=>row.action);
  assert.ok(actions.includes('PURCHASE_ORDER_AMENDED'));
  assert.ok(actions.includes('TRAVELLER_STAGE_ADVANCED'));
  assert.ok(actions.includes('SUPPLIER_PAYMENT_PREPARED'));
  assert.ok(actions.includes('SUPPLIER_PAYMENT_PREPARATION_APPROVED'));
});

test("source authorities expose governed server functions for all three closed bridge gaps",async()=>{
  const read=(path)=>readFile(join(here,"..",path),"utf8");
  const [po,traveller,finance,migration]=await Promise.all([
    read("src/lib/purchase-order-amendment-authority.ts"),
    read("src/lib/production-traveller-stage-authority.ts"),
    read("src/lib/finance/payment-preparation-authority.ts"),
    read("migrations/0146_vaos_operational_write_authority_closure.sql"),
  ]);
  assert.match(po,/amendPurchaseOrder/);
  assert.match(po,/amend_vyndi_purchase_order/);
  assert.match(traveller,/advanceProductionTravellerStage/);
  assert.match(traveller,/transition_vyndi_traveller_stage/);
  assert.match(finance,/prepareSupplierPayment/);
  assert.match(finance,/approveSupplierPaymentPreparation/);
  assert.match(finance,/executeSupplierPaymentPreparation/);
  assert.match(migration,/approved amendments are forced back through approval/i);
  assert.match(migration,/completion requires canonical Quality release/i);
  assert.match(migration,/Payment preparation only; no cash or journal posted/i);
});
