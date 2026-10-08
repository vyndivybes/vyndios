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

test("Stage-4 People master write is draft-only, revision-guarded, idempotent and evidenced",async(t)=>{
  const db=await canonicalDb();
  t.after(()=>db.close());

  await db.exec(`
    insert into vyndi_people_records(
      id,display_name,function_name,role_title,engagement_type,lifecycle_status,
      start_month,end_month,source_ref,notes,created_by,record_revision,operational_status
    ) values(
      'role-stage4','Stage 4 Planned Role','Operations','Planned Role','planned_role','draft',
      12,null,'TEST:BASE','before','seed',1,'planned'
    );
  `);

  const args=[
    'job-stage4-1','intent-stage4-1','approval-stage4-1','stage4-idem-0001',
    'a'.repeat(64),'b'.repeat(64),'PEOPLE_DRAFT_MASTER_V1','role-stage4',1,
    'Stage 4 Planned Role','Operations','Planned Role','planned_role',12,null,
    'VAOS|intent-stage4-1|job-stage4-1','after'
  ];

  const first=await db.query(
    `select execute_vaos_people_master_draft_change(
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17
    ) as result`,args
  );
  assert.equal(first.rows[0].result.outcome,'EXECUTED');
  assert.equal(first.rows[0].result.finalState,'draft');
  assert.equal(first.rows[0].result.initialRevision,1);
  assert.equal(first.rows[0].result.finalRevision,2);
  assert.equal(first.rows[0].result.replay,false);

  const persisted=await db.query(
    `select lifecycle_status,record_revision,notes from vyndi_people_records where id='role-stage4'`
  );
  assert.equal(persisted.rows[0].lifecycle_status,'draft');
  assert.equal(Number(persisted.rows[0].record_revision),2);
  assert.equal(persisted.rows[0].notes,'after');

  const replay=await db.query(
    `select execute_vaos_people_master_draft_change(
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17
    ) as result`,args
  );
  assert.equal(replay.rows[0].result.replay,true);
  assert.equal(replay.rows[0].result.finalRevision,2);

  await assert.rejects(
    db.query(
      `select execute_vaos_people_master_draft_change(
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17
      )`,
      ['job-stage4-2','intent-stage4-2','approval-stage4-2','stage4-idem-0002',
       'a'.repeat(64),'b'.repeat(64),'PEOPLE_DRAFT_MASTER_V1','role-stage4',1,
       'Changed','Operations','Planned Role','planned_role',12,null,
       'VAOS|intent-stage4-2|job-stage4-2','stale']
    ),
    /Stale People record revision/,
  );

  const evidence=await db.query(
    `select outcome,final_state,initial_revision,final_revision
       from vyndi_vaos_operational_writes where execution_job_id='job-stage4-1'`
  );
  assert.equal(evidence.rows[0].outcome,'EXECUTED');
  assert.equal(evidence.rows[0].final_state,'draft');
  assert.equal(Number(evidence.rows[0].initial_revision),1);
  assert.equal(Number(evidence.rows[0].final_revision),2);
});

test("VAOS bridge commissions write-execute only for People master draft change",async()=>{
  const route=await readFile(join(here,"..","src/routes/api/vaos/bridge.ts"),"utf8");
  assert.match(route,/PEOPLE\.CHANGE_EMPLOYEE_MASTER/);
  assert.match(route,/PEOPLE_DRAFT_MASTER_V1/);
  assert.match(route,/execute_vaos_people_master_draft_change/);
  assert.match(route,/purpose === "write-execute"/);
  assert.match(route,/operational_write_scope_denied/);
});
