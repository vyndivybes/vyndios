import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read=(path)=>readFile(new URL(`../${path}`,import.meta.url),"utf8");

test("lean active CI carries enterprise assurance gates without reactivating the heavy workflow archive",async()=>{
  const [dev,prod,pkgRaw]=await Promise.all([
    read(".github/workflows/dev-ci.yml"),
    read(".github/workflows/production-assurance.yml"),
    read("package.json"),
  ]);
  const pkg=JSON.parse(pkgRaw);

  for(const script of ["test:migration-lineage","test:mes:golden","test:h4:iam","test:h2:recovery:expanded","test:scanner","build:bundle"]){
    assert.ok(pkg.scripts[script],`missing package assurance script: ${script}`);
  }

  assert.match(dev,/npm run test:migration-lineage/);
  assert.match(dev,/npm run test:mes:golden/);
  assert.match(dev,/npm run test:h4:iam/);
  assert.match(dev,/npm run test:h2:recovery:expanded/);
  assert.match(dev,/npm run test:scanner/);
  assert.match(dev,/npm run build:bundle/);

  assert.match(prod,/schedule:/);
  assert.match(prod,/workflow_dispatch:/);
  assert.match(prod,/api\/runtime\/health/);
  assert.match(prod,/npm run test:browser:production/);
  assert.match(prod,/npm run observe:slo/);
  assert.match(prod,/npm run test:ux:production/);
  assert.match(prod,/VYNDI_TEST_EXPECTED_SHA/);
});

test("operational H4 and recovery evidence remain explicit post-deploy controls rather than fake source-code claims",async()=>{
  const doc=await read("docs/ASSURANCE-CLOSURE-01.md");
  assert.match(doc,/first real H4 access certification/i);
  assert.match(doc,/register a real recovery checkpoint/i);
  assert.match(doc,/isolated restore drill/i);
  assert.match(doc,/must not be claimed complete from source code alone/i);
});
