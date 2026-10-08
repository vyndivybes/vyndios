import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const guide = read("src/lib/guided-work.ts");
const panel = read("src/components/guided-work-panel.tsx");
const shell = read("src/components/command-shell-v2.tsx");
const copilot = read("src/components/ibpe-copilot.tsx");
const manual = read("src/routes/command/user-manual.tsx");
const pkg = JSON.parse(read("package.json"));

test("Guided Work defines advisory role-aware operating playbooks", () => {
  for (const department of [
    "Management",
    "Commercial",
    "Planning",
    "Engineering",
    "Procurement",
    "Inventory",
    "Production",
    "Quality",
    "Finance",
    "Administration",
    "Governance",
  ]) assert.match(guide, new RegExp(`department: "${department}"`));

  assert.match(guide, /advisoryOnly:\s*true/);
  assert.match(guide, /Guidance never grants approval or transaction authority/);
  assert.match(guide, /resolveGuidedWork/);
  assert.match(guide, /canAccessRoute/);
});

test("Guided Work provides optional Learn and Work modes with governed next-step guidance", () => {
  assert.match(panel, /VYNDI Guided Work/);
  assert.match(panel, /Learn mode/);
  assert.match(panel, /Work mode/);
  assert.match(panel, /Next step/);
  assert.match(panel, /Why\?/);
  assert.match(panel, /Procedure/);
  assert.match(panel, /Ask VYNDI/);
  assert.match(panel, /localStorage/);
  assert.match(panel, /vyndi:copilot-open/);
});

test("Guided Work desktop panel is a movable floating window with remembered safe position", () => {
  assert.match(panel, /POSITION_KEY/);
  assert.match(panel, /vyndi:guided-work:position/);
  assert.match(panel, /onPointerDown/);
  assert.match(panel, /onPointerMove/);
  assert.match(panel, /onPointerUp/);
  assert.match(panel, /setPointerCapture/);
  assert.match(panel, /clampPosition/);
  assert.match(panel, /window\.innerWidth/);
  assert.match(panel, /window\.innerHeight/);
  assert.match(panel, /cursor-move/);
  assert.match(panel, /touch-none/);
  assert.match(panel, /style=\{floatingStyle\}/);
  assert.match(panel, /sm:right-auto/);
});

test("Guided Work is mounted once at shell level and receives the live role", () => {
  const imports = shell.match(/import \{ GuidedWorkPanel \} from "@\/components\/guided-work-panel";/g) ?? [];
  const mounts = shell.match(/<GuidedWorkPanel role=\{role\} \/>/g) ?? [];
  assert.equal(imports.length, 1);
  assert.equal(mounts.length, 1);
});

test("Ask VYNDI opens the existing governed Co-Pilot with a contextual question", () => {
  assert.match(copilot, /vyndi:copilot-open/);
  assert.match(copilot, /setOpen\(true\)/);
  assert.match(copilot, /setQuestion/);
  assert.match(copilot, /Advisory only/);
});

test("User Manual documents Guided Work and preserves the authority boundary", () => {
  assert.match(manual, /Revision 1\.5/);
  assert.match(manual, /Guided Work Mode/);
  assert.match(manual, /Learn Mode/);
  assert.match(manual, /Work Mode/);
  assert.match(manual, /Guidance never replaces RBAC, maker\/checker, evidence or explicit human approval/);
});

test("Guided Work regression is part of the canonical suite and has a focused command", () => {
  assert.match(pkg.scripts.test, /scripts\/guided-work-mode\.test\.mjs/);
  assert.equal(pkg.scripts["test:guided-work"], "node --test scripts/guided-work-mode.test.mjs");
});

test("Guide defaults to an RBAC-filtered global catalogue rather than three local steps", () => {
  assert.match(panel, /WORKSPACE_NAVIGATION/);
  assert.match(panel, /canAccessRoute\(role, item.to\)/);
  assert.match(panel, /All Features/);
  assert.match(panel, /On this page/);
  assert.match(panel, /Search VYNDI features/);
  assert.match(panel, /filteredFeatures\.map/);
  assert.match(panel, /aria-label="Open VYNDI Guided Work"/);
});

test("Guide preserves the existing VIBPE boundary and a mobile-safe floating launcher", () => {
  assert.match(panel, /vyndi:copilot-open/);
  assert.match(panel, /safe-area-inset-bottom/);
  assert.match(panel, /role="dialog"/);
  assert.match(panel, /aria-modal="false"/);
  assert.match(panel, /onKeyDown/);
});
