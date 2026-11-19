import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import pg from "pg";

const { Client } = pg;
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dsn = process.env.A01_TEST_DATABASE_URL;
assert.ok(dsn, "A01_TEST_DATABASE_URL is required: run only against a disposable local PostgreSQL test service");
const target = new URL(dsn);
assert.ok(["localhost", "127.0.0.1", "::1"].includes(target.hostname), "A01 test refuses all non-loopback database targets");
assert.equal(target.pathname, "/a01_test", "A01 tests require the dedicated a01_test database");

const watched = [
  "epr_inventory_ledger", "epr_inventory_cost_ledger",
  "epr_inventory_reservations", "epr_production_job_card_lines",
  "epr_production_job_cards", "vyndi_purchase_orders", "vyndi_sales_orders",
];
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test("PostgreSQL A01 transaction-order, lock, rollback and RLS acceptance", { timeout: 30_000 }, async (t) => {
  const control = new Client({ connectionString: dsn, connectionTimeoutMillis: 3_000, statement_timeout: 8_000 });
  const writerA = new Client({ connectionString: dsn, connectionTimeoutMillis: 3_000, statement_timeout: 8_000 });
  const writerB = new Client({ connectionString: dsn, connectionTimeoutMillis: 3_000, statement_timeout: 8_000 });
  await Promise.all([control.connect(), writerA.connect(), writerB.connect()]);
  t.after(async () => {
    await Promise.allSettled([writerA.query("ROLLBACK"), writerB.query("ROLLBACK")]);
    await Promise.allSettled([writerB.end(), writerA.end(), control.end()]);
  });

  // No enterprise/production rows: this database is created by a disposable
  // PostgreSQL service in the PR test job. Guard URL before any SQL.
  for (const table of watched) {
    await control.query(`CREATE TABLE public.${table}(id text PRIMARY KEY)`);
  }
  const migration = await readFile(join(root, "migrations/0196_vaos_source_revision_witness.sql"), "utf8");
  await control.query(migration);
  const version = async () => {
    const { rows } = await control.query(
      "SELECT generation_id, revision::text AS revision FROM vyndi_vaos_authority.source_revision WHERE source_key='A01_ONTOLOGY_V1'",
    );
    assert.equal(rows.length, 1);
    return { generation: rows[0].generation_id, revision: BigInt(rows[0].revision) };
  };

  const first = await version();
  assert.equal(first.revision, 0n);
  await t.test("all watched relations have ALWAYS statement hooks", async () => {
    const { rows } = await control.query(
      "SELECT c.relname AS name, t.tgenabled AS enabled, (t.tgtype::int & 1)=0 AS statement_level FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND t.tgname='trg_vyndi_a01_source_revision' ORDER BY c.relname",
    );
    assert.deepEqual(rows.map((r) => r.name), [...watched].sort());
    assert.ok(rows.every((r) => r.enabled === "A" && r.statement_level), "EVERY table must run an ALWAYS statement trigger");
  });

  const waitForBlockedWriter = async () => {
    for (let attempt = 0; attempt < 60; attempt++) {
      const { rows } = await control.query("SELECT pg_blocking_pids($1::int) AS blockers", [writerB.processID]);
      if (rows[0].blockers.includes(writerA.processID)) return;
      await pause(50);
    }
    throw new Error("Second session did not wait on the transaction-coupled revision row lock");
  };
  await t.test("commit serialization: second writer cannot publish before first commit", async () => {
    await writerA.query("BEGIN");
    await writerA.query("INSERT INTO public.epr_inventory_ledger(id) VALUES ('INV-A')");
    await writerB.query("BEGIN");
    const blocked = writerB.query("INSERT INTO public.vyndi_purchase_orders(id) VALUES ('PO-B')");
    try {
      await waitForBlockedWriter();
      assert.equal((await version()).revision, 0n, "uncommitted changes must remain invisible");
      await writerA.query("COMMIT");
      assert.equal((await version()).revision, 1n);
      await blocked;
      await writerB.query("COMMIT");
      assert.equal((await version()).revision, 2n);
    } finally {
      await writerA.query("ROLLBACK").catch(() => {});
      await blocked.catch(() => {});
      await writerB.query("ROLLBACK").catch(() => {});
    }
  });

  await t.test("an aborted first writer cannot produce an orphaned committed revision", async () => {
    const before = await version();
    await writerA.query("BEGIN");
    await writerA.query("INSERT INTO public.epr_inventory_reservations(id) VALUES ('ABORTED')");
    await writerB.query("BEGIN");
    const blocked = writerB.query("INSERT INTO public.epr_production_job_card_lines(id) VALUES ('LINE-C')");
    try {
      await waitForBlockedWriter();
      await writerA.query("ROLLBACK");
      await blocked;
      await writerB.query("COMMIT");
      assert.equal((await version()).revision, before.revision + 1n);
      const { rows } = await control.query("SELECT count(*)::int AS n FROM public.epr_inventory_reservations");
      assert.equal(rows[0].n, 0);
    } finally {
      await writerA.query("ROLLBACK").catch(() => {});
      await blocked.catch(() => {});
      await writerB.query("ROLLBACK").catch(() => {});
    }
  });

  await t.test("lock timeout fails closed without partial business or revision commit", async () => {
    const before = await version();
    await writerA.query("BEGIN");
    await writerA.query("INSERT INTO public.epr_production_job_cards(id) VALUES ('JOB-D')");
    await writerB.query("BEGIN");
    await writerB.query("SET LOCAL lock_timeout = '125ms'");
    try {
      await assert.rejects(
        writerB.query("INSERT INTO public.vyndi_sales_orders(id) VALUES ('SO-TIMED-OUT')"),
        (err) => err?.code === "55P03",
      );
      await writerB.query("ROLLBACK");
      await writerA.query("COMMIT");
      assert.equal((await version()).revision, before.revision + 1n);
      const { rows } = await control.query("SELECT count(*)::int AS n FROM public.vyndi_sales_orders");
      assert.equal(rows[0].n, 0);
    } finally {
      await writerB.query("ROLLBACK").catch(() => {});
      await writerA.query("ROLLBACK").catch(() => {});
    }
  });

  await t.test("one repeatable-read snapshot preserves the matching rows and revision", async () => {
    const before = await version();
    await writerA.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const probe = "SELECT revision::text AS revision,(SELECT count(*)::int FROM public.epr_inventory_cost_ledger) AS rows FROM vyndi_vaos_authority.source_revision WHERE source_key='A01_ONTOLOGY_V1'";
    try {
      const { rows: startRows } = await writerA.query(probe);
      await writerB.query("INSERT INTO public.epr_inventory_cost_ledger(id) VALUES ('COST-NEW')");
      const { rows: snapshotRows } = await writerA.query(probe);
      assert.deepEqual(snapshotRows, startRows, "multi-page reads in a pinned snapshot must not mix versions");
      const { rows: freshRows } = await control.query(probe);
      assert.equal(BigInt(freshRows[0].revision), before.revision + 1n);
      assert.equal(freshRows[0].rows, startRows[0].rows + 1);
    } finally {
      await writerA.query("ROLLBACK").catch(() => {});
    }
  });

  await t.test("truncation advances revision, and a no-op statement is conservatively counted", async () => {
    const before = await version();
    await control.query("UPDATE public.vyndi_purchase_orders SET id=id WHERE id='NOT-PRESENT'");
    await control.query("TRUNCATE TABLE public.vyndi_purchase_orders");
    assert.equal((await version()).revision, before.revision + 2n);
  });

  await t.test("untrusted runtime role cannot read or mutate private witness", async () => {
    await control.query("CREATE ROLE a01_untrusted NOLOGIN");
    await control.query("SET ROLE a01_untrusted");
    try {
      await assert.rejects(
        control.query("SELECT * FROM vyndi_vaos_authority.source_revision"),
        (err) => err?.code === "42501",
      );
      await assert.rejects(
        control.query("UPDATE vyndi_vaos_authority.source_revision SET revision=0 WHERE source_key='A01_ONTOLOGY_V1'"),
        (err) => err?.code === "42501",
      );
    } finally {
      await control.query("RESET ROLE");
    }
  });

  const last = await version();
  assert.equal(last.generation, first.generation, "generation must not change on normal source activity");
  assert.ok(last.revision > first.revision, "committed source activity advances one generation");
});
