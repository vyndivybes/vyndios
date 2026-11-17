import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const retired = "/command/ibpe-operating-workspace/simulation";

test("retired four-order simulation page redirects to the governed optimizer", () => {
  const page = read("src/routes/command/ibpe-operating-workspace_.simulation.tsx");
  assert.match(page, /createFileRoute\("\/command\/ibpe-operating-workspace_\/simulation"\)/);
  assert.match(page, /throw redirect\(\{ to: "\/command\/ibpe-operating-workspace\/optimizer" \}\)/);
  assert.doesNotMatch(page, /getFourOrderSimulationPreview|solveFourOrderSimulation|runAcceptedFourOrderSimulation/);
});

test("retired simulation has no operational navigation or call-to-action", () => {
  for (const path of [
    "src/lib/operating-workflow.ts",
    "src/components/ibpe-workspace-projection.tsx",
    "src/routes/command/ibpe-operating-workspace.tsx",
    "src/routes/command/ibpe-operating-workspace_.optimizer.tsx",
    "src/routes/command/production.tsx",
  ]) {
    assert.doesNotMatch(read(path), /\/command\/ibpe-operating-workspace\/simulation/, path);
  }
});

test("governed HiGHS optimizer and production release controls are preserved", () => {
  const optimizer = read("src/routes/command/ibpe-operating-workspace_.optimizer.tsx");
  const authority = read("src/lib/ibpe-simulation-authority.ts");
  const production = read("src/routes/command/production.tsx");
  assert.match(optimizer, /runAdvancedOptimizerFromPacket/);
  assert.match(optimizer, /Purchases, production releases, stock movements, funding and sales commitments/);
  assert.match(authority, /SIMULATION_ONLY/);
  assert.match(production, /NOT RELEASED · Design confirmation required/);
});
