import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

async function source(path) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

test("Cloudflare cold-start path keeps HiGHS JS and Wasm behind the explicit optimizer execution boundary", async () => {
  const execution = await source("src/lib/advanced-optimizer-execution.ts");
  const provider = await source("src/lib/advanced-planning-highs-deployment-runtime.ts");

  assert.doesNotMatch(execution, /generated\/highs\.wasm/);
  assert.doesNotMatch(execution, /advanced-planning-highs-runtime\.ts/);
  assert.doesNotMatch(execution, /import\s+\{\s*createDeploymentHighsOptimizer\s*\}\s+from/);

  assert.match(execution, /async function createLazyDeploymentHighsOptimizer/);
  assert.match(execution, /import\(\s*["']@\/lib\/advanced-planning-highs-deployment-runtime["']\s*\)/);
  assert.match(execution, /await createLazyDeploymentHighsOptimizer\(\)/);

  assert.match(provider, /import\(["']\.\.\/generated\/highs\.wasm["']\)/);
  assert.match(provider, /import\(["']\.\/advanced-planning-highs-runtime\.ts["']\)/);
  assert.match(provider, /createPrecompiledHighsOptimizer\(highsWasm\)/);
});
