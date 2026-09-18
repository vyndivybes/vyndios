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

async function db(){
  const instance=new PGlite();
  await instance.waitReady;
  const files=await readdir(migrationsDir);
  for(const migration of pendingMigrations(files,[])){
    await instance.exec(await readFile(join(migrationsDir,migration.path),"utf8"));
  }
  return instance;
}

async function saveOrder(database,{units=1,asp=1.5,reason="seed",actor="ADMIN-MAKER"}={}){
  return database.query(
    `select * from save_vyndi_sales_order(
      'REC-SO-1',6,'aluminium',$1,$2,'direct','confirmed',
      'core','core-tiagra','VYNDI Longitude Tiagra',$3::jsonb,$4,$5,'admin'
    )`,
    [units,asp,JSON.stringify({groupset:"gs-tiagra-4700"}),reason,actor],
  );
}

test("selective recovery is maker/checker and creates a new canonical Sales Order revision",async(t)=>{
  const database=await db();t.after(()=>database.close());
  await saveOrder(database,{units:1,asp:1.5,reason:"baseline"});
  await saveOrder(database,{units:3,asp:1.8,reason:"later revision"});

  await database.query(
    `select request_vyndi_selective_recovery(
      'REC-SEL-1','sales_order','REC-SO-1','revision_history',1,null,null,
      'Restore approved baseline','INC-REC-1','ADMIN-MAKER','admin'
    )`,
  );
  await assert.rejects(
    ()=>database.query(`select decide_vyndi_recovery_request('REC-SEL-1','approve','self','ADMIN-MAKER','admin')`),
    /different administrator|maker\/checker/i,
  );
  await database.query(
    `select decide_vyndi_recovery_request('REC-SEL-1','approve','independent checker','ADMIN-CHECKER','admin')`,
  );
  const executed=await database.query(
    `select * from execute_vyndi_selective_recovery('REC-SEL-1','EXEC-REC-1','ADMIN-CHECKER','admin')`,
  );
  assert.deepEqual(executed.rows[0],{entity_type:"sales_order",entity_id:"REC-SO-1",new_revision:3});

  const order=await database.query(`select revision,units,asp_lakh from vyndi_sales_orders where id='REC-SO-1'`);
  assert.equal(order.rows[0].revision,3);
  assert.equal(Number(order.rows[0].units),1);
  assert.equal(Number(order.rows[0].asp_lakh),1.5);

  const revision=await database.query(
    `select change_reason,actor_user_id,actor_role from vyndi_sales_order_revisions
      where sales_order_id='REC-SO-1' and revision=3`,
  );
  assert.match(revision.rows[0].change_reason,/Governed selective recovery REC-SEL-1/);
  assert.equal(revision.rows[0].actor_user_id,"ADMIN-CHECKER");
  assert.equal(revision.rows[0].actor_role,"admin");

  const request=await database.query(
    `select status,requested_by,decided_by,executed_by,result_revision from vyndi_recovery_requests where id='REC-SEL-1'`,
  );
  assert.deepEqual(request.rows[0],{
    status:"executed",requested_by:"ADMIN-MAKER",decided_by:"ADMIN-CHECKER",
    executed_by:"ADMIN-CHECKER",result_revision:3,
  });
});

test("selective recovery fails closed when canonical state changes after preview/request",async(t)=>{
  const database=await db();t.after(()=>database.close());
  await saveOrder(database,{units:1,reason:"baseline"});
  await saveOrder(database,{units:2,reason:"revision two"});
  await database.query(
    `select request_vyndi_selective_recovery(
      'REC-STALE','sales_order','REC-SO-1','revision_history',1,null,null,
      'Recover earlier approved demand','INC-STALE','ADMIN-MAKER','admin'
    )`,
  );
  await database.query(
    `select decide_vyndi_recovery_request('REC-STALE','approve','checker','ADMIN-CHECKER','admin')`,
  );
  await saveOrder(database,{units:4,reason:"concurrent legitimate change",actor:"ADMIN-OTHER"});
  await assert.rejects(
    ()=>database.query(`select * from execute_vyndi_selective_recovery('REC-STALE','EXEC-STALE','ADMIN-CHECKER','admin')`),
    /changed after the recovery request/i,
  );
  const request=await database.query(`select status from vyndi_recovery_requests where id='REC-STALE'`);
  assert.equal(request.rows[0].status,"approved");
});

test("Sales Order recovery fails closed after downstream Production authority exists",async(t)=>{
  const database=await db();t.after(()=>database.close());
  await saveOrder(database,{units:1,asp:1.5,reason:"baseline"});
  await saveOrder(database,{units:2,asp:1.7,reason:"later demand"});

  await database.query(
    `select request_vyndi_selective_recovery(
      'REC-DOWNSTREAM','sales_order','REC-SO-1','revision_history',1,null,null,
      'Recover earlier approved demand','INC-DOWNSTREAM','ADMIN-MAKER','admin'
    )`,
  );
  await database.query(
    `select decide_vyndi_recovery_request('REC-DOWNSTREAM','approve','independent checker','ADMIN-CHECKER','admin')`,
  );
  await database.query(
    `insert into epr_production_job_cards(
      id,sales_order_id,product_id,product_label,units,bom_tier,due_month,status,
      production_owner,created_by,sales_order_revision,updated_by
    ) values(
      'JC-REC-DOWNSTREAM','REC-SO-1','aluminium','Recovery guard test',2,'core',6,'in_progress',
      'operations','ADMIN-OTHER',2,'ADMIN-OTHER'
    )`,
  );

  await assert.rejects(
    ()=>database.query(
      `select * from execute_vyndi_selective_recovery(
        'REC-DOWNSTREAM','EXEC-DOWNSTREAM','ADMIN-CHECKER','admin'
      )`,
    ),
    /blocked once Production is in progress or complete/i,
  );
  const request=await database.query(
    `select status,result_revision from vyndi_recovery_requests where id='REC-DOWNSTREAM'`,
  );
  assert.deepEqual(request.rows[0],{status:"approved",result_revision:null});
});

test("external Sales Order recovery validates recovered business state before replay",async(t)=>{
  const database=await db();t.after(()=>database.close());
  await saveOrder(database,{units:1,asp:1.5,reason:"baseline"});
  await database.query(
    `select register_vyndi_recovery_checkpoint(
      'BKP-INVALID','pg_dump',now(),'sha','backup-log-invalid','local/vyndi.dump','hash',1000,
      'invalid snapshot test','ADMIN-MAKER','admin'
    )`,
  );
  const invalidSnapshot={
    id:"REC-SO-1",month:6,product:"aluminium",units:1,aspLakh:1.5,channel:"direct",
    status:"forged-status",modelTier:"core",variantId:"core-tiagra",
    variantName:"VYNDI Longitude Tiagra",configuration:{groupset:"gs-tiagra-4700"},
  };
  await database.query(
    `select request_vyndi_selective_recovery(
      'REC-INVALID-SNAPSHOT','sales_order','REC-SO-1','external_backup',null,$1::jsonb,'BKP-INVALID',
      'Recover external state safely','EXT-INVALID','ADMIN-MAKER','admin'
    )`,
    [JSON.stringify(invalidSnapshot)],
  );
  await database.query(
    `select decide_vyndi_recovery_request(
      'REC-INVALID-SNAPSHOT','approve','checker','ADMIN-CHECKER','admin'
    )`,
  );
  await assert.rejects(
    ()=>database.query(
      `select * from execute_vyndi_selective_recovery(
        'REC-INVALID-SNAPSHOT','EXEC-INVALID','ADMIN-CHECKER','admin'
      )`,
    ),
    /invalid status/i,
  );
});

test("monthly actual recovery creates a new governed revision without restoring transaction-owned fields",async(t)=>{
  const database=await db();t.after(()=>database.close());
  await database.query(
    `select save_vyndi_monthly_actual(
      35,null,null,null,null,5,null,null,null,'REC-CASH-R1',true,'ADMIN-MAKER','admin'
    )`,
  );
  await database.query(
    `select save_vyndi_monthly_actual(
      35,null,null,null,null,9,null,null,null,'REC-CASH-R2',true,'ADMIN-MAKER','admin'
    )`,
  );
  await database.query(
    `select request_vyndi_selective_recovery(
      'REC-ACTUAL','monthly_actual','M35','revision_history',1,null,null,
      'Restore evidenced cash baseline','INC-ACTUAL','ADMIN-MAKER','admin'
    )`,
  );
  await database.query(
    `select decide_vyndi_recovery_request(
      'REC-ACTUAL','approve','independent checker','ADMIN-CHECKER','admin'
    )`,
  );
  const executed=await database.query(
    `select * from execute_vyndi_selective_recovery(
      'REC-ACTUAL','EXEC-ACTUAL','ADMIN-CHECKER','admin'
    )`,
  );
  assert.deepEqual(executed.rows[0],{entity_type:"monthly_actual",entity_id:"M35",new_revision:3});

  const actual=await database.query(
    `select revision,revenue,units,closing_cash,receivables,verified
       from vyndi_monthly_actuals where plan_month=35`,
  );
  assert.equal(Number(actual.rows[0].revision),3);
  assert.equal(Number(actual.rows[0].closing_cash),5);
  assert.equal(Number(actual.rows[0].revenue),0);
  assert.equal(Number(actual.rows[0].units),0);
  assert.equal(Number(actual.rows[0].receivables),0);
  assert.equal(actual.rows[0].verified,true);
});

test("compare-only recovery returns canonical evidence without creating a restore path",async(t)=>{
  const database=await db();t.after(()=>database.close());
  await saveOrder(database,{units:1,reason:"compare baseline"});
  await database.query(
    `insert into epr_production_job_cards(
      id,sales_order_id,product_id,product_label,units,bom_tier,due_month,status,
      production_owner,created_by,sales_order_revision,updated_by
    ) values(
      'JC-REC-COMPARE','REC-SO-1','aluminium','Compare-only job card',1,'core',6,'released',
      'operations','ADMIN-MAKER',1,'ADMIN-MAKER'
    )`,
  );
  const rows=await database.query(
    `select vyndi_recovery_compare_snapshot('production_job_card','JC-REC-COMPARE') as snapshot`,
  );
  assert.equal(rows.rows[0].snapshot.id,"JC-REC-COMPARE");
  assert.equal(rows.rows[0].snapshot.status,"released");
  assert.equal(rows.rows[0].snapshot.sales_order_id,"REC-SO-1");

  await assert.rejects(
    ()=>database.query(`select vyndi_recovery_compare_snapshot('unsupported','X')`),
    /Unsupported compare-only recovery entity type/i,
  );
});

test("external-backup selective recovery requires registered checkpoint evidence",async(t)=>{
  const database=await db();t.after(()=>database.close());
  await saveOrder(database,{units:1});
  await assert.rejects(
    ()=>database.query(
      `select request_vyndi_selective_recovery(
        'REC-EXT-FAIL','sales_order','REC-SO-1','external_backup',null,$1::jsonb,null,
        'Recover from external backup','EXT-EVID','ADMIN-MAKER','admin'
      )`,
      [JSON.stringify({id:"REC-SO-1",month:6,product:"aluminium",units:1,aspLakh:1.5,channel:"direct",status:"confirmed",modelTier:"core",variantId:"core-tiagra",variantName:"VYNDI Longitude Tiagra",configuration:{groupset:"gs-tiagra-4700"}})],
    ),
    /registered checkpoint/i,
  );
});

test("full restore is new-target, maker/checker, evidence-gated and cutover-recorded",async(t)=>{
  const database=await db();t.after(()=>database.close());
  await database.query(
    `select register_vyndi_recovery_checkpoint(
      'BKP-1','pg_dump',now(),'3ecf954443fdc2a6f879c07af87ca355b666f09c',
      'backup-log-1','local-drive/vyndi.dump','sha256-test',1000,'test','ADMIN-MAKER','admin'
    )`,
  );
  await database.query(
    `select request_vyndi_full_restore(
      'DR-1','BKP-1','Database-loss recovery drill','INC-DR-1','ADMIN-MAKER','admin'
    )`,
  );
  await assert.rejects(
    ()=>database.query(`select decide_vyndi_recovery_request('DR-1','approve','','ADMIN-MAKER','admin')`),
    /different administrator|maker\/checker/i,
  );
  await database.query(`select decide_vyndi_recovery_request('DR-1','approve','approved','ADMIN-CHECKER','admin')`);

  await assert.rejects(
    ()=>database.query(
      `select validate_vyndi_full_restore('DR-1',$1::jsonb,'VAL-FAIL','ADMIN-CHECKER','admin')`,
      [JSON.stringify({hashMatch:true,databaseHealth:true,goldenOrder:false,authenticatedSmoke:true})],
    ),
    /requires hash match, database health, Golden Order and authenticated smoke/i,
  );

  await database.query(
    `select validate_vyndi_full_restore('DR-1',$1::jsonb,'VAL-PASS','ADMIN-CHECKER','admin')`,
    [JSON.stringify({
      hashMatch:true,databaseHealth:true,goldenOrder:true,authenticatedSmoke:true,
      restoredSourceSha:"3ecf954443fdc2a6f879c07af87ca355b666f09c",restoredTargetReference:"restore-branch-1",
    })],
  );
  let row=await database.query(`select status,validated_by from vyndi_recovery_requests where id='DR-1'`);
  assert.deepEqual(row.rows[0],{status:"cutover_ready",validated_by:"ADMIN-CHECKER"});

  await database.query(
    `select record_vyndi_full_restore_cutover('DR-1','CHANGE-CUTOVER-1','ADMIN-CHECKER','admin')`,
  );
  row=await database.query(`select status,executed_by,cutover_reference from vyndi_recovery_requests where id='DR-1'`);
  assert.deepEqual(row.rows[0],{status:"executed",executed_by:"ADMIN-CHECKER",cutover_reference:"CHANGE-CUTOVER-1"});
});

test("recovery evidence is append-only and UI preserves the canonical authority boundary",async(t)=>{
  const database=await db();t.after(()=>database.close());
  await database.query(
    `select register_vyndi_recovery_checkpoint(
      'BKP-EVT','neon_branch',now(),'sha','branch-evidence','branch-ref','','0','event test','ADMIN-MAKER','admin'
    )`,
  );
  await assert.rejects(
    ()=>database.query(`delete from vyndi_recovery_events where checkpoint_id='BKP-EVT'`),
    /append-only/i,
  );

  const [migration,authority,route,workflow,metadata]=await Promise.all([
    readFile(join(root,"migrations/0089_admin_recovery_centre.sql"),"utf8"),
    readFile(join(root,"src/lib/recovery-control.ts"),"utf8"),
    readFile(join(root,"src/routes/command/recovery.tsx"),"utf8"),
    readFile(join(root,"src/lib/operating-workflow.ts"),"utf8"),
    readFile(join(root,"src/lib/page-metadata.ts"),"utf8"),
  ]);
  assert.match(migration,/save_vyndi_sales_order/);
  assert.match(migration,/save_vyndi_monthly_actual/);
  assert.match(migration,/vyndi_shipments/);
  assert.match(migration,/vyndi_invoices/);
  assert.match(migration,/vyndi_purchase_orders/);
  assert.match(migration,/status in \('in_progress','complete'\)/);
  assert.match(migration,/blocked after dispatch or invoice evidence/i);
  assert.match(migration,/invalid status/i);
  assert.doesNotMatch(migration,/update\s+vyndi_sales_orders/i);
  assert.doesNotMatch(migration,/delete\s+from\s+vyndi_sales_orders/i);
  assert.doesNotMatch(migration,/insert\s+into\s+epr_inventory_ledger/i);
  assert.doesNotMatch(migration,/insert\s+into\s+epr_finance_journal/i);
  assert.match(authority,/role\s*!==\s*"admin"/);
  assert.match(authority,/runtimeSourceSha/);
  assert.match(authority,/externalBackupState/);
  assert.match(authority,/purchase_order/);
  assert.match(authority,/compare_only/);
  assert.match(authority,/previewVindyCompareOnlyRecovery/);
  assert.match(migration,/vyndi_recovery_compare_snapshot/);
  assert.match(migration,/production_job_card/);
  assert.match(migration,/inventory_identity/);
  assert.match(route,/Production rows are never blindly overwritten/);
  assert.match(route,/Load \/ compare evidence/);
  assert.match(route,/never exposes an Execute Restore button/);
  assert.match(route,/COMPARE \/ CORRECTIVE/);
  assert.match(route,/No pg_dump evidence registered/);
  assert.match(workflow,/\/command\/recovery/);
  assert.match(metadata,/["']\/command\/recovery["'][\s\S]{0,300}adminOnly: true/);
});
