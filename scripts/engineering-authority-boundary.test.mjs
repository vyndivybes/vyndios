import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";

const route=await readFile(new URL("../src/routes/command/engineering.tsx",import.meta.url),"utf8");

test("VYNDI OS points engineering execution to the dedicated design repository",()=>{
  assert.match(route,/vayu-shastr\/design/);
  assert.match(route,/Do not duplicate:/);
  assert.match(route,/Rev 5\.3\.9 E-K75/);
  assert.match(route,/Rev 5\.4 FK75/);
  assert.doesNotMatch(route,/EngineeringWorkbench/);
});

test("VYNDI OS keeps engineering governance and traceability responsibilities",()=>{
  assert.match(route,/Govern:/);
  assert.match(route,/Trace:/);
  assert.match(route,/baselines, ECRs, gates and release evidence/);
});
