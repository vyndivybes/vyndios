import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const route=readFileSync(new URL("../src/routes/api/engineering/r3.ts",import.meta.url),"utf8");

test("R3 control-plane API is authenticated, read-only and composes A-E",()=>{
  assert.match(route,/requireBusinessActor\("view"\)/);
  for(const symbol of [
    "compileVedmAuthorityGraph","createVedmR3aSeed","compileEngineeringReleasePacket",
    "reasonWithVedmAuthority","compileDigitalProductThread"
  ]) assert.match(route,new RegExp(symbol));
  assert.doesNotMatch(route,/POST\s*:/);
  assert.doesNotMatch(route,/PUT\s*:/);
  assert.doesNotMatch(route,/DELETE\s*:/);
});

test("R3 control-plane reads append-only engineering evidence without converting it into authority",()=>{
  assert.match(route,/vyndi_engineering_evidence_receipts/);
  assert.match(route,/HUMAN_CONFIGURATION_AUTHORITY/);
  assert.match(route,/mutationAuthority:\s*"HUMAN_APPROVAL_REQUIRED"/);
});
