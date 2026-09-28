import type { CompiledVedmAuthorityGraph } from "./vedm-authority-graph.ts";
import type { EngineeringActorAuthority, EngineeringWorkflowState } from "./governed-engineering-workflow.ts";

export type ReleaseEvidenceReceipt = {
  fingerprint: string;
  nodeId: string;
  sourceCommit: string;
  status: "accepted" | "rejected" | "superseded";
};

export type EngineeringReleaseInput = {
  graph: CompiledVedmAuthorityGraph;
  workflowState: EngineeringWorkflowState;
  actorAuthority: EngineeringActorAuthority;
  evidence: ReleaseEvidenceReceipt[];
};

export type EngineeringReleaseResult = {
  releasable: boolean;
  blockers: string[];
  releaseFingerprint: string;
  sourceCommit: string;
  acceptedEvidenceFingerprints: string[];
};

function fnv1a32(value: string) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

function canonicalEvidence(evidence: ReleaseEvidenceReceipt[]) {
  return [...evidence].sort((a, b) =>
    a.fingerprint.localeCompare(b.fingerprint) ||
    a.nodeId.localeCompare(b.nodeId) ||
    a.sourceCommit.localeCompare(b.sourceCommit) ||
    a.status.localeCompare(b.status),
  );
}

export function evaluateEngineeringRelease(
  input: EngineeringReleaseInput,
): EngineeringReleaseResult {
  const blockers: string[] = [];
  const fingerprints = input.evidence.map((row) => row.fingerprint);
  const duplicateFingerprints = fingerprints.filter(
    (fingerprint, index) => fingerprints.indexOf(fingerprint) !== index,
  );

  if (!input.graph.valid || !input.graph.releaseReady) {
    blockers.push("AUTHORITY_GRAPH_NOT_RELEASE_READY");
  }
  if (input.workflowState !== "approved") {
    blockers.push("WORKFLOW_NOT_APPROVED");
  }
  if (input.actorAuthority !== "configuration_authority") {
    blockers.push("CONFIGURATION_AUTHORITY_REQUIRED");
  }
  if (duplicateFingerprints.length > 0) {
    blockers.push("DUPLICATE_EVIDENCE_FINGERPRINT");
  }
  if (input.evidence.some((row) => row.sourceCommit !== input.graph.sourceCommit)) {
    blockers.push("STALE_EVIDENCE_SOURCE");
  }
  if (input.evidence.some((row) => row.status !== "accepted")) {
    blockers.push("NON_ACCEPTED_EVIDENCE");
  }

  const acceptedEvidenceFingerprints = canonicalEvidence(input.evidence)
    .filter((row) => row.status === "accepted")
    .map((row) => row.fingerprint);

  const fingerprintPayload = JSON.stringify({
    schema: input.graph.schema,
    sourceRepository: input.graph.sourceRepository,
    sourceCommit: input.graph.sourceCommit,
    asOfDate: input.graph.asOfDate,
    controllingFrameGeometry: input.graph.authorityByDomain.frame_geometry?.id ?? null,
    workflowState: input.workflowState,
    actorAuthority: input.actorAuthority,
    evidence: canonicalEvidence(input.evidence),
  });

  return {
    releasable: blockers.length === 0,
    blockers: [...new Set(blockers)],
    releaseFingerprint: `r3c-fnv1a32-${fnv1a32(fingerprintPayload)}`,
    sourceCommit: input.graph.sourceCommit,
    acceptedEvidenceFingerprints,
  };
}
