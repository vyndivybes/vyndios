import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { pendingMigrations } from "./migration-plan.mjs";
import { compareRecoveryQualificationSnapshots } from "./recovery-qualification-manifest.mjs";

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

const H="a".repeat(64);
const H2="b".repeat(64);

test("recovery snapshot comparison detects department configuration and attachment drift independently",()=>{
  const make=(overrides={})=>({
    hash:H,count:1,bytes:0,records:[],...overrides,
  });
  const source={
    scopes:{
      commercial:make(),finance:make(),peopleOffice:make(),quality:make(),
      configuration:make(),attachments:make({bytes:27}),audit:make(),
    },
  };
  const restored=structuredClone(source);
  let comparison=compareRecoveryQualificationSnapshots(source,restored);
  assert.equal(comparison.allMatched,true);
  assert.equal(comparison.multiDepartmentRestore,true);
  assert.equal(comparison.configurationHashMatch,true);
  assert.equal(comparison.attachmentBytesMatch,true);

  restored.scopes.attachments.bytes=26;
  comparison=compareRecoveryQualificationSnapshots(source,restored);
  assert.equal(comparison.allMatched,false);
  assert.equal(comparison.attachmentBytesMatch,false);
});

test("full restore validation requires current matched multi-department configuration and attachment evidence",async(t)=>{
  const db=await canonicalDb();
  t.after(()=>db.close());

  await db.query(
    "select register_vyndi_recovery_checkpoint($1,$2,$3::timestamptz,$4,$5,$6,$7,$8,$9,$10,$11)",
    ["H2-CP","pg_dump","2026-10-07T00:00:00Z","source-sha","TEST:CP","backup.dump",H,1024,"fixture","maker-admin","admin"],
  );
  await db.query(
    "select request_vyndi_full_restore($1,$2,$3,$4,$5,$6)",
    ["H2-RESTORE","H2-CP","Expanded H2 recovery qualification","TEST:RESTORE","maker-admin","admin"],
  );
  await db.query(
    "select decide_vyndi_recovery_request($1,$2,$3,$4,$5)",
    ["H2-RESTORE","approve","approved for isolated restore","checker-admin","admin"],
  );

  async function evidence(id,kind,scope,sourceHash=H,restoredHash=H,sourceBytes=null,restoredBytes=null){
    return db.query(
      "select * from register_vyndi_recovery_qualification_evidence($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)",
      [id,"H2-RESTORE",kind,scope,sourceHash,restoredHash,1,1,sourceBytes,restoredBytes,
       "TEST:SOURCE","TEST:EVIDENCE","checker-admin","admin"],
    );
  }

  await evidence("Q-COM","department","commercial");
  await evidence("Q-FIN","department","finance");
  await evidence("Q-PEO","department","peopleOffice");
  await evidence("Q-CONF","configuration","configured-order");
  await evidence("Q-ATT-BAD","attachment","expense-evidence",H,H2,27,26);

  const validation=JSON.stringify({
    hashMatch:true,databaseHealth:true,goldenOrder:true,authenticatedSmoke:true,
    restoredSourceSha:"abcdef1234567",restoredTargetReference:"isolated-restore",
  });

  await assert.rejects(
    db.query("select validate_vyndi_full_restore($1,$2::jsonb,$3,$4,$5)",["H2-RESTORE",validation,"TEST:VALIDATE","checker-admin","admin"]),
    /mismatched recovery evidence/i,
  );

  const corrected=await evidence("Q-ATT-GOOD","attachment","expense-evidence",H,H,27,27);
  assert.equal(corrected.rows[0].matched,true);
  assert.equal(Number(corrected.rows[0].evidence_revision),2);

  await assert.rejects(
    db.query("select validate_vyndi_full_restore($1,$2::jsonb,$3,$4,$5)",["H2-RESTORE",validation,"TEST:VALIDATE","checker-admin","admin"]),
    /at least four department recovery scopes/i,
  );

  await evidence("Q-QUAL","department","quality");
  const ready=await db.query(
    "select validate_vyndi_full_restore($1,$2::jsonb,$3,$4,$5)",
    ["H2-RESTORE",validation,"TEST:VALIDATE","checker-admin","admin"],
  );
  assert.equal(ready.rows[0].validate_vyndi_full_restore,"cutover_ready");

  const summary=await db.query("select * from vyndi_recovery_qualification_summary where request_id='H2-RESTORE'");
  assert.equal(Number(summary.rows[0].matched_department_count),4);
  assert.equal(Number(summary.rows[0].configuration_match_count),1);
  assert.equal(Number(summary.rows[0].attachment_match_count),1);
  assert.equal(Number(summary.rows[0].mismatch_count),0);
  assert.equal(Number(summary.rows[0].source_attachment_bytes),27);
  assert.equal(Number(summary.rows[0].restored_attachment_bytes),27);

  const request=await db.query("select validation_evidence from vyndi_recovery_requests where id='H2-RESTORE'");
  assert.equal(request.rows[0].validation_evidence.multiDepartmentRestore,true);
  assert.equal(request.rows[0].validation_evidence.configurationHashMatch,true);
  assert.equal(request.rows[0].validation_evidence.attachmentHashMatch,true);

  await assert.rejects(
    db.query("update vyndi_recovery_qualification_evidence set matched=false where id='Q-COM'"),
    /append-only/i,
  );
});
