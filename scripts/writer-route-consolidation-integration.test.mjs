import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { pendingMigrations } from "./migration-plan.mjs";

const here=dirname(fileURLToPath(import.meta.url));
const migrationsDir=join(here,"..","migrations");

async function db(){
  const instance=new PGlite();
  await instance.waitReady;
  const files=await readdir(migrationsDir);
  for(const migration of pendingMigrations(files,[])){
    await instance.exec(await readFile(join(migrationsDir,migration.path),"utf8"));
  }
  return instance;
}

test("new ERP inventory SKU requires approved Inventory Master identity and derives identity metadata from it",async(t)=>{
  const sql=await db();
  t.after(()=>sql.close());

  const args=[
    "ITEM-CONSOLIDATION","MOV-CONSOLIDATION","LED-CONSOLIDATION","components",
    "SKU-CONSOLIDATED","Spoof Name","spoof-category","pair",1,1,2,50,
    "2026-10-07",null,null,"TEST:RECEIPT","route consolidation","inventory-user","operations",
  ];

  await assert.rejects(
    sql.query(
      `select * from save_vyndi_master_inventory_entry(
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::date,$14::date,$15::date,$16,$17,$18,$19
      )`,
      args,
    ),
    /approved Inventory Master/i,
  );

  await sql.query(
    `insert into master_data_records(
      id,domain,code,name,revision,status,owner_role,approver_role,effective_from,
      source_ref,attributes,created_by,approved_by,approved_at
    ) values (
      '00000000-0000-0000-0000-000000000143','inventory','SKU-CONSOLIDATED',
      'Canonical Approved Part',1,'approved','operations','operations',null,
      'TEST:MASTER',$1::jsonb,'inventory-user','inventory-approver',now()
    )`,
    [JSON.stringify({category:"approved-category",unit:"ea",controlState:"controlled"})],
  );

  await sql.query(
    `select * from save_vyndi_master_inventory_entry(
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::date,$14::date,$15::date,$16,$17,$18,$19
    )`,
    args,
  );

  const item=await sql.query(
    "select sku,name,category,unit from master_inventory_items where sku='SKU-CONSOLIDATED'",
  );
  assert.equal(item.rows.length,1);
  assert.equal(item.rows[0].name,"Canonical Approved Part");
  assert.equal(item.rows[0].category,"approved-category");
  assert.equal(item.rows[0].unit,"ea");
});

test("Funding lifecycle inserts emit canonical enterprise audit events",async(t)=>{
  const sql=await db();
  t.after(()=>sql.close());

  await sql.query(
    "select save_vyndi_monthly_actual($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)",
    [12,null,null,null,null,20,null,null,null,"TEST:CASH",true,"finance-user","finance"],
  );

  await sql.query(
    "select create_vyndi_funding_loan($1,$2,$3,$4,$5,$6::date,$7::date,$8,$9,$10,$11)",
    ["LOAN-AUDIT","Audit Bank","FAC-AUDIT",20,10,"2026-10-01","2027-10-01","TEST:LOAN","EVID:LOAN","finance-user","finance"],
  );
  await sql.query(
    "select * from post_vyndi_cash_funding_receipt($1,$2,$3::date,$4,$5,$6,$7,$8,$9,$10)",
    ["CASH-LOAN-AUDIT",12,"2026-10-02",10,"loan","debt","BANK:LOAN:AUDIT","audit drawdown","finance-user","finance"],
  );
  await sql.query(
    "select * from register_vyndi_loan_drawdown($1,$2,$3,$4,$5,$6,$7)",
    ["LOAN-DRAW-AUDIT","LOAN-AUDIT","CASH-LOAN-AUDIT","drawdown","EVID:DRAW","finance-user","finance"],
  );
  await sql.query(
    "select * from accrue_vyndi_loan_interest($1,$2,$3::date,$4,$5,$6,$7,$8)",
    ["LOAN-INT-AUDIT","LOAN-AUDIT","2026-10-31",1,"EVID:INT","interest","finance-user","finance"],
  );
  await sql.query(
    "select * from post_vyndi_loan_repayment($1,$2,$3,$4::date,$5,$6,$7,$8,$9,$10)",
    ["LOAN-PAY-AUDIT","LOAN-AUDIT",12,"2026-10-31",2,0.5,"BANK:LOAN:PAY:AUDIT","repayment","finance-user","finance"],
  );

  await sql.query(
    "select create_vyndi_funding_grant($1,$2,$3,$4,$5,$6::date,$7::date,$8::date,$9,$10,$11,$12)",
    ["GRANT-AUDIT","Audit Grant","Audit Agency","AWARD-AUDIT",5,"2026-10-01","2026-10-01","2027-03-31","TEST:GRANT","EVID:GRANT","finance-user","finance"],
  );
  await sql.query(
    "select * from post_vyndi_cash_funding_receipt($1,$2,$3::date,$4,$5,$6,$7,$8,$9,$10)",
    ["CASH-GRANT-AUDIT",12,"2026-10-03",3,"grant","grant_income","BANK:GRANT:AUDIT","grant receipt","finance-user","finance"],
  );
  await sql.query(
    "select * from register_vyndi_grant_receipt($1,$2,$3,$4,$5,$6)",
    ["GRANT-REC-AUDIT","GRANT-AUDIT","CASH-GRANT-AUDIT","EVID:GRANT:REC","finance-user","finance"],
  );
  await sql.query(
    "select * from record_vyndi_grant_condition($1,$2,$3,$4,$5,$6::date,$7,$8,$9,$10)",
    ["GRANT-COND-AUDIT","GRANT-AUDIT","REPORT","Quarterly report","met","2026-12-31","EVID:COND","met","finance-user","finance"],
  );
  await sql.query(
    "select * from post_vyndi_grant_utilisation($1,$2,$3,$4::date,$5,$6,$7,$8,$9,$10,$11)",
    ["GRANT-USE-AUDIT","GRANT-AUDIT",12,"2026-10-20",1,"prototype","EXP-AUDIT","EVID:USE","use","finance-user","finance"],
  );

  const expected=[
    "FUNDING_LOAN_DRAWDOWN_RECORDED",
    "FUNDING_LOAN_INTEREST_ACCRUED",
    "FUNDING_LOAN_PRINCIPAL_REPAID",
    "FUNDING_LOAN_INTEREST_REPAID",
    "FUNDING_GRANT_CREATED",
    "FUNDING_GRANT_RECEIPT_LINKED",
    "FUNDING_GRANT_UTILISATION_POSTED",
    "FUNDING_GRANT_CONDITION_RECORDED",
  ];
  const audit=await sql.query(
    `select action,actor_user_id,actor_role,source_reference
       from vyndi_audit_events
      where action=any($1::text[])
      order by action`,
    [expected],
  );
  assert.deepEqual(new Set(audit.rows.map((row)=>row.action)),new Set(expected));
  for(const row of audit.rows){
    assert.equal(row.actor_user_id,"finance-user");
    assert.equal(row.actor_role,"finance");
    assert.ok(String(row.source_reference||"").length>0);
  }
});
