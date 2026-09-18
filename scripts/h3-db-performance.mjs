import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import pg from "pg";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required for H3 DB qualification.");

const evidencePath = resolve(process.env.H3_DB_EVIDENCE_PATH || ".grok/evidence/h3-performance/db-performance.json");
const readP95LimitMs = Number(process.env.H3_DB_READ_P95_LIMIT_MS || 1500);
const writeP95LimitMs = Number(process.env.H3_DB_WRITE_P95_LIMIT_MS || 3000);
const hotspotP95LimitMs = Number(process.env.H3_DB_HOTSPOT_P95_LIMIT_MS || 5000);
const minReadThroughput = Number(process.env.H3_DB_MIN_READ_OPS_SEC || 10);
const minWriteThroughput = Number(process.env.H3_DB_MIN_WRITE_OPS_SEC || 5);

const pool = new pg.Pool({
  connectionString: databaseUrl,
  max: 20,
  connectionTimeoutMillis: 10_000,
  idleTimeoutMillis: 10_000,
});

function percentile(values, p) {
  if (!values.length) return null;
  const ordered=[...values].sort((a,b)=>a-b);
  const index=Math.min(ordered.length-1,Math.max(0,Math.ceil((p/100)*ordered.length)-1));
  return ordered[index];
}

function phaseStats(samples, wallMs) {
  const success=samples.filter((row)=>row.ok);
  const failed=samples.filter((row)=>!row.ok);
  const durations=success.map((row)=>row.durationMs);
  return {
    operations:samples.length,
    successes:success.length,
    failures:failed.length,
    errorRate:samples.length ? failed.length/samples.length : 1,
    wallMs,
    throughputOpsSec:wallMs>0 ? Number(((success.length*1000)/wallMs).toFixed(2)) : 0,
    p50Ms:percentile(durations,50),
    p95Ms:percentile(durations,95),
    p99Ms:percentile(durations,99),
    maxMs:durations.length ? Math.max(...durations) : null,
    errors:failed.slice(0,5).map((row)=>row.error),
  };
}

async function runConcurrent({ concurrency, count, operation }) {
  const samples=[];
  let cursor=0;
  const started=Date.now();
  await Promise.all(Array.from({length:concurrency},async()=>{
    while(true){
      const index=cursor++;
      if(index>=count) return;
      const opStarted=Date.now();
      try {
        await operation(index);
        samples.push({ok:true,durationMs:Date.now()-opStarted});
      } catch(error) {
        samples.push({ok:false,durationMs:Date.now()-opStarted,error:error instanceof Error ? error.message : String(error)});
      }
    }
  }));
  return phaseStats(samples,Date.now()-started);
}

async function saveOrder(id, units, actor="h3-load") {
  return pool.query(
    `select * from save_vyndi_sales_order(
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13,$14
    )`,
    [
      id,34,"aluminium",units,1.25,"direct","confirmed","core","core-tiagra",
      "VINDY Longitude Tiagra",JSON.stringify({groupset:"gs-tiagra-4700"}),
      "H3 performance qualification",actor,"operations",
    ],
  );
}

const evidence={
  test:"VYNDI H3 PostgreSQL performance and contention qualification",
  environment:"isolated-postgresql",
  poolMax:20,
  startedAt:new Date().toISOString(),
  readTiers:[],
  writeTiers:[],
  hotspot:null,
  invariants:null,
  thresholds:{
    readP95LimitMs,writeP95LimitMs,hotspotP95LimitMs,minReadThroughput,minWriteThroughput,
  },
  result:"RUNNING",
};

try {
  await pool.query("select 1");
  await pool.query("delete from vyndi_sales_order_revisions where sales_order_id like 'H3-%'");
  await pool.query("delete from vyndi_audit_events where entity_type='sales_order' and entity_id like 'H3-%'");
  await pool.query("delete from vyndi_sales_orders where id like 'H3-%'");

  for (const concurrency of [5,10,20]) {
    const stats=await runConcurrent({
      concurrency,
      count:60,
      operation:async(index)=>{
        await pool.query(
          `select count(*)::int as orders,
                  (select count(*)::int from vyndi_audit_events) as audits,
                  (select count(*)::int from _migrations) as migrations
             from vyndi_sales_orders
            where status in ('confirmed','delivered')`,
        );
      },
    });
    evidence.readTiers.push({concurrency,...stats});
    assert.equal(stats.failures,0,`Read tier c=${concurrency} had failures.`);
    assert.ok((stats.p95Ms ?? Infinity)<=readP95LimitMs,`Read p95 ${stats.p95Ms}ms exceeds ${readP95LimitMs}ms at concurrency ${concurrency}.`);
    assert.ok(stats.throughputOpsSec>=minReadThroughput,`Read throughput ${stats.throughputOpsSec} ops/s below ${minReadThroughput} at concurrency ${concurrency}.`);
  }

  let idSequence=0;
  for (const concurrency of [5,10,20]) {
    const prefix=`H3-W${concurrency}`;
    const stats=await runConcurrent({
      concurrency,
      count:40,
      operation:async(index)=>{
        const id=`${prefix}-${String(++idSequence).padStart(4,"0")}`;
        const result=await saveOrder(id,(index%4)+1);
        assert.equal(Number(result.rows[0]?.revision),1);
      },
    });
    evidence.writeTiers.push({concurrency,...stats});
    assert.equal(stats.failures,0,`Write tier c=${concurrency} had failures.`);
    assert.ok((stats.p95Ms ?? Infinity)<=writeP95LimitMs,`Write p95 ${stats.p95Ms}ms exceeds ${writeP95LimitMs}ms at concurrency ${concurrency}.`);
    assert.ok(stats.throughputOpsSec>=minWriteThroughput,`Write throughput ${stats.throughputOpsSec} ops/s below ${minWriteThroughput} at concurrency ${concurrency}.`);
  }

  await saveOrder("H3-HOTSPOT",1,"h3-hotspot-seed");
  const hotspot=await runConcurrent({
    concurrency:12,
    count:12,
    operation:async(index)=>{
      const result=await saveOrder("H3-HOTSPOT",(index%5)+1,`h3-hotspot-${index+1}`);
      assert.ok(Number(result.rows[0]?.revision)>=2);
    },
  });
  evidence.hotspot={concurrency:12,...hotspot};
  assert.equal(hotspot.failures,0,"Hotspot contention produced failed governed writes.");
  assert.ok((hotspot.p95Ms ?? Infinity)<=hotspotP95LimitMs,`Hotspot p95 ${hotspot.p95Ms}ms exceeds ${hotspotP95LimitMs}ms.`);

  const [uniqueOrders,uniqueRevisions,hotspotState,auditState]=await Promise.all([
    pool.query("select count(*)::int as count from vyndi_sales_orders where id like 'H3-W%'"),
    pool.query("select count(*)::int as count from vyndi_sales_order_revisions where sales_order_id like 'H3-W%'"),
    pool.query(`select revision,
      (select count(*)::int from vyndi_sales_order_revisions where sales_order_id='H3-HOTSPOT') as revision_rows
      from vyndi_sales_orders where id='H3-HOTSPOT'`),
    pool.query(`select count(*)::int as count,
      count(*) filter(where actor_user_id is null or actor_user_id='')::int as unattributed
      from vyndi_audit_events where entity_type='sales_order' and entity_id like 'H3-%'`),
  ]);
  evidence.invariants={
    uniqueWriteOrders:Number(uniqueOrders.rows[0]?.count ?? 0),
    uniqueWriteRevisions:Number(uniqueRevisions.rows[0]?.count ?? 0),
    hotspotCurrentRevision:Number(hotspotState.rows[0]?.revision ?? 0),
    hotspotRevisionRows:Number(hotspotState.rows[0]?.revision_rows ?? 0),
    auditEvents:Number(auditState.rows[0]?.count ?? 0),
    unattributedAuditEvents:Number(auditState.rows[0]?.unattributed ?? 0),
  };

  assert.equal(evidence.invariants.uniqueWriteOrders,120,"Concurrent unique writes lost or duplicated Sales Orders.");
  assert.equal(evidence.invariants.uniqueWriteRevisions,120,"Concurrent unique writes lost or duplicated revision lineage.");
  assert.equal(evidence.invariants.hotspotCurrentRevision,13,"Hotspot serialization lost a revision.");
  assert.equal(evidence.invariants.hotspotRevisionRows,13,"Hotspot revision history is incomplete.");
  assert.equal(evidence.invariants.unattributedAuditEvents,0,"Concurrent writes created unattributed audit evidence.");

  evidence.result="PASS";
  evidence.completedAt=new Date().toISOString();
  console.log(JSON.stringify({event:"vyndi.h3.db-performance",...evidence},null,2));
} catch(error) {
  evidence.result="FAIL";
  evidence.completedAt=new Date().toISOString();
  evidence.error=error instanceof Error ? error.stack || error.message : String(error);
  throw error;
} finally {
  await mkdir(dirname(evidencePath),{recursive:true});
  await writeFile(evidencePath,`${JSON.stringify(evidence,null,2)}\n`,"utf8");
  await pool.end();
}
