import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const route = await readFile(new URL("../src/routes/command/quality.tsx", import.meta.url), "utf8");
const deck = await readFile(new URL("../src/components/quality-assurance-deck.tsx", import.meta.url), "utf8").catch(() => "");
const smoke = await readFile(new URL("./vyndi-production-playwright-smoke.mjs", import.meta.url), "utf8");

test("Quality cold-entry loader keeps only canonical Quality authority", () => {
  const start = route.indexOf('createFileRoute("/command/quality")');
  const end = route.indexOf("component: Quality", start);
  assert.ok(start >= 0 && end > start);
  const loader = route.slice(start, end);
  assert.match(loader, /listQualityAuthority\(\)/);
  assert.doesNotMatch(loader, /listIsoQualityCompliance\(\)|getManufacturingQualityIntelligence\(\)/);
});

test("ISO compliance and Manufacturing Quality intelligence remain governed on-demand", () => {
  assert.match(route, /QualityAssuranceDeck/);
  assert.match(deck, /listIsoQualityCompliance/);
  assert.match(deck, /getManufacturingQualityIntelligence/);
  assert.match(deck, /ManufacturingQualityIntelligencePanel/);
  assert.match(deck, /ISO Standards Register/);
  assert.match(deck, /ISO 4210 Frame & Fork Verification/);
  assert.match(deck, /Product Conformity & Production Release/);
  assert.match(deck, /onToggle/);
  assert.doesNotMatch(deck, /useEffect\s*\(/);
});

test("exact-SHA smoke captures route 5xx evidence instead of status-only failure", () => {
  assert.match(smoke, /routeNetworkEvidence/);
  assert.match(smoke, /responseBody/);
  assert.match(smoke, /cfRay/);
  assert.match(smoke, /durationMs/);
});
