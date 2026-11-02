import assert from "node:assert/strict";
import { chromium } from "playwright";
const base=(process.env.VYNDI_TEST_BASE_URL||"https://vyndios.vayushastr.workers.dev").replace(/\/$/,"");
const expected=process.env.VYNDI_TEST_EXPECTED_SHA||"";
assert.match(expected,/^[a-f0-9]{40}$/);
assert.ok(process.env.VYNDI_TEST_EMAIL&&process.env.VYNDI_TEST_PASSWORD,"Hosted acceptance credentials required");
const browser=await chromium.launch({headless:true});
try {
 for(const viewport of [{width:1440,height:900},{width:390,height:844}]){
  const context=await browser.newContext({viewport,reducedMotion:"reduce"});
  const health=await context.request.get(base+"/api/runtime/health");
  assert.equal(health.status(),200);
  assert.equal((await health.json()).sourceSha,expected);
  const page=await context.newPage();
  const errors=[];
  page.on("pageerror",e=>{errors.push(e.message);console.error("VYNDI_BROWSER_PAGEERROR",e.message);});

  const response=await page.goto(base+"/login?returnTo=%2Fcommand%2Fproduction",{waitUntil:"domcontentloaded",timeout:60000});
  assert.equal(response.status(),200);
  await page.locator(".vy-login.is-cinematic").waitFor({state:"visible",timeout:30000});
  await page.getByLabel(/Authorised Email/i).fill(process.env.VYNDI_TEST_EMAIL);
  await page.getByLabel(/^Password$/i).fill(process.env.VYNDI_TEST_PASSWORD);
  await page.getByRole("button",{name:/Authorize · Enter Command/i}).click();
  await page.waitForURL(/\/command(?:\/|$)/,{timeout:45000});
  if(!page.url().endsWith("/production"))await page.goto(base+"/command/production",{waitUntil:"domcontentloaded",timeout:60000});
  const boundary=page.getByRole("region",{name:"Pre-production release boundary",exact:true});
  await boundary.waitFor({state:"visible",timeout:30000});
  assert.match(await boundary.innerText(),/NOT RELEASED.*Design confirmation required/);
  const labels=page.getByText("DEMO / NOT A PHYSICAL RELEASE",{exact:true});
  assert.equal(await labels.count(),4);
  for(const label of await labels.all()){
    const card=label.locator("xpath=ancestor::article[1]");
    assert.equal(await card.getByRole("button",{name:/Approve bike \/ batch|Issue reserved FIFO/}).count(),0);
  }
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+2),true);
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({check:"preproduction-live",sourceSha:expected,viewport,demoCards:4,realRelease:"NOT_RELEASED",physicalActionsExposed:0}));
  await context.close();
 }
}finally{await browser.close();}
