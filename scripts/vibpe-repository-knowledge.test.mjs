import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const repositoryKnowledge = await readFile(new URL("../src/lib/vibpe-repository-knowledge.ts", import.meta.url), "utf8");
const retrieval = await readFile(new URL("../src/lib/vibpe-knowledge-retrieval.ts", import.meta.url), "utf8");
const copilot2 = await readFile(new URL("../src/lib/vibpe-copilot-2.ts", import.meta.url), "utf8");
const productionCopilot = await readFile(new URL("../src/lib/ibpe-copilot.ts", import.meta.url), "utf8");
const copilotUi = await readFile(new URL("../src/components/ibpe-copilot.tsx", import.meta.url), "utf8");
const knowledgeUi = await readFile(new URL("../src/routes/command/knowledge.tsx", import.meta.url), "utf8");
const manual = await readFile(new URL("../src/routes/command/user-manual.tsx", import.meta.url), "utf8");

test("cross-repository knowledge is pinned to reviewed source commits", () => {
  for (const repo of [
    "vayu-shastr/veloxis-engineering-design-manual",
    "vayu-shastr/adv-vibpe",
    "vayu-shastr/vyndios",
  ]) assert.match(repositoryKnowledge, new RegExp(repo.replace("/", "\\/")));

  assert.match(repositoryKnowledge, /b874cde910ce462724b63bac6b7e7f79e7d68785/);
  assert.match(repositoryKnowledge, /3ca30a7891272870190b3f21340102451d7ff94b/);
  assert.match(repositoryKnowledge, /89de43701c16776a834b4ba67e38620d670160f7/);
  assert.match(repositoryKnowledge, /repositoryKnowledgeUrl/);
  assert.match(repositoryKnowledge, /VYNDI User Manual Rev 1\.4/);
  assert.match(repositoryKnowledge, /last independently audited main SHA/);
});

test("current VEDM authority wins over stale older geometry wording", () => {
  assert.match(repositoryKnowledge, /Rev 5\.3\.9 Candidate E-K75 as the CONTROLLING FRAME-GEOMETRY AUTHORITY/);
  assert.match(repositoryKnowledge, /Rev 5\.4 FK75[^\n]+NOT RELEASED/);
  assert.match(repositoryKnowledge, /VEL-PLY-2026 Rev 5\.4\.1/);
  assert.match(repositoryKnowledge, /native mesh-converged composite FEA/);
});

test("repository knowledge remains source-domain controlled rather than ERP mutation authority", () => {
  assert.match(repositoryKnowledge, /controlled-reference/);
  assert.match(repositoryKnowledge, /does not mutate ERP master data/);
  assert.match(copilot2, /CONTROLLED REPOSITORY REFERENCE/);
  assert.match(copilot2, /does not create a new approval, mutate ERP master data or bypass the owning release workflow/);
});

test("knowledge retrieval merges repository snapshots with governed Drive evidence", () => {
  assert.match(retrieval, /VIBPE_REPOSITORY_KNOWLEDGE/);
  assert.match(retrieval, /repositoryEvidence/);
  assert.match(retrieval, /sourceKind: "repository-snapshot"/);
  assert.match(retrieval, /const combined = \[\.\.\.repositoryEvidence\(\), \.\.\.driveEvidence\]/);
  assert.match(retrieval, /controlled-repository/);
  assert.match(retrieval, /current-operational/);
});

test("VIBPE exposes source repository and commit lineage to answer generation", () => {
  assert.match(copilot2, /Pinned repository lineage/);
  assert.match(productionCopilot, /sourceRepository: item\.sourceRepository/);
  assert.match(productionCopilot, /sourceCommit: item\.sourceCommit/);
  assert.match(productionCopilot, /commit-pinned repository snapshots \+ governed Drive references/);
});

test("optimizer guidance reflects the current governed ERP optimizer flow", () => {
  assert.match(copilot2, /Run\/refresh governed IBPE/);
  assert.match(copilot2, /immutable advanced-planning packet/);
  assert.match(copilot2, /Run governed HiGHS optimization/);
  assert.match(copilot2, /Outputs & Evidence, Assurance and Release Readiness/);
  assert.match(copilot2, /supplier economics are provisional\/test\/benchmark based/);
});

test("Co-Pilot and Knowledge UI expose cross-repository evidence", () => {
  assert.match(copilotUi, /Cross-repo knowledge/);
  assert.match(copilotUi, /sourceRepository/);
  assert.match(copilotUi, /sourceCommit\.slice\(0, 12\)/);
  assert.match(knowledgeUi, /Repository knowledge snapshots/);
  assert.match(knowledgeUi, /VIBPE_REPOSITORY_KNOWLEDGE/);
  assert.match(knowledgeUi, /repositoryKnowledgeUrl/);
});

test("User Manual Rev 1.4 documents cross-repository operating rules", () => {
  assert.match(manual, /Revision 1\.4/);
  assert.match(manual, /VIBPE Cross-Repository Knowledge & Authority/);
  assert.match(manual, /VEDM-301 Rev 5\.3\.9 Candidate E-K75/);
  assert.match(manual, /ADV VIBPE/);
  assert.match(manual, /Current snapshot baselines/);
});
