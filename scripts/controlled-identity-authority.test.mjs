import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { pendingMigrations } from "./migration-plan.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(here, "..", "migrations");

async function migrateEmptyDatabase(db) {
  await db.exec(
    "create table _migrations (name text primary key, applied_at timestamptz not null default now())",
  );
  const entries = await readdir(migrationsDir, { withFileTypes: true });
  const files = entries.filter((entry) => entry.isFile()).map((entry) => entry.name);
  for (const { name, path } of pendingMigrations(files, [])) {
    const sql = await readFile(join(migrationsDir, path), "utf8");
    await db.transaction(async (tx) => {
      await tx.exec(sql);
      await tx.query("insert into _migrations (name) values ($1)", [name]);
    });
  }
}

test("DOC 04 Rev 1.2 blocks example launch codes, then issues deterministic governed identities", async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.waitReady;
  await migrateEmptyDatabase(db);

  const authority = await db.query(
    `select family_code,model_code,configured_launch_code,launch_code_confirmed,issuance_status
       from vyndi_model_identity_authority order by family_code`,
  );
  assert.equal(authority.rows.length, 3);
  assert.ok(authority.rows.every((row) => row.launch_code_confirmed === false));
  assert.ok(
    authority.rows.every(
      (row) => row.issuance_status === "BLOCKED_AWAITING_OFFICIAL_LAUNCH_MMYY",
    ),
  );

  await assert.rejects(
    db.query(`select generate_vyndi_finished_product_serial('core')`),
    /No authorised launch MMYY exists/,
  );

  const configured = await db.query(
    `select * from configure_vyndi_model_launch($1,$2,$3,$4,$5)`,
    ["longitude", 10, 2026, "identity-test-approver", "admin"],
  );
  assert.equal(configured.rows[0].model_code, "LON");
  assert.equal(configured.rows[0].launch_code, "1026");

  const first = await db.query(
    `select generate_vyndi_finished_product_serial('core') as serial_number`,
  );
  const second = await db.query(
    `select generate_vyndi_finished_product_serial('longitude') as serial_number`,
  );
  assert.equal(first.rows[0].serial_number, "LON-1026-0001");
  assert.equal(second.rows[0].serial_number, "LON-1026-0002");

  const component = await db.query(
    `select generate_vyndi_component_serial($1,$2,$3,$4,$5,$6,$7) as serial_number`,
    ["HBR", "400", 10, 2026, "VY-HBR-400-001", "R02", "identity-test-user"],
  );
  assert.equal(component.rows[0].serial_number, "HBR-400-1026-0001");

  const equipment = await db.query(
    `select generate_vyndi_internal_reference('EQP') as internal_reference`,
  );
  const spare = await db.query(
    `select generate_vyndi_internal_reference('SPR') as internal_reference`,
  );
  assert.equal(equipment.rows[0].internal_reference, "EQP-000001");
  assert.equal(spare.rows[0].internal_reference, "SPR-000001");

  const registry = await db.query(
    `select visible_id,identity_kind,traceability_class,legacy_format
       from vyndi_identity_registry
      where visible_id in ('LON-1026-0001','LON-1026-0002','HBR-400-1026-0001')
      order by visible_id`,
  );
  assert.equal(registry.rows.length, 3);
  assert.ok(registry.rows.every((row) => row.traceability_class === "A"));
  assert.ok(registry.rows.every((row) => row.legacy_format === false));

  await assert.rejects(
    db.query(`select * from configure_vyndi_model_launch($1,$2,$3,$4,$5)`, [
      "longitude",
      11,
      2026,
      "identity-test-approver",
      "admin",
    ]),
    /Launch code for longitude is frozen/,
  );
});
