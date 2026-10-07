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

test("People operational ledgers derive current state and reject stale person revisions",async(t)=>{
  const sql=await db(); t.after(()=>sql.close());
  await sql.query(
    `insert into vyndi_people_records
      (id,display_name,function_name,role_title,engagement_type,lifecycle_status,start_month,source_ref,created_by,operational_status,record_revision)
     values ('P-1','Test Person','Operations','Engineer','employee','approved',1,'TEST:PERSON','test-user','active',1)`
  );

  const employment=await sql.query(
    "select * from record_vyndi_people_employment_event($1,$2,$3,$4::date,$5::jsonb,$6,$7,$8,$9,$10,$11)",
    ["EMP-1","P-1","promotion","2026-10-01",JSON.stringify({roleTitle:"Senior Engineer"}),"active",1,"TEST:EMP","EVID:EMP","hr-user","management"],
  );
  assert.equal(Number(employment.rows[0].new_revision),2);

  await assert.rejects(
    sql.query(
      "select * from record_vyndi_people_employment_event($1,$2,$3,$4::date,$5::jsonb,$6,$7,$8,$9,$10,$11)",
      ["EMP-STALE","P-1","role_change","2026-10-02",JSON.stringify({roleTitle:"Lead"}),"active",1,"TEST:STALE","EVID:STALE","hr-user","management"],
    ),
    /Stale People record revision/i,
  );

  await sql.query(
    "select * from record_vyndi_people_attendance($1,$2,$3::date,$4,$5,$6,$7,$8,$9,$10,$11)",
    ["ATT-1","P-1","2026-10-03","present",8,1,"initial","TEST:ATT","EVID:ATT-1","hr-user","management"],
  );
  await sql.query(
    "select * from record_vyndi_people_attendance($1,$2,$3::date,$4,$5,$6,$7,$8,$9,$10,$11)",
    ["ATT-2","P-1","2026-10-03","remote",7.5,0,"correction","TEST:ATT","EVID:ATT-2","hr-user","management"],
  );
  const attendance=await sql.query("select attendance_status,revision from vyndi_people_attendance_current where person_id='P-1' and work_date='2026-10-03'");
  assert.equal(attendance.rows[0].attendance_status,"remote");
  assert.equal(Number(attendance.rows[0].revision),2);

  await sql.query(
    "select * from post_vyndi_people_leave_transaction($1,$2,$3,$4,$5,$6,$7::date,$8,$9,$10,$11,$12,$13)",
    ["LV-1","P-1","annual","entitlement","credit",20,"2026-01-01","ENT-2026","","TEST:LEAVE","EVID:LV-1","hr-user","management"],
  );
  await sql.query(
    "select * from post_vyndi_people_leave_transaction($1,$2,$3,$4,$5,$6,$7::date,$8,$9,$10,$11,$12,$13)",
    ["LV-2","P-1","annual","approved_leave","debit",3,"2026-10-04","LEAVE-REQ-1","","TEST:LEAVE","EVID:LV-2","hr-user","management"],
  );
  await sql.query(
    "select * from post_vyndi_people_leave_transaction($1,$2,$3,$4,$5,$6,$7::date,$8,$9,$10,$11,$12,$13)",
    ["LV-3","P-1","annual","cancellation","credit",1,"2026-10-05","LEAVE-REQ-1","","TEST:LEAVE","EVID:LV-3","hr-user","management"],
  );
  const leave=await sql.query("select balance_days from vyndi_people_leave_balance where person_id='P-1' and leave_type='annual'");
  assert.equal(Number(leave.rows[0].balance_days),18);

  await sql.query(
    "select record_vyndi_people_qualification($1,$2,$3,$4,$5,$6::date,$7::date,$8,$9,$10,$11,$12,$13)",
    ["QUAL-1","P-1","AV-001","Avionics Safety","obtained","2026-01-01","2027-01-01","CERT-001","","TEST:QUAL","EVID:QUAL","hr-user","management"],
  );
  const qualification=await sql.query("select currently_valid from vyndi_people_qualification_current where person_id='P-1' and qualification_code='AV-001'");
  assert.equal(qualification.rows[0].currently_valid,true);
});

test("People exit is fail-closed until asset access payroll leave handover and department controls clear",async(t)=>{
  const sql=await db(); t.after(()=>sql.close());
  await sql.query(
    `insert into vyndi_people_records
      (id,display_name,function_name,role_title,engagement_type,lifecycle_status,start_month,source_ref,created_by,operational_status,record_revision)
     values ('P-EXIT','Exit Person','Office','Manager','employee','approved',1,'TEST:PERSON','test-user','active',1)`
  );
  await sql.query(
    `insert into vyndi_people_office_assets
      (id,name,category,asset_class,cost_lakh,monthly_cost_lakh,purchase_month,useful_life_months,allocation_pct,lifecycle_status,source_ref,created_by)
     values ('ASSET-EXIT','Laptop','IT','office_admin',1,0,1,60,100,'approved','TEST:ASSET','test-user')`
  );

  await sql.query(
    "select record_vyndi_people_asset_custody($1,$2,$3,$4,$5::timestamptz,$6,$7,$8,$9,$10)",
    ["CUST-1","P-EXIT","ASSET-EXIT","issue","2026-10-01T09:00:00Z","","TEST:CUST","EVID:CUST-1","hr-user","management"],
  );
  await sql.query(
    "select record_vyndi_people_access_event($1,$2,$3,$4,$5,$6::timestamptz,$7,$8,$9,$10,$11)",
    ["ACC-1","P-EXIT","vyndi-admin","grant","admin","2026-10-01T09:00:00Z","","TEST:ACCESS","EVID:ACC-1","hr-user","management"],
  );
  await sql.query(
    "select record_vyndi_people_payroll_readiness($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9)",
    ["PAY-1","P-EXIT","2026-10","settled",JSON.stringify({attendanceReconciled:true,leaveReconciled:true}),"TEST:PAY","EVID:PAY","payroll-user","finance"],
  );

  const initiated=await sql.query(
    "select * from initiate_vyndi_people_exit($1,$2,$3::date,$4,$5,$6,$7,$8)",
    ["EXIT-1","P-EXIT","2026-10-31",1,"TEST:EXIT","EVID:EXIT","hr-user","management"],
  );
  assert.equal(Number(initiated.rows[0].new_revision),2);

  for(const [id,type] of [["CLR-1","handover"],["CLR-2","leave_reconciliation"],["CLR-3","department_clearance"]]){
    await sql.query(
      "select * from record_vyndi_people_exit_clearance($1,$2,$3,$4,$5,$6,$7,$8,$9)",
      [id,"EXIT-1",type,"cleared","verified","TEST:CLEAR",`EVID:${type}`,"hr-user","management"],
    );
  }

  await assert.rejects(
    sql.query(
      "select * from finalize_vyndi_people_exit($1,$2,$3,$4,$5,$6)",
      ["EXIT-1",2,"TEST:FINAL","EVID:FINAL","hr-user","management"],
    ),
    /open asset custody/i,
  );

  await sql.query(
    "select record_vyndi_people_asset_custody($1,$2,$3,$4,$5::timestamptz,$6,$7,$8,$9,$10)",
    ["CUST-2","P-EXIT","ASSET-EXIT","return","2026-10-30T10:00:00Z","","TEST:CUST","EVID:CUST-2","hr-user","management"],
  );
  await assert.rejects(
    sql.query(
      "select * from finalize_vyndi_people_exit($1,$2,$3,$4,$5,$6)",
      ["EXIT-1",2,"TEST:FINAL","EVID:FINAL","hr-user","management"],
    ),
    /active access/i,
  );

  await sql.query(
    "select record_vyndi_people_access_event($1,$2,$3,$4,$5,$6::timestamptz,$7,$8,$9,$10,$11)",
    ["ACC-2","P-EXIT","vyndi-admin","revoke","admin","2026-10-30T11:00:00Z","","TEST:ACCESS","EVID:ACC-2","hr-user","management"],
  );

  const readiness=await sql.query("select * from vyndi_people_exit_readiness where exit_case_id='EXIT-1'");
  assert.equal(readiness.rows[0].can_finalize,true);

  const finalized=await sql.query(
    "select * from finalize_vyndi_people_exit($1,$2,$3,$4,$5,$6)",
    ["EXIT-1",2,"TEST:FINAL","EVID:FINAL","hr-user","management"],
  );
  assert.equal(Number(finalized.rows[0].new_revision),3);
  assert.equal(finalized.rows[0].person_status,"inactive");

  const person=await sql.query("select lifecycle_status,operational_status,record_revision from vyndi_people_records where id='P-EXIT'");
  assert.equal(person.rows[0].lifecycle_status,"inactive");
  assert.equal(person.rows[0].operational_status,"inactive");
  assert.equal(Number(person.rows[0].record_revision),3);
});
