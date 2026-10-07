import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import pg from "pg";
import {
  captureRecoveryQualificationSnapshot,
  compareRecoveryQualificationSnapshots,
} from "./recovery-qualification-manifest.mjs";

const mode = process.env.H2_MODE || "verify";

async function connect(url) {
  if (!url) throw new Error("Database URL is required for H2 recovery drill.");
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  return client;
}

async function seed() {
  const client = await connect(process.env.DATABASE_URL);
  try {
    await client.query(
      `select * from save_vyndi_sales_order(
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13,$14
      )`,
      [
        "H2-SO-BASE",35,"aluminium",2,1.25,"direct","confirmed",
        "core","core-tiagra","VINDY Longitude Tiagra",
        JSON.stringify({groupset:"gs-tiagra-4700",frameSize:"M",finish:"recovery-blue"}),
        "H2 recovery drill seed","h2-operator","operations",
      ],
    );

    await client.query(
      `select save_vyndi_monthly_actual($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [35,null,null,null,null,9.8765,null,null,null,"H2-RECOVERY-CASH",true,"h2-cash-controller","finance"],
    );

    await client.query(
      `insert into vyndi_people_records(
        id,display_name,function_name,role_title,engagement_type,lifecycle_status,start_month,
        source_ref,notes,created_by,approved_by,operational_status,record_revision
      ) values (
        'H2-PERSON','H2 Recovery Person','Operations','Recovery Engineer','employee','approved',1,
        'H2:PEOPLE','Recovery qualification fixture','h2-people','h2-people','active',1
      ) on conflict(id) do nothing`,
    );
    await client.query(
      `insert into vyndi_people_attendance_ledger(
        id,person_id,work_date,revision,attendance_status,worked_hours,overtime_hours,notes,
        source_ref,evidence_ref,recorded_by,recorded_role
      ) values (
        'H2-ATT','H2-PERSON','2026-10-01',1,'present',8,1,'Recovery fixture',
        'H2:ATTENDANCE','EVID:H2:ATTENDANCE','h2-people','management'
      ) on conflict(id) do nothing`,
    );
    await client.query(
      `insert into vyndi_people_leave_ledger(
        id,person_id,leave_type,transaction_type,direction,quantity_days,effective_on,related_reference,notes,
        source_ref,evidence_ref,recorded_by,recorded_role
      ) values (
        'H2-LEAVE','H2-PERSON','annual','entitlement','credit',20,'2026-01-01','H2-ENT-2026','Recovery fixture',
        'H2:LEAVE','EVID:H2:LEAVE','h2-people','management'
      ) on conflict(id) do nothing`,
    );

    await client.query(
      `insert into vyndi_people_office_cost_items(
        id,cost_group,person_id,name,stage,quantity,monthly_unit_cost_lakh,start_month,end_month,
        one_time_cost_lakh,one_time_month,lifecycle_status,record_revision,source_ref,notes,created_by,approved_by
      ) values (
        'H2-COST','office','H2-PERSON','H2 Recovery Office Cost','Recovery',1,0.01,1,36,
        0,1,'approved',1,'H2:COST','Recovery fixture','h2-people','h2-people'
      ) on conflict(id) do nothing`,
    );
    await client.query(
      `insert into vyndi_people_office_actual_expenditures(
        id,source_type,source_id,source_label,source_category,plan_month,incurred_on,description,amount_inr,
        debit_account_code,liability_account_code,lifecycle_status,source_reference,notes,created_by,approved_by,approved_at
      ) values (
        'H2-EXPENSE','cost_item','H2-COST','H2 Recovery Office Cost','office',35,'2026-10-01',
        'Recovery evidence fixture',1250,'6200','2000','approved','H2:EXPENSE','Recovery fixture',
        'h2-people','h2-people',now()
      ) on conflict(id) do nothing`,
    );

    const attachmentBytes=Buffer.from("VYNDI-H2-RECOVERY-EVIDENCE\n","utf8");
    const attachmentSha=createHash("sha256").update(attachmentBytes).digest("hex");
    await client.query(
      `insert into vyndi_expense_evidence_attachments(
        id,expenditure_id,document_type,file_name,mime_type,file_size_bytes,sha256_hex,content_bytes,uploaded_by,uploaded_role
      ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      on conflict(id) do nothing`,
      ["H2-ATTACHMENT","H2-EXPENSE","receipt","h2-recovery-evidence.png","image/png",
       attachmentBytes.length,attachmentSha,attachmentBytes,"h2-people","management"],
    );

    await client.query(
      `insert into vyndi_quality_inspections(
        id,inspection_stage,inspection_type,sales_order_id,sku,sample_size,defect_quantity,result,disposition,
        criteria_ref,evidence_ref,notes,recorded_by,recorded_role
      ) values (
        'H2-Q-INCOMING','incoming','recovery fixture incoming','H2-SO-BASE','H2-SKU',1,0,'pass','accepted',
        'H2-QC-CRITERIA','EVID:H2:QUALITY','Recovery fixture','h2-quality','quality'
      ) on conflict(id) do nothing`,
    );

    const seeded=await captureRecoveryQualificationSnapshot(client);
    assert.equal(seeded.scopes.commercial.count>0,true);
    assert.equal(seeded.scopes.finance.count>0,true);
    assert.equal(seeded.scopes.peopleOffice.count>0,true);
    assert.equal(seeded.scopes.quality.count>0,true);
    assert.equal(seeded.scopes.configuration.count>0,true);
    assert.equal(seeded.scopes.attachments.count,1);
    console.log("[h2-recovery] multi-department source seed ready");
  } finally {
    await client.end();
  }
}

async function verify() {
  const source = await connect(process.env.H2_SOURCE_DATABASE_URL);
  const restored = await connect(process.env.H2_RESTORED_DATABASE_URL);
  try {
    const [sourceSnapshot, restoredSnapshot] = await Promise.all([
      captureRecoveryQualificationSnapshot(source),
      captureRecoveryQualificationSnapshot(restored),
    ]);
    const comparison=compareRecoveryQualificationSnapshots(sourceSnapshot,restoredSnapshot);

    assert.equal(restoredSnapshot.hash,sourceSnapshot.hash,"Restored multi-department recovery manifest differs from source.");
    assert.equal(restoredSnapshot.migrationCount,sourceSnapshot.migrationCount,"Migration history changed during restore.");
    assert.equal(restoredSnapshot.migrationHash,sourceSnapshot.migrationHash,"Migration manifest hash changed during restore.");
    assert.equal(comparison.allMatched,true,"One or more recovery qualification scopes differ from source.");
    assert.equal(comparison.multiDepartmentRestore,true,"Commercial, Finance, People & Office and Quality must all match.");
    assert.equal(comparison.configurationHashMatch,true,"Configured-product recovery hash differs from source.");
    assert.equal(comparison.attachmentHashMatch,true,"Attachment recovery hash differs from source.");
    assert.equal(comparison.attachmentBytesMatch,true,"Attachment byte count differs from source.");

    const postRestore = await restored.query(
      `select * from save_vyndi_sales_order(
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13,$14
      )`,
      [
        "H2-SO-POST-RESTORE",36,"carbon",1,2.25,"direct","confirmed",
        "pro","pro-105","VINDY Latitude 105",
        JSON.stringify({groupset:"gs-105"}),
        "H2 post-restore governed write","h2-recovery-operator","operations",
      ],
    );
    assert.equal(postRestore.rows[0]?.sales_order_id,"H2-SO-POST-RESTORE");
    assert.equal(Number(postRestore.rows[0]?.revision),1);

    const postAudit=await restored.query(
      "select count(*)::int as count from vyndi_audit_events where entity_type='sales_order' and entity_id='H2-SO-POST-RESTORE' and action='created'",
    );
    assert.equal(Number(postAudit.rows[0]?.count),1,"Post-restore governed transaction did not preserve audit lineage.");

    const evidence={
      test:"VYNDI H2 backup / restore / recovery drill",
      sourceSnapshotHash:sourceSnapshot.hash,
      restoredSnapshotHash:restoredSnapshot.hash,
      migrationCount:restoredSnapshot.migrationCount,
      migrationHash:restoredSnapshot.migrationHash,
      domainHashes:restoredSnapshot.domainHashes,
      scopeCounts:Object.fromEntries(Object.entries(restoredSnapshot.scopes).map(([name,value])=>[name,value.count])),
      attachmentBytes:restoredSnapshot.scopes.attachments.bytes,
      backupFormat:"PostgreSQL custom format",
      backupBytes:Number(process.env.H2_BACKUP_BYTES || 0),
      backupSeconds:Number(process.env.H2_BACKUP_SECONDS || 0),
      restoreSeconds:Number(process.env.H2_RESTORE_SECONDS || 0),
      rpoTargetHours:24,
      rtoTargetMinutes:60,
      lineageVerified:true,
      multiDepartmentRestore:true,
      configurationHashMatch:true,
      attachmentHashMatch:true,
      attachmentBytesMatch:true,
      postRestoreGovernedWrite:true,
      completedAt:new Date().toISOString(),
      result:"PASS",
    };
    const path=resolve(process.env.H2_EVIDENCE_PATH || ".grok/evidence/h2-recovery/evidence.json");
    await mkdir(dirname(path),{recursive:true});
    await writeFile(path,`${JSON.stringify(evidence,null,2)}\n`,"utf8");
    console.log(JSON.stringify({event:"vyndi.h2.recovery.evidence",...evidence},null,2));
  } finally {
    await source.end();
    await restored.end();
  }
}

if(mode==="seed") await seed();
else if(mode==="verify") await verify();
else throw new Error(`Unsupported H2_MODE: ${mode}`);
