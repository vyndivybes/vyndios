import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = path => readFileSync(new URL("../" + path, import.meta.url), "utf8");

test("Risk initial Worker SSR does not compile VEDM graph or block on SQL", () => {
  const s = read("src/routes/command/risk.tsx");
  const match = s.match(/createFileRoute\("\/command\/risk"\)\(\{([\s\S]*?)component: Risk/);
  assert.ok(match, "governed Risk route must exist");
  for (const f of ["listCanonicalRiskAuthority()", "listDerivedEngineeringRiskSignals()", "listRiskHistory()"]) {
    assert.ok(s.includes(f), "canonical authority remains available");
    assert.ok(!match[1].includes(f), "heavy authority cannot block initial SSR: " + f);
  }
  assert.match(s, /useEffect\(/);
  for (const status of ["loading","ready","error"]) assert.ok(s.includes('data-route-readiness="' + status + '"'));
});

test("Risk save and create always refresh canonical register, not an absent route loader", () => {
  const s = read("src/routes/command/risk.tsx");
  assert.match(s, /onReload/);
  assert.doesNotMatch(s, /router\.invalidate\(\)/);
});

test("authenticated browser and SLO wait for hydrated Risk canonical evidence", () => {
  for (const file of ["scripts/vyndi-production-playwright-smoke.mjs","scripts/vyndi-observability-slo.mjs"]) {
    const s = read(file);
    assert.match(s, /\/command\/risk/);
    assert.match(s, /cpuBoundClientRoutes/);
    assert.match(s, /data-route-readiness="ready"/);
  }
});
