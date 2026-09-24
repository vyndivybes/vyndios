import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";

const route=await readFile(new URL("../src/routes/api/engineering/evidence.ts",import.meta.url),"utf8");
const migration=await readFile(new URL("../migrations/0092_engineering_evidence_receipts.sql",import.meta.url),"utf8");

test("engineering evidence route is authenticated, append-only, and schema-gated",()=>{
  assert.match(route,/requireBusinessActor\("edit"\)/);
  assert.match(route,/VYNDI_ENGINEERING_EVIDENCE_V1/);
  assert.match(route,/HUMAN_APPROVAL_REQUIRED/);
  assert.match(route,/invalid_fingerprint/);
  assert.match(route,/duplicate: true/);
});

test("engineering evidence route supports local governed workbench CORS",()=>{
  assert.match(route,/http:\/\/127\.0\.0\.1:8793/);
  assert.match(route,/access-control-allow-origin/);
  assert.match(route,/OPTIONS/);
});

test("engineering evidence ledger cannot be updated or deleted",()=>{
  assert.match(migration,/append-only/);
  assert.match(migration,/before update or delete/i);
  assert.match(migration,/fingerprint text not null unique/i);
  assert.match(migration,/payload_json jsonb not null/i);
});
