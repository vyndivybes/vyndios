import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { PGlite } from "@electric-sql/pglite";

const sizes = [0, 100, 1000, 10000];
const maxMs = Number(process.env.VYNDI_INVENTORY_PQ_MAX_MS || 30000);
const evidenceDir = resolve(process.env.VYNDI_INVENTORY_PQ_EVIDENCE_DIR || "artifacts/inventory-pq1");
await mkdir(evidenceDir, { recursive: true });

const migrationUrl = (name) => new URL(`../migrations/${name}`, import.meta.url);

async function createDb() {
  const db = new PGlite();
  await db.waitReady;
  await db.exec(`
    create table component_inventory (
      id text primary key,
      sku text not null,
      brand text not null,
      model text not null,
      category text not null,
      reorder_level numeric not null default 0,
      stock_qty numeric not null default 0,
      price_inr numeric not null default 0,
      notes text not null default ''
    );
  `);
  await db.exec(await readFile(migrationUrl("0021_master_inventory.sql"), "utf8"));
  await db.exec(await readFile(migrationUrl("0022_master_inventory_global_sku.sql"), "utf8"));
  return db;
}

async function qualifySize(size) {
  const db = await createDb();
  const started = performance.now();
  try {
    if (size > 0) {
      await db.exec(`
        insert into master_inventory_items
          (id, ledger_id, sku, name, category, unit, minimum_stock_level, planned_monthly_use, created_by, updated_by)
        select
          'pq-item-' || g,
          case when g % 5 = 0 then 'raw-materials' else 'components' end,
          'PQ-' || lpad(g::text, 6, '0'),
          'PQ Inventory Item ' || g,
          case when g % 5 = 0 then 'raw' else 'component' end,
          'ea',
          case when g % 4 = 0 then 12 else 5 end,
          2,
          'pq1',
          'pq1'
        from generate_series(1, ${size}) g;

        insert into master_inventory_lots
          (id, item_id, quantity_received, quantity_remaining, unit_cost_inr, received_on, reference, notes, created_by)
        select
          'pq-lot-' || g,
          'pq-item-' || g,
          10,
          10,
          (g % 100) + 1,
          date '2026-01-01',
          'PQ1 seed',
          '',
          'pq1'
        from generate_series(1, ${size}) g;
      `);
    }

    const summary = await db.query(`
      with stock as (
        select item_id, coalesce(sum(quantity_remaining), 0) as quantity
        from master_inventory_lots
        group by item_id
      )
      select
        count(*)::int as item_count,
        count(*) filter (where coalesce(stock.quantity, 0) < items.minimum_stock_level)::int as below_msl,
        coalesce(sum(coalesce(stock.quantity, 0)), 0)::numeric as total_quantity
      from master_inventory_items items
      left join stock on stock.item_id = items.id
      where items.active = true
    `);
    const row = summary.rows[0];
    assert.equal(Number(row.item_count), size, `inventory item count mismatch at scale ${size}`);
    assert.equal(Number(row.below_msl), Math.floor(size / 4), `MSL truth mismatch at scale ${size}`);
    assert.equal(Number(row.total_quantity), size * 10, `stock quantity mismatch at scale ${size}`);

    if (size > 0) {
      await db.exec(`
        insert into master_inventory_lots
          (id, item_id, quantity_received, quantity_remaining, unit_cost_inr, received_on, reference, notes, created_by)
        values ('pq-lot-1-later', 'pq-item-1', 5, 5, 20, date '2026-02-01', 'PQ1 second lot', '', 'pq1');
      `);
      const issued = await db.query(
        "select * from issue_master_inventory_fifo($1,$2,$3,$4::date,$5,$6,$7)",
        ["pq-issue-1", "pq-item-1", 12, "2026-03-01", "PQ1", "FIFO scale proof", "pq1"],
      );
      assert.equal(Number(issued.rows[0]?.quantity_issued), 12);
      assert.equal(Number(issued.rows[0]?.issue_value_inr), 60);

      const lots = await db.query(
        "select id, quantity_remaining::numeric as quantity_remaining from master_inventory_lots where item_id = 'pq-item-1' order by received_on, id",
      );
      assert.deepEqual(
        lots.rows.map((lot) => [lot.id, Number(lot.quantity_remaining)]),
        [["pq-lot-1", 0], ["pq-lot-1-later", 3]],
      );
    }

    const durationMs = Math.round((performance.now() - started) * 10) / 10;
    assert.ok(durationMs <= maxMs, `inventory PQ1 scale ${size} exceeded ${maxMs}ms: ${durationMs}ms`);
    return { size, durationMs, belowMsl: Math.floor(size / 4), fifoVerified: size > 0 };
  } finally {
    await db.close();
  }
}

const results = [];
for (const size of sizes) {
  results.push(await qualifySize(size));
  console.log(`[inventory-pq1] PASS · ${size.toLocaleString("en-IN")} items`);
}

const report = {
  qualification: "INVENTORY-PQ1",
  sizes,
  maxMs,
  results,
  assertions: ["canonical item count", "MSL truth", "stock quantity", "FIFO oldest-lot allocation"],
};
await writeFile(resolve(evidenceDir, "inventory-pq1-scale.json"), JSON.stringify(report, null, 2) + "\n");
console.log(`[inventory-pq1] PASS · 0 / 100 / 1,000 / 10,000 governed inventory scale`);
