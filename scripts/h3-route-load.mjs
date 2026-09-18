import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { chromium } from "playwright";

const baseUrl=(process.env.VYNDI_TEST_BASE_URL || "http://127.0.0.1:8081").replace(/\/$/,"");
const email=process.env.VYNDI_TEST_EMAIL;
const password=process.env.VYNDI_TEST_PASSWORD;
const concurrency=Math.max(1,Math.min(16,Number(process.env.H3_ROUTE_CONCURRENCY || 8)));
const samplesPerRoute=Math.max(1,Math.min(8,Number(process.env.H3_ROUTE_SAMPLES || 4)));
const p95LimitMs=Number(process.env.H3_ROUTE_P95_LIMIT_MS || 8000);
const p99LimitMs=Number(process.env.H3_ROUTE_P99_LIMIT_MS || 15000);
const evidencePath=resolve(process.env.H3_ROUTE_EVIDENCE_PATH || ".grok/evidence/h3-performance/route-load.json");

if(!email) throw new Error("VYNDI_TEST_EMAIL is required.");
if(!password) throw new Error("VYNDI_TEST_PASSWORD is required.");

const routes=[
  "/command",
  "/command/sales",
  "/command/inventory",
  "/command/operations",
  "/command/quality",
  "/command/actuals",
  "/command/financial-cockpit",
  "/command/ibpe-operating-workspace/optimizer",
  "/command/ibpe-operating-workspace/assurance",
];

function percentile(values,p){
  if(!values.length) return null;
  const ordered=[...values].sort((a,b)=>a-b);
  return ordered[Math.min(ordered.length-1,Math.max(0,Math.ceil((p/100)*ordered.length)-1))];
}

function summarize(samples,wallMs){
  const good=samples.filter((row)=>row.ok);
  const bad=samples.filter((row)=>!row.ok);
  const durations=good.map((row)=>row.durationMs);
  return {
    requests:samples.length,
    successes:good.length,
    failures:bad.length,
    errorRate:samples.length ? bad.length/samples.length : 1,
    wallMs,
    throughputReqSec:wallMs>0 ? Number(((good.length*1000)/wallMs).toFixed(2)) : 0,
    p50Ms:percentile(durations,50),
    p95Ms:percentile(durations,95),
    p99Ms:percentile(durations,99),
    maxMs:durations.length ? Math.max(...durations) : null,
    errors:bad.slice(0,8).map((row)=>({route:row.route,error:row.error,status:row.status})),
  };
}

async function runConcurrent(tasks,workerCount,operation){
  const samples=[];
  let cursor=0;
  const started=Date.now();
  await Promise.all(Array.from({length:workerCount},async()=>{
    while(true){
      const index=cursor++;
      if(index>=tasks.length) return;
      const task=tasks[index];
      const opStarted=Date.now();
      let status=null;
      try{
        const result=await operation(task);
        status=result.status;
        samples.push({...task,ok:true,status,durationMs:Date.now()-opStarted});
      }catch(error){
        samples.push({...task,ok:false,status,durationMs:Date.now()-opStarted,error:error instanceof Error ? error.message : String(error)});
      }
    }
  }));
  return {samples,summary:summarize(samples,Date.now()-started)};
}

const evidence={
  test:"VYNDI H3 authenticated route concurrency qualification",
  baseUrl,
  concurrency,
  samplesPerRoute,
  startedAt:new Date().toISOString(),
  summary:null,
  byRoute:null,
  thresholds:{p95LimitMs,p99LimitMs},
  result:"RUNNING",
};

const browser=await chromium.launch({headless:true});
const context=await browser.newContext({viewport:{width:1280,height:800},reducedMotion:"reduce"});

try{
  const page=await context.newPage();
  const loginResponse=await page.goto(`${baseUrl}/login?returnTo=%2Fcommand`,{waitUntil:"domcontentloaded",timeout:60_000});
  assert.ok(loginResponse?.ok(),`Login page HTTP ${loginResponse?.status() ?? "none"}`);
  await page.getByLabel(/Authorised Email/i).fill(email);
  await page.getByLabel(/^Password$/i).fill(password);
  await page.getByRole("button",{name:/Authorize · Enter Command/i}).click();
  await page.waitForURL(/\/command(?:\/|$)/,{timeout:45_000});
  await page.close();

  const tasks=[];
  for(const route of routes){
    for(let sample=1;sample<=samplesPerRoute;sample+=1) tasks.push({route,sample});
  }

  const run=await runConcurrent(tasks,concurrency,async({route})=>{
    const loadPage=await context.newPage();
    const pageErrors=[];
    loadPage.on("pageerror",(error)=>pageErrors.push(String(error?.message || error)));
    try{
      const response=await loadPage.goto(`${baseUrl}${route}`,{waitUntil:"domcontentloaded",timeout:60_000});
      const status=response?.status() ?? null;
      assert.ok(response?.ok(),`${route} returned HTTP ${status ?? "none"}`);
      await loadPage.locator("body").waitFor({state:"visible",timeout:30_000});
      await loadPage.waitForFunction(()=>(document.body?.innerText || "").trim().length>40,undefined,{timeout:30_000});
      const body=(await loadPage.locator("body").innerText()).trim();
      assert.doesNotMatch(loadPage.url(),/\/login(?:\?|$)|\/command-login/,`${route} lost authenticated access under load`);
      assert.doesNotMatch(body,/Internal Server Error|Something went wrong|Cannot read properties of undefined/i,`${route} rendered fatal error content`);
      assert.deepEqual(pageErrors,[],`${route} emitted browser errors: ${pageErrors.join(" | ")}`);
      return {status};
    }finally{
      await loadPage.close().catch(()=>{});
    }
  });

  evidence.summary=run.summary;
  evidence.byRoute=Object.fromEntries(routes.map((route)=>[
    route,
    summarize(run.samples.filter((row)=>row.route===route),run.summary.wallMs),
  ]));

  assert.equal(run.summary.failures,0,`Concurrent route qualification had ${run.summary.failures} failures.`);
  assert.ok((run.summary.p95Ms ?? Infinity)<=p95LimitMs,`Route p95 ${run.summary.p95Ms}ms exceeds ${p95LimitMs}ms.`);
  assert.ok((run.summary.p99Ms ?? Infinity)<=p99LimitMs,`Route p99 ${run.summary.p99Ms}ms exceeds ${p99LimitMs}ms.`);

  evidence.result="PASS";
  evidence.completedAt=new Date().toISOString();
  console.log(JSON.stringify({event:"vyndi.h3.route-load",...evidence},null,2));
}catch(error){
  evidence.result="FAIL";
  evidence.completedAt=new Date().toISOString();
  evidence.error=error instanceof Error ? error.stack || error.message : String(error);
  throw error;
}finally{
  await mkdir(dirname(evidencePath),{recursive:true});
  await writeFile(evidencePath,`${JSON.stringify(evidence,null,2)}\n`,"utf8");
  await context.close().catch(()=>{});
  await browser.close().catch(()=>{});
}
