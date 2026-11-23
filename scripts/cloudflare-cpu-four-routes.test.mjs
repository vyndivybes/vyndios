import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = path => readFileSync(new URL("../" + path, import.meta.url), "utf8");
const routes = [
  ["actuals", "src/routes/command/actuals.tsx", "listMonthlyActuals"],
  ["financial-cockpit", "src/routes/command/financial-cockpit.tsx", "getOperatingPlanState"],
  ["quality", "src/routes/command/quality.tsx", "listQualityAuthority"],
  ["assurance", "src/routes/command/ibpe-operating-workspace_.assurance.tsx", "getVibpeAssurancePageData"],
];

for (const [name, path, authoritativeGetter] of routes) {
  test(name + " protects canonical evidence while serving low-CPU SSR shell", () => {
    const source = read(path);
    assert.match(source, /useEffect\(/, "client must load canonical authority after hydration");
    assert.match(source, /data-route-readiness="loading"/);
    assert.match(source, /data-route-readiness="ready"/);
    assert.match(source, /data-route-readiness="error"/);
    assert.ok(source.includes(authoritativeGetter + "()"), "canonical reader must remain available");
    const routeMatch = source.match(/createFileRoute\([\s\S]*?\)\(\{([\s\S]*?)component:/);
    assert.ok(routeMatch, "must retain protected route");
    assert.ok(!routeMatch[1].includes(authoritativeGetter + "()"), "SSR must not execute canonical DB reader");
  });
}

test("production browser and SLO probes must await genuine data readiness", () => {
  const smoke = read("scripts/vyndi-production-playwright-smoke.mjs");
  const slo = read("scripts/vyndi-observability-slo.mjs");
  for (const script of [smoke, slo]) {
    for (const route of [
      "/command/actuals",
      "/command/financial-cockpit",
      "/command/quality",
      "/command/ibpe-operating-workspace/assurance",
    ]) assert.ok(script.includes(route), "missing readiness route " + route);
    assert.match(script, /data-route-readiness="ready"/);
    assert.match(script, /waitFor\(/);
  }
  assert.match(slo, /assert\.equal\(aggregate\.failures, 0/);
  assert.match(slo, /aggregate\.p95Ms/);
  assert.match(slo, /aggregate\.p99Ms/);
});

test("protected Command tree defers heavy React SSR while retaining server-side role checks", () => {
  const source = read("src/routes/command/route.tsx");
  const declaration = source.match(/createFileRoute\("\/command"\)\(\{([\s\S]*?)component: CommandRoot/);
  assert.ok(declaration, "must preserve protected parent route");
  assert.match(declaration[1], /ssr:\s*"data-only"/, "render Command React UI on client, keep server beforeLoad");
  assert.match(declaration[1], /beforeLoad:\s*async/, "access control must still run on server");
  assert.match(declaration[1], /await getCommandRole\(\)/, "server-side session/role check must remain");
  assert.match(declaration[1], /throw redirect\(/, "unauthenticated users must still be redirected");
  assert.doesNotMatch(declaration[1], /ssr:\s*false/, "do not bypass server-side route authorization");
});
