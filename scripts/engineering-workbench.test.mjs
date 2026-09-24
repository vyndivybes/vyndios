import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = async (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("engineering workbench uses governed Vayu/VYNDI identity and controlled revisions", async () => {
  const ui = await source("src/components/engineering-workbench.tsx");
  const model = await source("src/lib/engineering-workbench.ts");

  assert.match(ui, /Vāyú Shastr Pvt Ltd · VYNDI OS/);
  assert.match(ui, /VAEA Engineering Workbench/);
  assert.doesNotMatch(ui, />VELOXIS</);
  assert.match(model, /5\.3\.8/);
  assert.match(model, /5\.3\.9 E-K75/);
  assert.match(model, /5\.4 FK75/);
});

test("engineering workbench invalidates downstream evidence after geometry edits", async () => {
  const ui = await source("src/components/engineering-workbench.tsx");

  assert.match(ui, /geometryDirty/);
  assert.match(ui, /Stale-result interlock/);
  assert.match(ui, /Clearance, mesh, FEA, laminate, manufacturing and validation evidence must be regenerated or re-verified/);
  assert.match(ui, /No native solver run attached/);
  assert.match(ui, /FEA blocked/);
});

test("engineering workbench carries controlled interfaces and material qualification gates", async () => {
  const ui = await source("src/components/engineering-workbench.tsx");
  const model = await source("src/lib/engineering-workbench.ts");

  assert.match(model, /T47i internal, 85\.5 mm shell width/);
  assert.match(model, /IS41 upper \/ IS52 lower/);
  assert.match(model, /Ø27\.2 mm seatpost/);
  assert.match(model, /700C wheel/);
  assert.match(model, /MATERIAL_GATES/);
  assert.match(ui, /MATERIAL-01 qualification remains open/);
  assert.match(ui, /Published fibre data is not being treated as laminate structural allowables/);
});
