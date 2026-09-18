import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import pg from "pg";

const mode = process.env.H2_MODE || "verify";

function hash(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

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
        JSON.stringify({groupset:"gs-tiagra-4700"}),
        "H2 recovery drill seed","h2-operator","operations",
      ],
    );
    await client.query(
      `select save_vyndi_monthly_actual($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [35,null,null,null,null,9.8765,null,null,null,"H2-RECOVERY-CASH",true,"h2-cash-controller","finance"],
    );
    const order = await client.query("select id,revision,status,units,asp_lakh from vyndi_sales_orders where id='H2-SO-BASE'");
    const actual = await client.query("select plan_month,revision,closing_cash,verified,source_reference from vyndi_monthly_actuals where plan_month=35");
    assert.equal(order.rows.length,1);
    assert.equal(actual.rows.length,1);
    console.log("[h2-recovery] source seed ready");
  } finally {
    await client.end();
  }
}

async function snapshot(client) {
  const [migrationRows, orderRows, revisionRows, actualRows, auditRows] = await Promise.all([
    client.query("select name from _migrations order by name"),
    client.query("select id,revision,plan_month,product_id,units,asp_lakh,channel,status,model_tier,variant_id,variant_name,configuration,created_by,updated_by from vyndi_sales_orders where id='H2-SO-BASE'"),
    client.query("select id,sales_order_id,revision,snapshot,change_reason,actor_user_id,actor_role from vyndi_sales_order_revisions where sales_order_id='H2-SO-BASE' order by revision"),
    client.query("select plan_month,revision,revenue,units,cogs,opex,closing_cash,inventory,receivables,payables,source_reference,verified,updated_by from vyndi_monthly_actuals where plan_month=35"),
    client.query("select id,entity_type,entity_id,entity_revision,action,actor_user_id,actor_role,source_reference,payload_json from vyndi_audit_events where entity_id='H2-SO-BASE' or actor_user_id in ('h2-operator','h2-cash-controller') order by id"),
  ]);
  const critical = {
    migrations:migrationRows.rows,
    order:orderRows.rows,
    orderRevisions:revisionRows.rows,
    actual:actualRows.rows,
    audits:auditRows.rows,
  };
  return {
    migrationCount:migrationRows.rows.length,
    critical,
    hash:hash(critical),
  };
}

async function verify() {
  const source = await connect(process.env.H2_SOURCE_DATABASE_URL);
  const restored = await connect(process.env.H2_RESTORED_DATABASE_URL);
  try {
    const [sourceSnapshot, restoredSnapshot] = await Promise.all([snapshot(source),snapshot(restored)]);
    assert.equal(restoredSnapshot.hash,sourceSnapshot.hash,"Restored critical business/audit snapshot differs from source.");
    assert.equal(restoredSnapshot.migrationCount,sourceSnapshot.migrationCount,"Migration history changed during restore.");

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
      backupFormat:"PostgreSQL custom format",
      backupBytes:Number(process.env.H2_BACKUP_BYTES || 0),
      backupSeconds:Number(process.env.H2_BACKUP_SECONDS || 0),
      restoreSeconds:Number(process.env.H2_RESTORE_SECONDS || 0),
      rpoTargetHours:24,
      rtoTargetMinutes:60,
      lineageVerified:true,
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
