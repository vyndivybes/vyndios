import type {
  CompiledVedmAuthorityGraph,
  VedmAuthorityNode,
} from "./vedm-authority-graph.ts";

export type RuntimeProductThreadInput = {
  engineeringBaselineId?: string | null;
  bomRevisionId?: string | null;
  jobCardIds?: string[];
  qualityReleaseIds?: string[];
  shipmentIds?: string[];
};

export type DigitalThreadNodeKind =
  | "requirement"
  | "document_revision"
  | "engineering_object"
  | "evidence"
  | "release_gate"
  | "engineering_baseline"
  | "bom_revision"
  | "job_card"
  | "quality_release"
  | "shipment";

export type DigitalThreadNode = {
  id: string;
  kind: DigitalThreadNodeKind;
  title: string;
  current: boolean;
  sourceRef: string;
};

export type DigitalThreadEdge = {
  from: string;
  to: string;
  relation:
    | "SATISFIED_BY"
    | "CONTROLS"
    | "SUPERSEDES"
    | "DERIVES_FROM"
    | "VALIDATED_BY"
    | "REQUIRES"
    | "BLOCKED_BY"
    | "EVIDENCED_BY"
    | "BASELINED_AS"
    | "CONFIGURED_BY"
    | "EXECUTED_BY"
    | "RELEASED_BY"
    | "FULFILLED_BY";
};

export type DigitalThreadGap = {
  code:
    | "ENGINEERING_BASELINE_MISSING"
    | "BOM_REVISION_MISSING"
    | "JOB_CARD_MISSING"
    | "QUALITY_RELEASE_MISSING"
    | "SHIPMENT_MISSING";
  message: string;
};

export type DigitalProductThread = {
  sourceRepository: string;
  sourceCommit: string;
  nodeById: Map<string, DigitalThreadNode>;
  edges: DigitalThreadEdge[];
  gaps: DigitalThreadGap[];
};

function graphNodeCurrent(node: VedmAuthorityNode) {
  if (node.lifecycle === "superseded" || node.lifecycle === "historical") return false;
  if (node.kind === "document_revision") return node.lifecycle === "controlling" || node.lifecycle === "approved_reference";
  return true;
}

function toThreadNode(node: VedmAuthorityNode): DigitalThreadNode {
  return {
    id: node.id,
    kind: node.kind,
    title: node.title,
    current: graphNodeCurrent(node),
    sourceRef: node.sourceRef,
  };
}

function addRuntimeNode(
  nodeById: Map<string, DigitalThreadNode>,
  id: string,
  kind: DigitalThreadNodeKind,
  title: string,
  sourceRef: string,
) {
  nodeById.set(id, { id, kind, title, current: true, sourceRef });
}

function pushRuntimeChain(
  edges: DigitalThreadEdge[],
  fromIds: string[],
  toIds: string[],
  relation: DigitalThreadEdge["relation"],
) {
  if (!fromIds.length || !toIds.length) return;
  for (const from of fromIds) {
    for (const to of toIds) edges.push({ from, to, relation });
  }
}

export function compileDigitalProductThread(
  graph: CompiledVedmAuthorityGraph,
  runtime: RuntimeProductThreadInput,
): DigitalProductThread {
  const nodeById = new Map<string, DigitalThreadNode>();
  const edges: DigitalThreadEdge[] = [];
  const gaps: DigitalThreadGap[] = [];

  for (const node of graph.nodeById.values()) nodeById.set(node.id, toThreadNode(node));
  for (const edge of graph.edges) edges.push({ ...edge });

  const controllingId = graph.authorityByDomain.frame_geometry?.id ?? null;
  if (controllingId && nodeById.has("REQ-FRAME-GEOMETRY")) {
    edges.push({ from: "REQ-FRAME-GEOMETRY", to: controllingId, relation: "SATISFIED_BY" });
  }

  const baselineId = runtime.engineeringBaselineId?.trim() || null;
  if (baselineId) {
    addRuntimeNode(
      nodeById,
      baselineId,
      "engineering_baseline",
      "Released VYNDI engineering baseline",
      `VYNDI:engineering_baseline:${baselineId}`,
    );
    if (controllingId) edges.push({ from: controllingId, to: baselineId, relation: "BASELINED_AS" });
  } else {
    gaps.push({
      code: "ENGINEERING_BASELINE_MISSING",
      message: "No VYNDI engineering baseline is linked to the controlled VEDM authority.",
    });
  }

  const bomId = runtime.bomRevisionId?.trim() || null;
  if (bomId) {
    addRuntimeNode(nodeById, bomId, "bom_revision", "Controlled BOM revision", `VYNDI:bom_revision:${bomId}`);
    if (baselineId) edges.push({ from: baselineId, to: bomId, relation: "CONFIGURED_BY" });
  } else {
    gaps.push({
      code: "BOM_REVISION_MISSING",
      message: "No controlled BOM revision is linked to the engineering baseline.",
    });
  }

  const jobCards = [...new Set((runtime.jobCardIds ?? []).map((id) => id.trim()).filter(Boolean))].sort();
  if (!jobCards.length) {
    gaps.push({
      code: "JOB_CARD_MISSING",
      message: "No production job card is linked to the controlled BOM revision.",
    });
  }
  for (const id of jobCards) {
    addRuntimeNode(nodeById, id, "job_card", "Production job card", `VYNDI:job_card:${id}`);
  }
  if (bomId) pushRuntimeChain(edges, [bomId], jobCards, "EXECUTED_BY");

  const qualityReleases = [...new Set((runtime.qualityReleaseIds ?? []).map((id) => id.trim()).filter(Boolean))].sort();
  if (!qualityReleases.length) {
    gaps.push({
      code: "QUALITY_RELEASE_MISSING",
      message: "No serialized quality release is linked to the production execution.",
    });
  }
  for (const id of qualityReleases) {
    addRuntimeNode(nodeById, id, "quality_release", "Serialized quality release", `VYNDI:quality_release:${id}`);
  }
  pushRuntimeChain(edges, jobCards, qualityReleases, "RELEASED_BY");

  const shipments = [...new Set((runtime.shipmentIds ?? []).map((id) => id.trim()).filter(Boolean))].sort();
  if (!shipments.length) {
    gaps.push({
      code: "SHIPMENT_MISSING",
      message: "No shipment is linked to the released serialized product.",
    });
  }
  for (const id of shipments) {
    addRuntimeNode(nodeById, id, "shipment", "Posted shipment", `VYNDI:shipment:${id}`);
  }
  pushRuntimeChain(edges, qualityReleases, shipments, "FULFILLED_BY");

  return {
    sourceRepository: graph.sourceRepository,
    sourceCommit: graph.sourceCommit,
    nodeById,
    edges,
    gaps,
  };
}

function adjacency(thread: DigitalProductThread) {
  const map = new Map<string, string[]>();
  for (const edge of thread.edges) {
    if (!thread.nodeById.has(edge.from) || !thread.nodeById.has(edge.to)) continue;
    const list = map.get(edge.from) ?? [];
    list.push(edge.to);
    map.set(edge.from, list);
  }
  for (const list of map.values()) list.sort();
  return map;
}

export function traceDigitalProductThread(
  thread: DigitalProductThread,
  startNodeId: string,
  targetNodeId: string,
): DigitalThreadNode[] {
  if (!thread.nodeById.has(startNodeId) || !thread.nodeById.has(targetNodeId)) return [];
  if (startNodeId === targetNodeId) return [thread.nodeById.get(startNodeId)!];

  const nextById = adjacency(thread);
  const queue = [startNodeId];
  const seen = new Set(queue);
  const parent = new Map<string, string>();

  while (queue.length) {
    const current = queue.shift()!;
    for (const next of nextById.get(current) ?? []) {
      if (seen.has(next)) continue;
      seen.add(next);
      parent.set(next, current);
      if (next === targetNodeId) {
        const ids = [targetNodeId];
        let cursor = targetNodeId;
        while (cursor !== startNodeId) {
          cursor = parent.get(cursor)!;
          ids.push(cursor);
        }
        ids.reverse();
        return ids.map((id) => thread.nodeById.get(id)!);
      }
      queue.push(next);
    }
  }
  return [];
}

export function assessDigitalThreadImpact(
  thread: DigitalProductThread,
  changedNodeId: string,
) {
  if (!thread.nodeById.has(changedNodeId)) {
    return { changedNodeId, affectedNodeIds: [] as string[] };
  }
  const nextById = adjacency(thread);
  const queue = [changedNodeId];
  const seen = new Set(queue);
  const affected: string[] = [];

  while (queue.length) {
    const current = queue.shift()!;
    for (const next of nextById.get(current) ?? []) {
      if (seen.has(next)) continue;
      seen.add(next);
      affected.push(next);
      queue.push(next);
    }
  }
  return { changedNodeId, affectedNodeIds: affected };
}
