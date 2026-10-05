import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const route = await readFile(new URL("../src/routes/command/intelligence.tsx", import.meta.url), "utf8");
const deck = await readFile(new URL("../src/components/intelligence-advisory-deck.tsx", import.meta.url), "utf8").catch(() => "");
const responsive = await readFile(new URL("./operator-ux-hardening.mjs", import.meta.url), "utf8");

test("Product Intelligence entry loader keeps only core governed snapshot and readiness", () => {
  const start = route.indexOf('createFileRoute("/command/intelligence")');
  const end = route.indexOf("component: Intelligence", start);
  assert.ok(start >= 0 && end > start);
  const loader = route.slice(start, end);
  assert.match(loader, /getGovernedIntelligence\(\)/);
  assert.match(loader, /getReadinessIntelligenceState\(\)/);
  assert.doesNotMatch(loader, /getProgramForecastState\(\)|getMonteCarloState\(\)|getDecisionIntelligenceState\(\)|getEarnedValueState\(\)|getForecastLearningState\(\)/);
});

test("Product Intelligence advisory engines are explicit on-demand review sections", () => {
  for (const token of [
    "getProgramForecastState",
    "getMonteCarloState",
    "getDecisionIntelligenceState",
    "getEarnedValueState",
    "getForecastLearningState",
    "ForecastLearningPanel",
    "Program forecast",
    "Monte Carlo program uncertainty",
    "Decision Intelligence",
    "Earned Value",
  ]) {
    assert.ok(deck.includes(token), `missing on-demand intelligence token: ${token}`);
  }
  assert.match(deck, /onToggle/);
  assert.doesNotMatch(deck, /useEffect\s*\(/);
});

test("Product Intelligence evidence timestamps render deterministically across SSR and browser", () => {
  assert.match(route, /formatEvidenceTimestamp/);
  assert.doesNotMatch(route, /new Date\([^)]*\)\.toLocaleString/);
});

test("responsive SPA navigation proves it stayed in the same document", () => {
  assert.match(responsive, /__vyndiSpaSentinel/);
  assert.match(responsive, /SPA navigation hard-reloaded/);
});
