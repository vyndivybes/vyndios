import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const commandRoute = await readFile(new URL("../src/routes/command/route.tsx", import.meta.url), "utf8");
const planSync = await readFile(new URL("../src/lib/operating-plan-sync.ts", import.meta.url), "utf8");
const projection = await readFile(new URL("../src/components/ibpe-workspace-projection.tsx", import.meta.url), "utf8");
const responsive = await readFile(new URL("./operator-ux-hardening.mjs", import.meta.url), "utf8");
const commandIndex = await readFile(new URL("../src/routes/command/index.tsx", import.meta.url), "utf8");
const stocktake = await readFile(new URL("../src/routes/command/inventory-stocktake.tsx", import.meta.url), "utf8");
const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));

test("hard Command RBAC remains synchronous while plan hydration is route-scoped", () => {
  assert.match(commandRoute, /beforeLoad:[\s\S]*getCommandRole\(\)/);
  assert.match(commandRoute, /OPERATING_PLAN_SYNC_ROUTES/);
  assert.match(commandRoute, /useOperatingPlanSync\(syncOperatingPlan\)/);
  assert.match(planSync, /useOperatingPlanSync\(enabled = true\)/);
  assert.match(planSync, /if \(!enabled\) return/);
});

test("child Command loaders reuse the already-resolved parent role", () => {
  assert.doesNotMatch(commandIndex, /getCommandRole\(/);
  assert.match(commandIndex, /context\.commandRole/);
  assert.doesNotMatch(stocktake, /getCommandRole\(/);
  assert.match(stocktake, /context\.commandRole/);
});

test("global IBPE projection does not fetch governed status on shell mount", () => {
  assert.doesNotMatch(projection, /useEffect\s*\(/);
  assert.match(projection, /Load IBPE status/i);
  assert.match(projection, /getLatestIbpeRun\(\)/);
  assert.match(projection, /getIbpeReadiness\(\)/);
});

test("responsive qualification reuses one authenticated SPA page per viewport", () => {
  assert.match(responsive, /async function spaNavigate/);
  assert.match(responsive, /const page = login/);
  assert.doesNotMatch(responsive, /for \(const route of routes\)[\s\S]{0,300}context\.newPage\(\)/);
  assert.match(responsive, /await spaNavigate\(page, route\)/);
});

test("inventory scale and Worker load qualification remain explicit separate gates", () => {
  assert.equal(pkg.scripts["test:inventory:pq1"], "node scripts/inventory-pq1-scale.mjs");
  assert.equal(pkg.scripts["test:worker:load"], "node scripts/worker-load-qualification.mjs");
  assert.doesNotMatch(pkg.scripts.test, /inventory-pq1-scale|worker-load-qualification/);
});
