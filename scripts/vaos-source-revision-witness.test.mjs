import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const watched = [
  "epr_inventory_ledger",
  "epr_inventory_cost_ledger",
  "epr_inventory_reservations",
  "epr_production_job_card_lines",
  "epr_production_job_cards",
  "vyndi_purchase_orders",
  "vyndi_sales_orders",
];

test("A01 forward-only source witness serializes committed change events and rolls back with source data", async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.waitReady;
  // DDL-only, isolated PGlite fixture. Absolutely no enterprise data.
  for (const table of watched) await db.exec(`CREATE TABLE public.${table}(id text PRIMARY KEY)`);
  const migration = await readFile(
    join(root, "migrations", "0196_vaos_source_revision_witness.sql"), "utf8",
  );
  await db.exec(migration);
  const read = async () => {
    const { rows } = await db.query(
      "SELECT source_key, generation_id, revision, seeded_at FROM vyndi_vaos_authority.source_revision WHERE source_key='A01_ONTOLOGY_V1'",
    );
    assert.equal(rows.length, 1);
    return { ...rows[0], revision: BigInt(rows[0].revision) };
  };
  const initial = await read();
  assert.equal(initial.revision, 0n);
  assert.ok(initial.generation_id);
  assert.ok(initial.seeded_at);

  await t.test("all seven contributing source tables have ALWAYS-enabled statement hooks", async () => {
    const { rows } = await db.query(
      "SELECT c.relname, t.tgenabled, (t.tgtype::int & 1)=0 AS statement_level FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND t.tgname='trg_vyndi_a01_source_revision' ORDER BY c.relname",
    );
    assert.deepEqual(rows.map((r) => r.relname), [...watched].sort());
    assert.ok(rows.every((r) => r.tgenabled === "A" && r.statement_level === true));
  });

  await t.test("committed source DML advances the same generation monotonically", async () => {
    await db.exec("INSERT INTO public.vyndi_purchase_orders(id) VALUES ('PO-A')");
    assert.equal((await read()).revision, 1n);
    await db.exec("UPDATE public.vyndi_purchase_orders SET id='PO-B' WHERE id='PO-A'");
    assert.equal((await read()).revision, 2n);
    await db.exec("DELETE FROM public.vyndi_purchase_orders WHERE id='PO-B'");
    assert.equal((await read()).revision, 3n);
    await db.exec("TRUNCATE public.vyndi_purchase_orders");
    assert.equal((await read()).revision, 4n);
    assert.equal((await read()).generation_id, initial.generation_id);
  });

  await t.test("a rolled-back source write cannot advance the committed witness", async () => {
    const before = await read();
    await assert.rejects(
      db.transaction(async (tx) => {
        await tx.exec("INSERT INTO public.epr_inventory_reservations(id) VALUES ('R-ABORT')");
        throw new Error("intentional rollback");
      }),
      /intentional rollback/,
    );
    const after = await read();
    assert.equal(after.revision, before.revision);
    assert.equal((await db.query("SELECT count(*)::int AS n FROM public.epr_inventory_reservations")).rows[0].n, 0);
  });

  await t.test("multi-table committed transaction is visible with a single updated witness", async () => {
    const before = await read();
    await db.transaction(async (tx) => {
      await tx.exec("INSERT INTO public.epr_inventory_ledger(id) VALUES ('INV-A')");
      await tx.exec("INSERT INTO public.epr_inventory_cost_ledger(id) VALUES ('COST-A')");
      await tx.exec("INSERT INTO public.epr_production_job_card_lines(id) VALUES ('LINE-A')");
    });
    const after = await read();
    assert.equal(after.revision, before.revision + 3n);
    assert.equal(after.generation_id, before.generation_id);
  });

  await t.test("rollback cannot leave an orphaned revision increment", async () => {
    const before = await read();
    await assert.rejects(db.transaction(async (tx) => {
      await tx.exec("INSERT INTO public.vyndi_sales_orders(id) VALUES ('SO-A')");
      await tx.exec("INSERT INTO public.epr_production_job_cards(id) VALUES ('JOB-A')");
      throw Error("intentional rollback");
    }), /intentional rollback/);
    assert.equal((await read()).revision, before.revision);
  });
});

test("A01 migration is a forward-only witness, not a source certification or business data migration", async () => {
  const migration = await readFile(
    join(root, "migrations", "0196_vaos_source_revision_witness.sql"), "utf8",
  );
  assert.match(migration, /SECURITY DEFINER/i);
  assert.match(migration, /ENABLE ALWAYS TRIGGER/i);
  assert.match(migration, /REVOKE ALL ON SCHEMA vyndi_vaos_authority FROM PUBLIC/i);
  assert.doesNotMatch(migration, /\b(?:DROP TABLE|DELETE FROM public|UPDATE public|INSERT INTO public|TRUNCATE public)\b/i);
  assert.match(migration, /generation_id uuid/i);
  const receipt = await readFile(join(root, "src/lib/vaos-ontology-read-receipt.ts"), "utf8");
  assert.match(receipt, /CONTENT_DIGEST_ONLY/);
  assert.match(receipt, /sourceCompletenessVerified:false/);
  assert.match(receipt, /productionWriteAuthorized:false/);
});
