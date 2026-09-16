import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

async function source(path) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

test("Cloudflare request path never imports or executes HiGHS after browser Web Worker offload", async () => {
  const execution = await source("src/lib/advanced-optimizer-execution.ts");
  const browserClient = await source("src/lib/advanced-planning-highs-browser-client.ts");
  const browserWorker = await source("src/lib/advanced-planning-highs-browser-worker.ts");
  const verifier = await source("src/lib/advanced-planning-browser-offload.ts");

  assert.doesNotMatch(execution, /generated\/highs\.wasm/);
  assert.doesNotMatch(execution, /advanced-planning-highs-runtime\.ts/);
  assert.doesNotMatch(execution, /advanced-planning-highs-deployment-runtime/);
  assert.doesNotMatch(execution, /createDeploymentHighsOptimizer/);
  assert.match(execution, /prepareAdvancedOptimizerBrowserSolve/);
  assert.match(execution, /persistAdvancedOptimizerBrowserSolve/);
  assert.match(execution, /solveAdvancedPlanningInBrowserWorker/);
  assert.match(execution, /verifyBrowserHighsRawSolution/);

  assert.match(browserClient, /new Worker\(/);
  assert.match(browserClient, /advanced-planning-highs-browser-worker\.ts/);
  assert.match(browserWorker, /import loadHighs from "highs"/);
  assert.match(browserWorker, /new URL\("\.\.\/generated\/highs\.wasm", import\.meta\.url\)/);
  assert.match(browserWorker, /highs\.solve\(lp/);
  assert.match(verifier, /compileAdvancedPlanningMathematicalModel/);
  assert.match(verifier, /compileGovernedHardCapitalConstraints/);
});
