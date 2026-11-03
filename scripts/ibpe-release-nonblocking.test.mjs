import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const route = read("src/routes/command/ibpe-operating-workspace_.release.tsx");
const closure = read("src/lib/vibpe-optimizer-release-closure.ts");
const smoke = read("scripts/vyndi-production-playwright-smoke.mjs");

test("release evidence does not block SSR navigation", () => {
  assert.doesNotMatch(route, /loader:\s*async/);
  assert.doesNotMatch(route, /Route\.useLoaderData/);
  for (const state of ["loading", "ready", "error"]) {
    assert.ok(route.includes(`data-ibpe-release-state="${state}"`));
  }
  assert.ok(route.includes("useEffect"));
});

test("release closure remains authenticated and evidence-based", () => {
  assert.ok(route.includes("getVibpeOptimizerReleaseClosure()"));
  assert.ok(closure.includes('requireBusinessActor("view")'));
  assert.ok(closure.includes('verdict: gates.every'));
  assert.ok(route.includes('closure.verdict === "GREEN"'));
});

test("live production smoke requires a loaded governed release verdict", () => {
  assert.ok(smoke.includes('data-ibpe-release-state="ready"'));
  assert.ok(smoke.includes('data-ibpe-release-state="error"'));
});
