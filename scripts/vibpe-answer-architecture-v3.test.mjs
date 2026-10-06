import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const intent = await readFile(new URL("../src/lib/vibpe-intent.ts", import.meta.url), "utf8");
const copilot2 = await readFile(new URL("../src/lib/vibpe-copilot-2.ts", import.meta.url), "utf8");
const production = await readFile(new URL("../src/lib/ibpe-copilot.ts", import.meta.url), "utf8");
const governance = await readFile(new URL("../src/lib/vibpe-governance-queries.ts", import.meta.url), "utf8");
const ui = await readFile(new URL("../src/components/ibpe-copilot.tsx", import.meta.url), "utf8");
const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));

test("VIBPE v3 promotes Guided Work and Control Tower to first-class intents", () => {
  assert.match(intent, /"guided-work"/);
  assert.match(intent, /"control-tower"/);
  assert.match(intent, /guide me through|next governed step/i);
  assert.match(intent, /control\s+tower/i);
});

test("Guided Work answer uses the governed playbook instead of root-cause fallback", () => {
  assert.match(copilot2, /resolveGuidedWork/);
  assert.match(copilot2, /function guidedWorkAnswer/);
  assert.match(copilot2, /Next governed step:/);
  assert.match(copilot2, /Owning workspace:/);
  assert.match(copilot2, /Human authority:/);
  assert.match(copilot2, /role\?: CommandRole/);
});

test("Control Tower answer identifies blockers, owner and workspace", () => {
  assert.match(governance, /Control Tower blockers:/);
  assert.match(governance, /Owner \/ workspace:/);
  assert.match(governance, /control\s+tower/);
});

test("production answer keeps diagnostics separate from the direct answer", () => {
  assert.match(production, /diagnostics\?: string\[\]/);
  assert.match(production, /methodNote\?: string/);
  assert.match(production, /evidenceAssessment\?: string/);
  assert.doesNotMatch(production, /answer = \x60\$\{answer\}\\n\\n\$\{knowledgeRefreshWarning\}\x60/);
  assert.doesNotMatch(production, /answer \+= \x60\\n\\n\$\{describeVibpeMethod/);
});

test("UI renders diagnostics and advanced evidence as secondary disclosure", () => {
  assert.match(ui, /diagnostics\?: string\[\]/);
  assert.match(ui, /supplementaryEvidence\?: string\[\]/);
  assert.match(ui, /Evidence & diagnostics/);
  assert.match(ui, /<details/);
  assert.doesNotMatch(ui, /responseText = \x60\$\{responseText\}\\n\\n\$\{advanced\.text\}\x60/);
});

test("v3 architecture regression is wired into the canonical suite", () => {
  assert.match(pkg.scripts.test, /scripts\/vibpe-answer-architecture-v3\.test\.mjs/);
  assert.equal(pkg.scripts["test:vibpe-answer-v3"], "node --test scripts/vibpe-answer-architecture-v3.test.mjs");
});
