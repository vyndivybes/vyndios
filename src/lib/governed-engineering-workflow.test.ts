import assert from "node:assert/strict";
import test from "node:test";
import {
  applyEngineeringWaiver,
  evaluateEngineeringWorkflowTransition,
  type GovernedEngineeringWorkflow,
} from "./governed-engineering-workflow.ts";

const workflow: GovernedEngineeringWorkflow = {
  id: "WF-EK75-001",
  subjectId: "VEDM-301-R539-EK75",
  state: "draft",
  createdBy: "user-maker",
  criticality: "release",
  blockers: [],
  supersedesId: null,
  successorId: null,
};

test("R3-B enforces maker/checker separation for approval", () => {
  const submitted = evaluateEngineeringWorkflowTransition(workflow, {
    actorUserId: "user-maker",
    actorAuthority: "engineering_authority",
    toState: "pending_approval",
    reason: "Ready for independent review",
  });
  assert.equal(submitted.allowed, true);

  const selfApproval = evaluateEngineeringWorkflowTransition(
    { ...workflow, state: "pending_approval" },
    {
      actorUserId: "user-maker",
      actorAuthority: "engineering_authority",
      toState: "approved",
      reason: "Approve my own change",
    },
  );
  assert.equal(selfApproval.allowed, false);
  assert.equal(selfApproval.code, "SOD_MAKER_CHECKER");
});

test("R3-B permits independent approval but reserves release for configuration authority", () => {
  const approval = evaluateEngineeringWorkflowTransition(
    { ...workflow, state: "pending_approval" },
    {
      actorUserId: "user-checker",
      actorAuthority: "engineering_authority",
      toState: "approved",
      reason: "Independent engineering approval",
    },
  );
  assert.equal(approval.allowed, true);

  const engineeringRelease = evaluateEngineeringWorkflowTransition(
    { ...workflow, state: "approved" },
    {
      actorUserId: "user-checker",
      actorAuthority: "engineering_authority",
      toState: "released",
      reason: "Release",
    },
  );
  assert.equal(engineeringRelease.allowed, false);
  assert.equal(engineeringRelease.code, "CONFIGURATION_AUTHORITY_REQUIRED");

  const configurationRelease = evaluateEngineeringWorkflowTransition(
    { ...workflow, state: "approved" },
    {
      actorUserId: "config-authority",
      actorAuthority: "configuration_authority",
      toState: "released",
      reason: "Controlled release",
    },
  );
  assert.equal(configurationRelease.allowed, true);
});

test("R3-B VIBPE can never mutate engineering lifecycle", () => {
  const decision = evaluateEngineeringWorkflowTransition(workflow, {
    actorUserId: "vibpe",
    actorAuthority: "vibpe",
    toState: "pending_approval",
    reason: "Autonomous proposal",
  });
  assert.equal(decision.allowed, false);
  assert.equal(decision.code, "HUMAN_APPROVAL_REQUIRED");
});

test("R3-B blocks release while blockers remain", () => {
  const decision = evaluateEngineeringWorkflowTransition(
    { ...workflow, state: "approved", blockers: ["G5-FEA"] },
    {
      actorUserId: "config-authority",
      actorAuthority: "configuration_authority",
      toState: "released",
      reason: "Release despite open FEA",
    },
  );
  assert.equal(decision.allowed, false);
  assert.equal(decision.code, "OPEN_BLOCKERS");
});

test("R3-B critical release gates cannot be waived and ordinary blockers need independent evidence-backed waiver", () => {
  const critical = applyEngineeringWaiver({ ...workflow, blockers: ["G5-FEA"] }, {
    blockerId: "G5-FEA",
    blockerClass: "release_critical",
    requestedBy: "user-maker",
    approvedBy: "user-checker",
    reason: "Skip structural verification",
    evidenceRef: "TEST",
    expiresAt: "2026-10-10",
  });
  assert.equal(critical.allowed, false);
  assert.equal(critical.code, "NON_WAIVABLE_BLOCKER");

  const ordinary = applyEngineeringWaiver(
    { ...workflow, blockers: ["DOC-METADATA"] },
    {
      blockerId: "DOC-METADATA",
      blockerClass: "administrative",
      requestedBy: "user-maker",
      approvedBy: "user-checker",
      reason: "Temporary metadata correction window",
      evidenceRef: "EVID-123",
      expiresAt: "2026-10-10",
    },
  );
  assert.equal(ordinary.allowed, true);
  assert.deepEqual(ordinary.remainingBlockers, []);
});

test("R3-B supersession is one-way and requires an explicit successor", () => {
  const missingSuccessor = evaluateEngineeringWorkflowTransition(
    { ...workflow, state: "released" },
    {
      actorUserId: "config-authority",
      actorAuthority: "configuration_authority",
      toState: "superseded",
      reason: "Replace revision",
    },
  );
  assert.equal(missingSuccessor.allowed, false);
  assert.equal(missingSuccessor.code, "SUCCESSOR_REQUIRED");

  const supersede = evaluateEngineeringWorkflowTransition(
    { ...workflow, state: "released", successorId: "VEDM-301-R540" },
    {
      actorUserId: "config-authority",
      actorAuthority: "configuration_authority",
      toState: "superseded",
      reason: "Controlled successor released",
    },
  );
  assert.equal(supersede.allowed, true);

  const resurrect = evaluateEngineeringWorkflowTransition(
    { ...workflow, state: "superseded", successorId: "VEDM-301-R540" },
    {
      actorUserId: "config-authority",
      actorAuthority: "configuration_authority",
      toState: "released",
      reason: "Restore old revision",
    },
  );
  assert.equal(resurrect.allowed, false);
  assert.equal(resurrect.code, "INVALID_TRANSITION");
});
