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

async function db() {
  const instance=new PGlite();
  await instance.waitReady;
  const files=await readdir(migrationsDir);
  for(const migration of pendingMigrations(files,[])) {
    await instance.exec(await readFile(join(migrationsDir,migration.path),"utf8"));
  }
  return instance;
}

async function inventoryItem(database,{item,sku,quantity,cost}) {
  await database.query(
    `select * from save_vyndi_master_inventory_entry(
      $1,$2,$3,'components',$4,$5,'stocktake-test','ea',0,0,$6,$7,$8::date,null,null,$9,'stocktake gate test',$10,$11
    )`,
    [
      item,`REC-${item}`,`LED-${item}`,sku,`Stocktake test ${sku}`,quantity,cost,
      "2026-09-01",`GRN-${item}`,"OPS-MAKER","operations",
    ],
  );
}

async function startAndAttestBook(database,id,period,effectiveOn) {
  await database.query(
    `select * from start_vyndi_inventory_stocktake($1,$2,$3::date,$4,$5,$6,$7)`,
    [id,period,effectiveOn,"FULL-AUTHORITATIVE-INVENTORY",`EVIDENCE-${id}`,"OPS-MAKER","operations"],
  );
  await database.query(
    `update epr_inventory_stocktake_lines
        set counted_quantity=expected_quantity,count_reference='COUNT-SHEET-ALL',
            evidence_reference='EVIDENCE-ALL',counted_by='OPS-MAKER',counted_at=now()
      where stocktake_id=$1`,
    [id],
  );
}

test("stocktake maker/checker posts FIFO-safe gain/loss and linked finance variance", async(t)=>{
  const database=await db(); t.after(()=>database.close());
  await inventoryItem(database,{item:"STK-A",sku:"STK-SKU-A",quantity:10,cost:100});
  await inventoryItem(database,{item:"STK-B",sku:"STK-SKU-B",quantity:5,cost:50});

  await startAndAttestBook(database,"STK-2026-09-TEST","2026-09","2026-09-18");

  await database.query(
    `select record_vyndi_inventory_stocktake_count($1,$2,'ea',$3,null,$4,$5,$6,$7)`,
    ["STK-2026-09-TEST","STK-SKU-A",8,"BIN-A","PHOTO-A","OPS-MAKER","operations"],
  );
  await database.query(
    `select record_vyndi_inventory_stocktake_count($1,$2,'ea',$3,50,$4,$5,$6,$7)`,
    ["STK-2026-09-TEST","STK-SKU-B",6,"BIN-B","PHOTO-B","OPS-MAKER","operations"],
  );

  await database.query(
    `select submit_vyndi_inventory_stocktake($1,$2,$3,$4)`,
    ["STK-2026-09-TEST","SUBMIT-EVIDENCE","OPS-MAKER","operations"],
  );

  await assert.rejects(
    ()=>database.query(
      `select approve_vyndi_inventory_stocktake($1,$2,$3,$4)`,
      ["STK-2026-09-TEST","SELF-APPROVAL","OPS-MAKER","operations"],
    ),
    /different user|self-approval/i,
  );

  await database.query(
    `select approve_vyndi_inventory_stocktake($1,$2,$3,$4)`,
    ["STK-2026-09-TEST","CHECKER-APPROVAL","OPS-CHECKER","operations"],
  );
  const posted=await database.query(
    `select * from post_vyndi_inventory_stocktake($1,$2,$3,$4)`,
    ["STK-2026-09-TEST","POST-EVIDENCE","OPS-CHECKER","operations"],
  );
  assert.equal(posted.rows[0].status,"posted");
  assert.equal(Number(posted.rows[0].variance_line_count),2);
  assert.equal(Number(posted.rows[0].loss_value_inr),200);
  assert.equal(Number(posted.rows[0].gain_value_inr),50);
  assert.equal(posted.rows[0].finance_journal_id,"FIN-STOCKTAKE-STK-2026-09-TEST");

  const balances=await database.query(
    `select sku,quantity_balance,inventory_value_inr
       from vyndi_inventory_balance where sku in ('STK-SKU-A','STK-SKU-B') order by sku`,
  );
  assert.deepEqual(
    balances.rows.map(row=>[row.sku,Number(row.quantity_balance),Number(row.inventory_value_inr)]),
    [["STK-SKU-A",8,800],["STK-SKU-B",6,300]],
  );

  const fifo=await database.query(
    `select sku,sum(quantity_remaining)::numeric as remaining
       from epr_inventory_fifo_layers where sku in ('STK-SKU-A','STK-SKU-B') group by sku order by sku`,
  );
  assert.deepEqual(
    fifo.rows.map(row=>[row.sku,Number(row.remaining)]),
    [["STK-SKU-A",8],["STK-SKU-B",6]],
  );

  const finance=await database.query(
    `select account_code,debit_inr,credit_inr,memo
       from epr_finance_journal_lines
      where journal_id='FIN-STOCKTAKE-STK-2026-09-TEST' order by line_no`,
  );
  assert.deepEqual(
    finance.rows.map(row=>[row.account_code,Number(row.debit_inr),Number(row.credit_inr)]),
    [["5200",200,0],["1200",0,200],["1200",50,0],["5200",0,50]],
  );

  const events=await database.query(
    `select event_type,actor_user_id,event_seq from epr_inventory_stocktake_events
      where stocktake_id='STK-2026-09-TEST' order by event_seq`,
  );
  assert.deepEqual(events.rows.map(row=>row.event_type),[
    "started","count_recorded","count_recorded","submitted","approved","posted",
  ]);
  assert.equal(events.rows.at(-2).actor_user_id,"OPS-CHECKER");
  assert.deepEqual(
    events.rows.map(row=>Number(row.event_seq)),
    [...events.rows].map(row=>Number(row.event_seq)).sort((a,b)=>a-b),
  );

  await assert.rejects(
    ()=>database.query(`update epr_inventory_stocktake_events set evidence_reference='tampered' where stocktake_id='STK-2026-09-TEST'`),
    /append-only/i,
  );
  await assert.rejects(
    ()=>database.query(`delete from epr_inventory_stocktake_events where stocktake_id='STK-2026-09-TEST'`),
    /append-only/i,
  );
});

test("stock movement after snapshot invalidates submission rather than rebasing the count", async(t)=>{
  const database=await db(); t.after(()=>database.close());
  await inventoryItem(database,{item:"STALE-A",sku:"STALE-SKU",quantity:10,cost:100});
  await startAndAttestBook(database,"STK-STALE","2026-10","2026-10-01");

  await database.query(
    `select * from post_vyndi_inventory_receipt($1,$2,$3,$4,$5,$6,$7::date,$8,$9,$10,$11)`,
    ["REC-STALE-2","LED-STALE-2","STALE-SKU",1,"ea",100,"2026-10-01","GRN-STALE-2","post-snapshot receipt","OPS-OTHER","operations"],
  );

  const stale=await database.query(`select vyndi_inventory_stocktake_stale_count('STK-STALE') as count`);
  assert.equal(Number(stale.rows[0].count),1);
  await assert.rejects(
    ()=>database.query(
      `select submit_vyndi_inventory_stocktake($1,$2,$3,$4)`,
      ["STK-STALE","SUBMIT-STALE","OPS-MAKER","operations"],
    ),
    /moved after the snapshot|fresh book snapshot/i,
  );
  const session=await database.query(`select status from epr_inventory_stocktakes where id='STK-STALE'`);
  assert.equal(session.rows[0].status,"draft");
});

test("statutory hard-close authority and CA evidence include stocktake readiness", async()=>{
  const [statutory,migration,authority,route,metadata]=await Promise.all([
    readFile(join(root,"src/lib/finance/statutory-authority.ts"),"utf8"),
    readFile(join(root,"migrations/0087_stocktake_statutory_controls.sql"),"utf8"),
    readFile(join(root,"src/lib/inventory-stocktake-authority.ts"),"utf8"),
    readFile(join(root,"src/routes/command/inventory-stocktake.tsx"),"utf8"),
    readFile(join(root,"src/lib/page-metadata.ts"),"utf8"),
  ]);

  assert.match(statutory,/posted_stocktakes/);
  assert.match(statutory,/open_stocktakes/);
  assert.match(statutory,/blockers\.postedStocktakes > 0 \? 0 : 1/);
  assert.match(statutory,/stocktake:stocktake \?\? null/);
  assert.match(migration,/post_vyndi_inventory_stocktake/);
  assert.match(migration,/'accountCode','5200','debitInr'/);
  assert.match(migration,/'accountCode','1200','creditInr'/);
  assert.match(migration,/vyndi_inventory_stocktake_stale_count/);
  assert.match(authority,/requireBusinessActor\("approve"\)/);
  assert.match(route,/Any inventory movement after this snapshot invalidates submission or approval/);
  assert.match(route,/Approve independently/);
  assert.match(metadata,/Inventory Stocktake/);
});
