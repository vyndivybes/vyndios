import assert from "node:assert/strict";
import test from "node:test";
import { compileVedmAuthorityGraph, createVedmR3aSeed } from "./vedm-authority-graph.ts";
import {
  evaluateVibpeAuthorityContext,
  type AuthorityAwareKnowledgeEvidence,
} from "./vibpe-authority-reasoning.ts";

const graph = compileVedmAuthorityGraph(createVedmR3aSeed(), "2026-09-28");

test("R3-D flags a claim that promotes superseded Rev 5.3.8 as current authority", () => {
  const evidence: AuthorityAwareKnowledgeEvidence[] = [{
    claimText: "Rev 5.3.8 is the current controlling geometry.",
    authority: "controlled-reference",
    sourceRepository: graph.sourceRepository,
    sourceCommit: graph.sourceCommit,
    sourcePath: "historical.md",
  }];
  const result = evaluateVibpeAuthorityContext("What is the current frame geometry?", evidence, graph);
  assert.equal(result.status, "contradiction");
  assert.ok(result.issues.some((issue) => issue.code === "SUPERSEDED_PROMOTED_AS_CURRENT"));
  assert.equal(result.controllingAuthorityId, "VEDM-301-R539-EK75");
});

test("R3-D treats unpinned or wrong-commit engineering evidence as insufficient", () => {
  const result = evaluateVibpeAuthorityContext("Can we release FK75?", [{
    claimText: "FK75 is ready.",
    authority: "controlled-reference",
    sourceRepository: graph.sourceRepository,
    sourceCommit: "different-commit",
    sourcePath: "fk75.md",
  }], graph);
  assert.equal(result.status, "insufficient_evidence");
  assert.ok(result.issues.some((issue) => issue.code === "STALE_OR_UNPINNED_SOURCE"));
});

test("R3-D never converts development FK75 into release authority", () => {
  const result = evaluateVibpeAuthorityContext("Is FK75 production released?", [{
    claimText: "FK75 is preferred front-end development.",
    authority: "controlled-reference",
    sourceRepository: graph.sourceRepository,
    sourceCommit: graph.sourceCommit,
    sourcePath: "fk75.md",
  }], graph);
  assert.equal(result.releaseAuthority, false);
  assert.ok(result.blockingGateIds.includes("G5-FEA"));
  assert.match(result.answerPrefix, /development/i);
});

test("R3-D surfaces missing release evidence instead of answering with silent fallback", () => {
  const result = evaluateVibpeAuthorityContext("Can we manufacture the frame now?", [], graph);
  assert.equal(result.status, "insufficient_evidence");
  assert.equal(result.releaseAuthority, false);
  assert.ok(result.issues.some((issue) => issue.code === "MISSING_CURRENT_EVIDENCE"));
});

test("R3-D returns deterministic downstream impact paths for authority questions", () => {
  const result = evaluateVibpeAuthorityContext("What does E-K75 control?", [], graph);
  assert.ok(result.impactNodeIds.includes("OBJ-EK75-FRAME-GEOMETRY"));
  assert.ok(result.impactNodeIds.includes("G10-FORMAL-RELEASE"));
});
