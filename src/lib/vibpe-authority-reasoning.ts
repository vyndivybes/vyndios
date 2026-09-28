import type {
  CompiledVedmAuthorityGraph,
  VedmAuthorityNode,
} from "./vedm-authority-graph.ts";

export type AuthorityAwareKnowledgeEvidence = {
  claimText: string;
  authority: "controlled-reference" | "advisory" | "unresolved";
  sourceRepository: string | null;
  sourceCommit: string | null;
  sourcePath: string | null;
};

export type VibpeAuthorityIssueCode =
  | "SUPERSEDED_PROMOTED_AS_CURRENT"
  | "DEVELOPMENT_PROMOTED_AS_RELEASE"
  | "STALE_OR_UNPINNED_SOURCE"
  | "MISSING_CURRENT_EVIDENCE"
  | "AUTHORITY_GRAPH_CONFLICT";

export type VibpeAuthorityIssue = {
  code: VibpeAuthorityIssueCode;
  message: string;
  sourcePath?: string | null;
};

export type VibpeAuthorityAssessment = {
  status: "aligned" | "contradiction" | "insufficient_evidence";
  releaseAuthority: false;
  controllingAuthorityId: string | null;
  blockingGateIds: string[];
  issues: VibpeAuthorityIssue[];
  impactNodeIds: string[];
  answerPrefix: string;
};

function downstreamImpact(
  graph: CompiledVedmAuthorityGraph,
  startId: string | null,
): VedmAuthorityNode[] {
  if (!startId || !graph.nodeById.has(startId)) return [];
  const adjacency = new Map<string, string[]>();
  for (const edge of graph.edges) {
    if (!graph.nodeById.has(edge.from) || !graph.nodeById.has(edge.to)) continue;
    const list = adjacency.get(edge.from) ?? [];
    list.push(edge.to);
    adjacency.set(edge.from, list);
  }
  for (const list of adjacency.values()) list.sort();

  const queue = [startId];
  const seen = new Set(queue);
  const result: VedmAuthorityNode[] = [];

  while (queue.length) {
    const current = queue.shift()!;
    for (const next of adjacency.get(current) ?? []) {
      if (seen.has(next)) continue;
      seen.add(next);
      const node = graph.nodeById.get(next);
      if (node) result.push(node);
      queue.push(next);
    }
  }
  return result;
}

function asksReleaseAuthority(question: string) {
  return /release|released|production|manufactur|tooling|series production|certif|can we build|can we make/i.test(question);
}

function claimPromotesR538(claim: string) {
  const text = claim.toLowerCase();
  return text.includes("5.3.8") && /(current|controlling|governing|master authority|released authority)/i.test(claim);
}

function claimPromotesFk75Release(claim: string) {
  const text = claim.toLowerCase();
  return /fk75/.test(text) && /(production released|released for production|manufacturing release|series production authority|tooling release)/.test(text);
}

export function evaluateVibpeAuthorityContext(
  question: string,
  evidence: AuthorityAwareKnowledgeEvidence[],
  graph: CompiledVedmAuthorityGraph,
): VibpeAuthorityAssessment {
  const issues: VibpeAuthorityIssue[] = [];
  const controllingAuthorityId = graph.authorityByDomain.frame_geometry?.id ?? null;

  if (!graph.valid || !controllingAuthorityId) {
    issues.push({
      code: "AUTHORITY_GRAPH_CONFLICT",
      message: "The controlled authority graph is invalid or has no unique current frame-geometry authority.",
    });
  }

  for (const item of evidence) {
    if (
      item.sourceRepository !== graph.sourceRepository ||
      item.sourceCommit !== graph.sourceCommit
    ) {
      issues.push({
        code: "STALE_OR_UNPINNED_SOURCE",
        sourcePath: item.sourcePath,
        message: "Engineering evidence is not pinned to the current VEDM authority snapshot.",
      });
    }
    if (claimPromotesR538(item.claimText)) {
      issues.push({
        code: "SUPERSEDED_PROMOTED_AS_CURRENT",
        sourcePath: item.sourcePath,
        message: "Rev 5.3.8 is superseded and cannot be promoted back to current authority.",
      });
    }
    if (claimPromotesFk75Release(item.claimText)) {
      issues.push({
        code: "DEVELOPMENT_PROMOTED_AS_RELEASE",
        sourcePath: item.sourcePath,
        message: "FK75 is development-only and cannot be represented as production release authority.",
      });
    }
  }

  if (
    asksReleaseAuthority(question) &&
    (
      evidence.length === 0 ||
      evidence.every((item) => item.authority !== "controlled-reference") ||
      !graph.releaseReady
    )
  ) {
    issues.push({
      code: "MISSING_CURRENT_EVIDENCE",
      message: "Current controlled release evidence is incomplete; no historical or advisory fallback is permitted.",
    });
  }

  const contradiction = issues.some((issue) =>
    issue.code === "SUPERSEDED_PROMOTED_AS_CURRENT" ||
    issue.code === "DEVELOPMENT_PROMOTED_AS_RELEASE" ||
    issue.code === "AUTHORITY_GRAPH_CONFLICT",
  );
  const insufficient = issues.some((issue) =>
    issue.code === "STALE_OR_UNPINNED_SOURCE" ||
    issue.code === "MISSING_CURRENT_EVIDENCE",
  );

  const current = controllingAuthorityId
    ? graph.nodeById.get(controllingAuthorityId)
    : undefined;
  const asksFk75 = /fk75/i.test(question);
  const answerPrefix = asksFk75
    ? "FK75 remains preferred front-end development and is not production released."
    : current
      ? `Current controlled frame-geometry authority: ${current.title}.`
      : "Current controlled engineering authority cannot be resolved.";

  return {
    status: contradiction ? "contradiction" : insufficient ? "insufficient_evidence" : "aligned",
    releaseAuthority: false,
    controllingAuthorityId,
    blockingGateIds: [...graph.blockingGateIds],
    issues,
    impactNodeIds: downstreamImpact(graph, controllingAuthorityId).map((node) => node.id),
    answerPrefix,
  };
}
