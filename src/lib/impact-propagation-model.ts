import type {
  CompiledVedmAuthorityGraph,
  VedmAuthorityEdge,
  VedmAuthorityNode,
  VedmAuthorityRelation,
} from "./vedm-authority-graph.ts";

export type ImpactAction =
  | "authority_review"
  | "requirement_review"
  | "refresh_required"
  | "evidence_suspect"
  | "release_gate_review";

export type ImpactedNode = {
  id: string;
  title: string;
  kind: VedmAuthorityNode["kind"];
  domain: string;
  lifecycle: VedmAuthorityNode["lifecycle"];
  depth: number;
  viaRelation: VedmAuthorityRelation;
  impactAction: ImpactAction;
  releaseRelevant: boolean;
  path: string[];
};

export type EngineeringImpactResult = {
  valid: boolean;
  sourceNodeId: string;
  sourceNode: VedmAuthorityNode | null;
  affectedNodes: ImpactedNode[];
  engineeringObjectIds: string[];
  evidenceIds: string[];
  releaseGateIds: string[];
  documentRevisionIds: string[];
  requirementIds: string[];
  evidenceSuspectCount: number;
  releaseGateReviewCount: number;
  issues: string[];
};

type Arc = {
  from: string;
  to: string;
  relation: VedmAuthorityRelation;
};

function impactArcs(edge: VedmAuthorityEdge): Arc[] {
  switch (edge.relation) {
    case "CONTROLS":
    case "EVIDENCED_BY":
    case "VALIDATED_BY":
    case "BLOCKED_BY":
      return [{ from: edge.from, to: edge.to, relation: edge.relation }];
    case "DERIVES_FROM":
      return [{ from: edge.to, to: edge.from, relation: edge.relation }];
    case "REQUIRES":
      return [
        { from: edge.from, to: edge.to, relation: edge.relation },
        { from: edge.to, to: edge.from, relation: edge.relation },
      ];
    case "SUPERSEDES":
      return [];
  }
}

function impactAction(node: VedmAuthorityNode): ImpactAction {
  if (node.kind === "release_gate") return "release_gate_review";
  if (node.kind === "evidence") return "evidence_suspect";
  if (node.kind === "engineering_object") return "refresh_required";
  if (node.kind === "requirement") return "requirement_review";
  return "authority_review";
}

export function analyzeEngineeringImpact(
  graph: CompiledVedmAuthorityGraph,
  sourceNodeId: string,
): EngineeringImpactResult {
  const sourceNode = graph.nodeById.get(sourceNodeId) ?? null;
  if (!sourceNode) {
    return {
      valid: false,
      sourceNodeId,
      sourceNode: null,
      affectedNodes: [],
      engineeringObjectIds: [],
      evidenceIds: [],
      releaseGateIds: [],
      documentRevisionIds: [],
      requirementIds: [],
      evidenceSuspectCount: 0,
      releaseGateReviewCount: 0,
      issues: [`Source node ${sourceNodeId} is not present in the controlled authority graph.`],
    };
  }

  const adjacency = new Map<string, Arc[]>();
  for (const edge of graph.edges) {
    for (const arc of impactArcs(edge)) {
      if (!graph.nodeById.has(arc.from) || !graph.nodeById.has(arc.to)) continue;
      const list = adjacency.get(arc.from) ?? [];
      list.push(arc);
      adjacency.set(arc.from, list);
    }
  }
  for (const arcs of adjacency.values()) {
    arcs.sort((a, b) => a.to.localeCompare(b.to) || a.relation.localeCompare(b.relation));
  }

  const queue: { id: string; depth: number; path: string[] }[] = [
    { id: sourceNodeId, depth: 0, path: [sourceNodeId] },
  ];
  const visited = new Set([sourceNodeId]);
  const affectedNodes: ImpactedNode[] = [];

  while (queue.length) {
    const current = queue.shift()!;
    for (const arc of adjacency.get(current.id) ?? []) {
      if (visited.has(arc.to)) continue;
      const node = graph.nodeById.get(arc.to);
      if (!node) continue;
      visited.add(arc.to);
      const path = [...current.path, arc.to];
      affectedNodes.push({
        id: node.id,
        title: node.title,
        kind: node.kind,
        domain: node.domain,
        lifecycle: node.lifecycle,
        depth: current.depth + 1,
        viaRelation: arc.relation,
        impactAction: impactAction(node),
        releaseRelevant:
          node.releaseEffect !== "none" ||
          node.kind === "release_gate" ||
          node.kind === "evidence",
        path,
      });
      queue.push({ id: arc.to, depth: current.depth + 1, path });
    }
  }

  affectedNodes.sort(
    (a, b) => a.depth - b.depth || a.id.localeCompare(b.id),
  );

  const idsFor = (kind: VedmAuthorityNode["kind"]) =>
    affectedNodes.filter((node) => node.kind === kind).map((node) => node.id);

  const evidenceIds = idsFor("evidence");
  const releaseGateIds = idsFor("release_gate");

  return {
    valid: true,
    sourceNodeId,
    sourceNode,
    affectedNodes,
    engineeringObjectIds: idsFor("engineering_object"),
    evidenceIds,
    releaseGateIds,
    documentRevisionIds: idsFor("document_revision"),
    requirementIds: idsFor("requirement"),
    evidenceSuspectCount: evidenceIds.length,
    releaseGateReviewCount: releaseGateIds.length,
    issues: affectedNodes.length
      ? []
      : ["No downstream impact relationship is currently represented for this source node. Graph coverage may need extension before broader conclusions are drawn."],
  };
}
