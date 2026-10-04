import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

async function source(path) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

test("governed packet refresh reloads optimizer route state before another execution", async () => {
  const route = await source("src/routes/command/ibpe-operating-workspace_.optimizer.tsx");
  const prepare = route.indexOf("const response = await runAdvancedPlanningFromLatestIbpe()");
  const refresh = route.indexOf("await reloadOptimizerState()", prepare);
  const execute = route.indexOf("async function execute()", prepare);
  assert.ok(prepare >= 0, "governed packet refresh action is missing");
  assert.ok(refresh > prepare, "packet refresh must force a client loader-state reload");
  assert.ok(refresh < execute, "reload must occur before a subsequent optimizer execution can be initiated");
  assert.match(route, /Reloading the optimizer against this exact packet/i);
});

test("packet refresh keeps execution locked until a hard reload replaces stale loader state", async () => {
  const route = await source("src/routes/command/ibpe-operating-workspace_.optimizer.tsx");
  const helperStart = route.indexOf("async function reloadOptimizerState");
  const prepareStart = route.indexOf("async function preparePacket()", helperStart);
  const executeStart = route.indexOf("async function execute()", prepareStart);
  const recentFunding = route.indexOf("const recentFundingAuthoritative", executeStart);
  assert.ok(helperStart >= 0 && prepareStart > helperStart && executeStart > prepareStart && recentFunding > executeStart);

  const helper = route.slice(helperStart, prepareStart);
  assert.match(helper, /window\.location\.reload\(\)/);
  assert.match(helper, /return true;/, "browser hard reload must report that the page is leaving");
  assert.match(helper, /await router\.invalidate\(\);[\s\S]*?return false;/, "non-browser fallback must report that no hard reload started");

  const prepareBlock = route.slice(prepareStart, executeStart);
  assert.match(prepareBlock, /let hardReloadStarted = false;/);
  assert.match(prepareBlock, /hardReloadStarted = await reloadOptimizerState\(\)/);
  assert.match(
    prepareBlock,
    /finally \{[\s\S]*?if \(!hardReloadStarted\) setPacketBusy\(false\);[\s\S]*?\}/,
    "packetBusy must remain true after location.reload so stale packet state cannot re-enable HiGHS",
  );

  const executionBlock = route.slice(executeStart, recentFunding);
  assert.match(executionBlock, /let hardReloadStarted = false;/);
  assert.match(executionBlock, /hardReloadStarted = await reloadOptimizerState\(\)/);
  assert.match(
    executionBlock,
    /finally \{[\s\S]*?if \(!hardReloadStarted\) setBusy\(false\);[\s\S]*?\}/,
    "optimizer busy state must stay locked while a hard reload is in flight",
  );
});

test("optimizer control and execution agree on deterministic latest packet ordering", async () => {
  const control = await source("src/lib/advanced-optimizer-control.ts");
  const execution = await source("src/lib/advanced-optimizer-execution.ts");
  assert.match(
    control,
    /from vyndi_advanced_planning_packets[\s\S]*?order by created_at desc,id desc[\s\S]*?limit 1/,
    "optimizer control must use the same deterministic latest-packet tie-breaker as execution",
  );
  assert.match(
    execution,
    /from vyndi_advanced_planning_packets[\s\S]*?order by created_at desc,id desc[\s\S]*?limit 1/,
    "optimizer execution lineage guard must retain deterministic latest-packet selection",
  );
});

test("optimizer execution cannot crash on transient undefined loader data", async () => {
  const route = await source("src/routes/command/ibpe-operating-workspace_.optimizer.tsx");
  assert.match(
    route,
    /const state = loadedState \?\? \{/,
    "optimizer page must provide a safe control-state fallback before reading packet",
  );
  assert.match(route, /OPTIMIZER_STATE_UNAVAILABLE/);

  const execute = route.indexOf("async function execute()");
  const recentFunding = route.indexOf("const recentFundingAuthoritative", execute);
  assert.ok(execute >= 0 && recentFunding > execute, "optimizer execution block is missing");
  const executionBlock = route.slice(execute, recentFunding);
  assert.match(
    executionBlock,
    /await reloadOptimizerState\(\)/,
    "optimizer execution must refresh through the hard-reload boundary",
  );
  assert.doesNotMatch(
    executionBlock,
    /await router\.invalidate\(\)/,
    "optimizer execution must not directly invalidate into transient undefined loader state",
  );

  const refreshHelper = route.slice(
    route.indexOf("async function reloadOptimizerState"),
    route.indexOf("async function preparePacket()"),
  );
  assert.match(refreshHelper, /window\.location\.reload\(\)/);
});


test("ordinary optimizer GET state does not reconstruct the frozen optimization envelope", async () => {
  const control = await source("src/lib/advanced-optimizer-control.ts");
  assert.doesNotMatch(
    control,
    /loadPreparedAdvancedOptimizerEnvelope/,
    "read-only optimizer navigation must not reconstruct the full governed optimization envelope",
  );
  assert.match(control, /vyndi_advanced_planning_packets/);
  assert.match(control, /vyndi_advanced_optimization_runs/);
});
