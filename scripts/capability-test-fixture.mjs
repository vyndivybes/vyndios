import { createHash } from "node:crypto";
import { approveInventoryMaster } from "./inventory-master-fixture.mjs";

// Only for a fresh, isolated test database. Never imported by runtime routes.
export async function seedCapabilityFixture(db, finance) {
  const occupied = await db.query("select (select count(*) from vyndi_sales_orders) + (select count(*) from vyndi_plan_revisions) as count");
  if (Number(occupied.rows[0].count) !== 0) throw new Error("Capability fixture requires empty orders and plans; no records will be replaced");
  const source = "SYNTHETIC-CAPABILITY-TEST-ONLY";
  const digest = createHash("sha256").update(JSON.stringify({version:1,source,finance})).digest("hex");
  await db.query(`insert into vyndi_plan_revisions
    (id,revision,status,horizon_months,scenario,draw_standby,finance_json,accounting_json,change_reason,created_by,approved_by,approved_at)
    values ('CAP-TEST-PLAN',1,'approved',36,'base',false,$1::jsonb,'{}'::jsonb,$2,'cap-test-maker','cap-test-checker',now())`, [JSON.stringify(finance),source]);
  await approveInventoryMaster(db,{sku:"CAP-TEST-SKU",name:"Synthetic capability test component",category:"test",unit:"ea"});
  await db.query(`insert into master_inventory_items
    (id,ledger_id,sku,name,category,unit,minimum_stock_level,planned_monthly_use,created_by,updated_by)
    values ('CAP-TEST-ITEM','components','CAP-TEST-SKU','Synthetic capability test component','test','ea',0,0,'cap-test-maker','cap-test-maker')`);
  await db.query(`insert into vyndi_supply_planning_parameters
    (sku,lead_time_months,moq,order_multiple,payment_lag_months,planning_status,source_ref,source_sha256,updated_by)
    values ('CAP-TEST-SKU',0,1,1,0,'approved',$1,$2,'cap-test-checker')`,[source,digest]);
  for (const tier of ["core","pro","apex"]) {
    await db.query(`insert into epr_bom_inventory_mappings
      (id,venture,model_id,bom_revision,bom_line_key,sku,quantity,unit,status,approved_by,approved_at,created_by)
      values ($1,'aluminium',$2,'CAP-TEST-BOM-R1','synthetic-component','CAP-TEST-SKU',1,'ea','active','cap-test-checker',now(),'cap-test-maker')`,["CAP-TEST-MAP-"+tier,tier]);
  }
  for (let i=1;i<=4;i++) {
    const id = "CAP-TEST-SO-"+i;
    await db.query(`select * from save_vyndi_sales_order($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13,$14)`,
      [id,6,"aluminium",1,1.25,"direct","confirmed","core","core-tiagra","TEST ONLY bicycle",JSON.stringify({}),source,"cap-test-maker","operations"]);
    await db.query(`insert into epr_production_job_cards
      (id,sales_order_id,product_id,product_label,units,bom_tier,due_month,status,production_owner,created_by,model_tier,variant_id,configuration,sales_order_revision,bom_revision,released_mapping_set,updated_by)
      values ($1,$2,'aluminium','TEST ONLY bicycle',1,'core',6,'released','operations','cap-test-maker','core','core-tiagra','{}'::jsonb,1,'CAP-TEST-BOM-R1','["CAP-TEST-MAP-core"]'::jsonb,'cap-test-checker')`,
      ["CAP-TEST-CARD-"+i,id]);
    await db.query(`insert into epr_production_job_card_lines
      (id,job_card_id,stage_no,stage_code,stage_name,line_type,item,quantity,unit,source_bom_line,issue_status,sku,category,available_quantity,shortage_quantity,bom_mapping_id,requirement_revision)
      values ($1,$2,1,'ST-01','Kitting','component','TEST ONLY component',1,'ea','synthetic-component','pending','CAP-TEST-SKU','test',0,1,'CAP-TEST-MAP-core',1)`,
      ["CAP-TEST-LINE-"+i,"CAP-TEST-CARD-"+i]);
  }
  return {source,fixtureVersion:1,inputHash:digest,orders:4,physicalApproval:false};
}
