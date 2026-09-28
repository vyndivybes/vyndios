export type VedmAuthorityNodeKind =
  | "requirement"
  | "document_revision"
  | "engineering_object"
  | "evidence"
  | "release_gate";

export type VedmAuthorityLifecycle =
  | "controlling"
  | "development"
  | "superseded"
  | "historical"
  | "frozen"
  | "approved_reference"
  | "evidence"
  | "gate";

export type VedmAuthorityRelation =
  | "CONTROLS"
  | "SUPERSEDES"
  | "DERIVES_FROM"
  | "VALIDATED_BY"
  | "REQUIRES"
  | "BLOCKED_BY"
  | "EVIDENCED_BY";

export type VedmReleaseEffect = "none" | "supports_release" | "release_authority";
export type VedmGateStatus = "open" | "partial" | "closed";
export type VedmEvidenceState = "sufficient" | "insufficient" | "not_applicable";

export type VedmAuthorityNode = {
  id: string;
  kind: VedmAuthorityNodeKind;
  domain: string;
  title: string;
  revision?: string;
  lifecycle: VedmAuthorityLifecycle;
  effectiveFrom?: string;
  effectiveTo?: string;
  sourceRef: string;
  releaseEffect: VedmReleaseEffect;
  gateStatus?: VedmGateStatus;
  evidenceState?: VedmEvidenceState;
  requiredEvidenceIds?: string[];
};

export type VedmAuthorityEdge = {
  from: string;
  to: string;
  relation: VedmAuthorityRelation;
};

export type VedmAuthoritySeed = {
  schema: "VYNDI_VEDM_AUTHORITY_GRAPH_V1";
  sourceRepository: string;
  sourceCommit: string;
  nodes: VedmAuthorityNode[];
  edges: VedmAuthorityEdge[];
};

export type VedmAuthorityIssue = {
  severity: "error" | "warning" | "blocker";
  code:
    | "DUPLICATE_AUTHORITY_NODE"
    | "BROKEN_AUTHORITY_EDGE"
    | "INVALID_EFFECTIVITY"
    | "MULTIPLE_CONTROLLING_AUTHORITIES"
    | "NO_CONTROLLING_AUTHORITY"
    | "INSUFFICIENT_EVIDENCE"
    | "RELEASE_GATE_OPEN";
  nodeId?: string;
  domain?: string;
  message: string;
};

export type CompiledVedmAuthorityGraph = {
  schema: VedmAuthoritySeed["schema"];
  sourceRepository: string;
  sourceCommit: string;
  asOfDate: string;
  valid: boolean;
  releaseReady: boolean;
  nodeById: Map<string, VedmAuthorityNode>;
  authorityByDomain: Record<string, VedmAuthorityNode | undefined>;
  blockingGateIds: string[];
  issues: VedmAuthorityIssue[];
  edges: VedmAuthorityEdge[];
};

type AuthorityMutationAction =
  | "prepare_change"
  | "impact_assess"
  | "approve"
  | "make_effective"
  | "supersede"
  | "release";

type AuthorityActorType = "vibpe" | "human_engineering_authority" | "configuration_authority";

export type AuthorityMutationRequest = {
  actorType: AuthorityActorType;
  action: AuthorityMutationAction;
  targetNodeId: string;
};

export type AuthorityMutationDecision = {
  allowed: boolean;
  reason: "ALLOWED" | "HUMAN_APPROVAL_REQUIRED" | "CONFIGURATION_AUTHORITY_REQUIRED";
};

export const VEDM_R3A_SOURCE_REPOSITORY = "vayu-shastr/veloxis-engineering-design-manual";
export const VEDM_R3A_SOURCE_COMMIT = "9ef41eb8afbc75429013bfd73133957ddccf3834";

const CONTROLLED_DOMAINS = new Set(["frame_geometry"]);

function parseDate(value: string | undefined) {
  if (!value) return undefined;
  const parsed = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function isEffective(node: VedmAuthorityNode, asOf: number) {
  const from = parseDate(node.effectiveFrom);
  const to = parseDate(node.effectiveTo);
  if (node.effectiveFrom && from === undefined) return false;
  if (node.effectiveTo && to === undefined) return false;
  if (from !== undefined && asOf < from) return false;
  if (to !== undefined && asOf > to) return false;
  return true;
}

function pushIssue(issues: VedmAuthorityIssue[], issue: VedmAuthorityIssue) {
  issues.push(issue);
}

export function compileVedmAuthorityGraph(
  seed: VedmAuthoritySeed,
  asOfDate: string,
): CompiledVedmAuthorityGraph {
  const issues: VedmAuthorityIssue[] = [];
  const nodeById = new Map<string, VedmAuthorityNode>();
  const asOf = parseDate(asOfDate);

  if (asOf === undefined) {
    pushIssue(issues, {
      severity: "error",
      code: "INVALID_EFFECTIVITY",
      message: `Invalid authority graph as-of date: ${asOfDate}.`,
    });
  }

  for (const node of seed.nodes) {
    if (nodeById.has(node.id)) {
      pushIssue(issues, {
        severity: "error",
        code: "DUPLICATE_AUTHORITY_NODE",
        nodeId: node.id,
        domain: node.domain,
        message: `Authority node ${node.id} is duplicated.`,
      });
      continue;
    }
    if (
      (node.effectiveFrom && parseDate(node.effectiveFrom) === undefined) ||
      (node.effectiveTo && parseDate(node.effectiveTo) === undefined) ||
      (node.effectiveFrom &&
        node.effectiveTo &&
        (parseDate(node.effectiveTo) ?? 0) < (parseDate(node.effectiveFrom) ?? 0))
    ) {
      pushIssue(issues, {
        severity: "error",
        code: "INVALID_EFFECTIVITY",
        nodeId: node.id,
        domain: node.domain,
        message: `Authority node ${node.id} has invalid effectivity.`,
      });
    }
    nodeById.set(node.id, node);
  }

  for (const edge of seed.edges) {
    if (!nodeById.has(edge.from) || !nodeById.has(edge.to)) {
      pushIssue(issues, {
        severity: "error",
        code: "BROKEN_AUTHORITY_EDGE",
        nodeId: !nodeById.has(edge.from) ? edge.from : edge.to,
        message: `Authority relationship ${edge.from} -[${edge.relation}]-> ${edge.to} references a missing node.`,
      });
    }
  }

  const authorityByDomain: Record<string, VedmAuthorityNode | undefined> = {};
  const domains = new Set(seed.nodes.map((node) => node.domain));

  for (const domain of domains) {
    const effectiveControlling =
      asOf === undefined
        ? []
        : seed.nodes.filter(
            (node) =>
              node.domain === domain &&
              node.kind === "document_revision" &&
              node.lifecycle === "controlling" &&
              isEffective(node, asOf),
          );

    if (effectiveControlling.length > 1) {
      pushIssue(issues, {
        severity: "error",
        code: "MULTIPLE_CONTROLLING_AUTHORITIES",
        domain,
        message: `Domain ${domain} has multiple effective controlling authorities: ${effectiveControlling
          .map((node) => node.id)
          .sort()
          .join(", ")}.`,
      });
      continue;
    }

    if (effectiveControlling.length === 1) {
      authorityByDomain[domain] = effectiveControlling[0];
    } else if (CONTROLLED_DOMAINS.has(domain)) {
      // Deliberately do not choose a superseded/development record as a fallback.
      pushIssue(issues, {
        severity: "blocker",
        code: "NO_CONTROLLING_AUTHORITY",
        domain,
        message: `Domain ${domain} has no effective controlling authority. Superseded and development records are not eligible substitutes.`,
      });
    }
  }

  const blockingGateIds: string[] = [];
  for (const node of seed.nodes) {
    if (node.kind !== "release_gate") continue;

    const evidenceIds = node.requiredEvidenceIds ?? [];
    for (const evidenceId of evidenceIds) {
      const evidence = nodeById.get(evidenceId);
      if (
        !evidence ||
        evidence.kind !== "evidence" ||
        evidence.evidenceState !== "sufficient"
      ) {
        pushIssue(issues, {
          severity: "blocker",
          code: "INSUFFICIENT_EVIDENCE",
          nodeId: node.id,
          domain: node.domain,
          message: `Release gate ${node.id} lacks sufficient current evidence ${evidenceId}. Historical or superseded evidence is not substituted.`,
        });
      }
    }

    if (node.gateStatus !== "closed") {
      blockingGateIds.push(node.id);
      pushIssue(issues, {
        severity: "blocker",
        code: "RELEASE_GATE_OPEN",
        nodeId: node.id,
        domain: node.domain,
        message: `Release gate ${node.id} is ${node.gateStatus ?? "open"} and blocks release readiness.`,
      });
    }
  }

  const valid = !issues.some((issue) => issue.severity === "error");
  const releaseReady =
    valid &&
    blockingGateIds.length === 0 &&
    !issues.some((issue) => issue.severity === "blocker") &&
    Boolean(authorityByDomain.frame_geometry);

  return {
    schema: seed.schema,
    sourceRepository: seed.sourceRepository,
    sourceCommit: seed.sourceCommit,
    asOfDate,
    valid,
    releaseReady,
    nodeById,
    authorityByDomain,
    blockingGateIds: [...blockingGateIds].sort(),
    issues,
    edges: [...seed.edges],
  };
}

export function traceAuthorityPath(
  graph: CompiledVedmAuthorityGraph,
  startNodeId: string,
  targetNodeId: string,
): VedmAuthorityNode[] {
  if (!graph.nodeById.has(startNodeId) || !graph.nodeById.has(targetNodeId)) return [];
  if (startNodeId === targetNodeId) return [graph.nodeById.get(startNodeId)!];

  const adjacency = new Map<string, string[]>();
  for (const edge of graph.edges) {
    if (!graph.nodeById.has(edge.from) || !graph.nodeById.has(edge.to)) continue;
    const next = adjacency.get(edge.from) ?? [];
    next.push(edge.to);
    adjacency.set(edge.from, next);
  }
  for (const next of adjacency.values()) next.sort();

  const queue: string[] = [startNodeId];
  const visited = new Set([startNodeId]);
  const parent = new Map<string, string>();

  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const next of adjacency.get(current) ?? []) {
      if (visited.has(next)) continue;
      visited.add(next);
      parent.set(next, current);
      if (next === targetNodeId) {
        const ids = [targetNodeId];
        let cursor = targetNodeId;
        while (cursor !== startNodeId) {
          cursor = parent.get(cursor)!;
          ids.push(cursor);
        }
        ids.reverse();
        return ids.map((id) => graph.nodeById.get(id)!);
      }
      queue.push(next);
    }
  }

  return [];
}

export function evaluateAuthorityMutation(
  request: AuthorityMutationRequest,
): AuthorityMutationDecision {
  if (request.actorType === "vibpe") {
    if (request.action === "prepare_change" || request.action === "impact_assess") {
      return { allowed: true, reason: "ALLOWED" };
    }
    return { allowed: false, reason: "HUMAN_APPROVAL_REQUIRED" };
  }

  if (
    request.actorType === "human_engineering_authority" &&
    request.action === "release"
  ) {
    return { allowed: false, reason: "CONFIGURATION_AUTHORITY_REQUIRED" };
  }

  return { allowed: true, reason: "ALLOWED" };
}

export function createVedmR3aSeed(): VedmAuthoritySeed {
  const sourceRepository = "vayu-shastr/veloxis-engineering-design-manual";
  const sourceCommit = "9ef41eb8afbc75429013bfd73133957ddccf3834";

  return {
    schema: "VYNDI_VEDM_AUTHORITY_GRAPH_V1",
    sourceRepository,
    sourceCommit,
    nodes: [
      {
        id: "VEDM-301-R539-EK75",
        kind: "document_revision",
        domain: "frame_geometry",
        title: "VEDM-301 Rev 5.3.9 Candidate E-K75",
        revision: "5.3.9 E-K75",
        lifecycle: "controlling",
        effectiveFrom: "2026-09-20",
        sourceRef: `${sourceRepository}@${sourceCommit}:VEDM-301`,
        releaseEffect: "none",
      },
      {
        id: "VEDM-301-R538",
        kind: "document_revision",
        domain: "frame_geometry",
        title: "VEDM-301 Rev 5.3.8",
        revision: "5.3.8",
        lifecycle: "superseded",
        sourceRef: `${sourceRepository}@${sourceCommit}:VEDM-301-R538`,
        releaseEffect: "none",
      },
      {
        id: "VEDM-301-R54-FK75",
        kind: "document_revision",
        domain: "fork_front_end",
        title: "Rev 5.4 FK75 preferred VAEA fork/front-end development",
        revision: "5.4 FK75",
        lifecycle: "development",
        sourceRef: `${sourceRepository}@${sourceCommit}:FK75`,
        releaseEffect: "none",
      },
      {
        id: "REQ-FRAME-GEOMETRY",
        kind: "requirement",
        domain: "frame_geometry",
        title: "Current controlled frame geometry",
        lifecycle: "controlling",
        effectiveFrom: "2026-09-20",
        sourceRef: `${sourceRepository}@${sourceCommit}:AUTHORITY_MAP_START_HERE`,
        releaseEffect: "none",
      },
      {
        id: "OBJ-EK75-FRAME-GEOMETRY",
        kind: "engineering_object",
        domain: "frame_geometry_object",
        title: "E-K75 controlled frame geometry object",
        lifecycle: "controlling",
        effectiveFrom: "2026-09-20",
        sourceRef: `${sourceRepository}@${sourceCommit}:E-K75`,
        releaseEffect: "none",
      },
      {
        id: "EVID-EK75-DOSSIER",
        kind: "evidence",
        domain: "frame_geometry_evidence",
        title: "E-K75 controlled dossier evidence",
        lifecycle: "evidence",
        sourceRef: `${sourceRepository}@${sourceCommit}:DOSSIER-01`,
        releaseEffect: "supports_release",
        evidenceState: "sufficient",
      },
      {
        id: "EVID-EK75-DRAWING-SET",
        kind: "evidence",
        domain: "drawing_evidence",
        title: "E-K75 all-size authority drawing set",
        lifecycle: "evidence",
        sourceRef: `${sourceRepository}@${sourceCommit}:VEDM_DRAWING_COVERAGE_AUDIT_20260928`,
        releaseEffect: "supports_release",
        evidenceState: "insufficient",
      },
      {
        id: "OBJ-EK75-CAD-STEP",
        kind: "engineering_object",
        domain: "cad_step",
        title: "E-K75 controlled CAD/STEP authority object",
        lifecycle: "development",
        sourceRef: `${sourceRepository}@${sourceCommit}:VEDM_DRAWING_REGISTER`,
        releaseEffect: "none",
      },
      {
        id: "EVID-EK75-CAD-STEP",
        kind: "evidence",
        domain: "cad_step",
        title: "E-K75 all-size controlled CAD/STEP evidence",
        lifecycle: "evidence",
        sourceRef: `${sourceRepository}@${sourceCommit}:VEDM_DRAWING_REGISTER`,
        releaseEffect: "supports_release",
        evidenceState: "insufficient",
      },
      {
        id: "OBJ-EK75-BOM-INTERFACE",
        kind: "engineering_object",
        domain: "bom_interface",
        title: "E-K75 controlled BOM/interface configuration",
        lifecycle: "development",
        sourceRef: `${sourceRepository}@${sourceCommit}:VEDM_DEPENDENCY_REGISTER`,
        releaseEffect: "none",
      },
      {
        id: "EVID-EK75-BOM-INTERFACE",
        kind: "evidence",
        domain: "bom_interface",
        title: "E-K75 BOM/interface closure evidence",
        lifecycle: "evidence",
        sourceRef: `${sourceRepository}@${sourceCommit}:VEDM_DEPENDENCY_REGISTER`,
        releaseEffect: "supports_release",
        evidenceState: "insufficient",
      },
      {
        id: "VEL-PLY-541",
        kind: "document_revision",
        domain: "material_laminate",
        title: "VEL-PLY-2026 Rev 5.4.1",
        revision: "5.4.1",
        lifecycle: "approved_reference",
        sourceRef: `${sourceRepository}@${sourceCommit}:CURRENT_FRAME_LAMINATE_SOURCE`,
        releaseEffect: "none",
      },
      {
        id: "VEL-PLY-542",
        kind: "document_revision",
        domain: "material_laminate",
        title: "VEL-PLY-2026 Rev 5.4.2",
        revision: "5.4.2",
        lifecycle: "development",
        sourceRef: `${sourceRepository}@${sourceCommit}:PLY_CHRONOLOGY_CONTROL`,
        releaseEffect: "none",
      },
      {
        id: "EVID-MATERIAL-QUALIFICATION",
        kind: "evidence",
        domain: "material_laminate",
        title: "MATERIAL-01 qualified interlaminar/process allowables",
        lifecycle: "evidence",
        sourceRef: `${sourceRepository}@${sourceCommit}:MATERIAL-01`,
        releaseEffect: "supports_release",
        evidenceState: "insufficient",
      },
      {
        id: "EVID-PLY-CUT-GEOMETRY",
        kind: "evidence",
        domain: "material_laminate",
        title: "CAD-developed ply cut geometry and node-patch closure",
        lifecycle: "evidence",
        sourceRef: `${sourceRepository}@${sourceCommit}:VEDM-504`,
        releaseEffect: "supports_release",
        evidenceState: "insufficient",
      },
      {
        id: "EVID-FK75-NATIVE-FEA",
        kind: "evidence",
        domain: "fea_evidence",
        title: "FK75 native mesh-converged composite FEA",
        lifecycle: "evidence",
        sourceRef: `${sourceRepository}@${sourceCommit}:VEDM-503`,
        releaseEffect: "supports_release",
        evidenceState: "insufficient",
      },
      {
        id: "EVID-FK75-CFD",
        kind: "evidence",
        domain: "cfd_evidence",
        title: "FK75 K70/K75/K80 common-basis CFD comparison",
        lifecycle: "evidence",
        sourceRef: `${sourceRepository}@${sourceCommit}:CFD_AERO`,
        releaseEffect: "supports_release",
        evidenceState: "insufficient",
      },
      {
        id: "EVID-MANUFACTURING-DRAPE",
        kind: "evidence",
        domain: "manufacturing_process",
        title: "Real-prepreg drape/tooling process review",
        lifecycle: "evidence",
        sourceRef: `${sourceRepository}@${sourceCommit}:MANUFACTURING`,
        releaseEffect: "supports_release",
        evidenceState: "insufficient",
      },
      {
        id: "EVID-NDT-PLAN",
        kind: "evidence",
        domain: "validation_test",
        title: "Controlled NDT definition and acceptance evidence",
        lifecycle: "evidence",
        sourceRef: `${sourceRepository}@${sourceCommit}:NDT`,
        releaseEffect: "supports_release",
        evidenceState: "insufficient",
      },
      {
        id: "EVID-PROTOTYPE-VALIDATION",
        kind: "evidence",
        domain: "validation_test",
        title: "Prototype correlation and physical validation",
        lifecycle: "evidence",
        sourceRef: `${sourceRepository}@${sourceCommit}:PHYSICAL_TEST`,
        releaseEffect: "supports_release",
        evidenceState: "insufficient",
      },
      {
        id: "EVID-ISO4210",
        kind: "evidence",
        domain: "validation_test",
        title: "ISO 4210 frame/fork validation",
        lifecycle: "evidence",
        sourceRef: `${sourceRepository}@${sourceCommit}:ISO_4210`,
        releaseEffect: "supports_release",
        evidenceState: "insufficient",
      },
      {
        id: "G1-CAD-DRAWING",
        kind: "release_gate",
        domain: "cad_drawing_release",
        title: "Exact all-size CAD and authority drawing closure",
        lifecycle: "gate",
        sourceRef: `${sourceRepository}@${sourceCommit}:G1`,
        releaseEffect: "release_authority",
        gateStatus: "open",
        requiredEvidenceIds: ["EVID-EK75-DRAWING-SET", "EVID-EK75-CAD-STEP"],
      },
      {
        id: "G2-INTERFACE",
        kind: "release_gate",
        domain: "bom_interface",
        title: "Interface and BOM configuration closure",
        lifecycle: "gate",
        sourceRef: `${sourceRepository}@${sourceCommit}:G2`,
        releaseEffect: "release_authority",
        gateStatus: "open",
        requiredEvidenceIds: ["EVID-EK75-BOM-INTERFACE"],
      },
      {
        id: "G3-MATERIAL",
        kind: "release_gate",
        domain: "material_laminate",
        title: "Material qualification closure",
        lifecycle: "gate",
        sourceRef: `${sourceRepository}@${sourceCommit}:G3`,
        releaseEffect: "release_authority",
        gateStatus: "open",
        requiredEvidenceIds: ["EVID-MATERIAL-QUALIFICATION"],
      },
      {
        id: "G4-PLY-GEOMETRY",
        kind: "release_gate",
        domain: "material_laminate",
        title: "CAD-developed ply geometry closure",
        lifecycle: "gate",
        sourceRef: `${sourceRepository}@${sourceCommit}:G4`,
        releaseEffect: "release_authority",
        gateStatus: "open",
        requiredEvidenceIds: ["EVID-PLY-CUT-GEOMETRY"],
      },
      {
        id: "G5-FEA",
        kind: "release_gate",
        domain: "structural_release",
        title: "Native composite solver FEA closure",
        lifecycle: "gate",
        sourceRef: `${sourceRepository}@${sourceCommit}:G5`,
        releaseEffect: "release_authority",
        gateStatus: "open",
        requiredEvidenceIds: ["EVID-FK75-NATIVE-FEA"],
      },
      {
        id: "G6-MANUFACTURING",
        kind: "release_gate",
        domain: "manufacturing_process",
        title: "Manufacturing and drape review closure",
        lifecycle: "gate",
        sourceRef: `${sourceRepository}@${sourceCommit}:G6`,
        releaseEffect: "release_authority",
        gateStatus: "open",
        requiredEvidenceIds: ["EVID-MANUFACTURING-DRAPE"],
      },
      {
        id: "G7-QC-NDT",
        kind: "release_gate",
        domain: "validation_test",
        title: "QC/NDT definition closure",
        lifecycle: "gate",
        sourceRef: `${sourceRepository}@${sourceCommit}:G7`,
        releaseEffect: "release_authority",
        gateStatus: "open",
        requiredEvidenceIds: ["EVID-NDT-PLAN"],
      },
      {
        id: "G8-PROTOTYPE",
        kind: "release_gate",
        domain: "validation_test",
        title: "Prototype correlation closure",
        lifecycle: "gate",
        sourceRef: `${sourceRepository}@${sourceCommit}:G8`,
        releaseEffect: "release_authority",
        gateStatus: "open",
        requiredEvidenceIds: ["EVID-PROTOTYPE-VALIDATION"],
      },
      {
        id: "G9-ISO4210",
        kind: "release_gate",
        domain: "validation_test",
        title: "ISO 4210 validation closure",
        lifecycle: "gate",
        sourceRef: `${sourceRepository}@${sourceCommit}:G9`,
        releaseEffect: "release_authority",
        gateStatus: "open",
        requiredEvidenceIds: ["EVID-ISO4210"],
      },
      {
        id: "G10-FORMAL-RELEASE",
        kind: "release_gate",
        domain: "formal_release",
        title: "Formal engineering/configuration release approval",
        lifecycle: "gate",
        sourceRef: `${sourceRepository}@${sourceCommit}:G10`,
        releaseEffect: "release_authority",
        gateStatus: "open",
        requiredEvidenceIds: ["EVID-EK75-DOSSIER"],
      },
    ],
    edges: [
      { from: "VEDM-301-R539-EK75", to: "VEDM-301-R538", relation: "SUPERSEDES" },
      { from: "VEDM-301-R539-EK75", to: "OBJ-EK75-FRAME-GEOMETRY", relation: "CONTROLS" },
      { from: "VEDM-301-R54-FK75", to: "VEDM-301-R539-EK75", relation: "DERIVES_FROM" },
      { from: "REQ-FRAME-GEOMETRY", to: "OBJ-EK75-FRAME-GEOMETRY", relation: "REQUIRES" },
      { from: "OBJ-EK75-FRAME-GEOMETRY", to: "EVID-EK75-DOSSIER", relation: "EVIDENCED_BY" },
      { from: "OBJ-EK75-FRAME-GEOMETRY", to: "EVID-EK75-DRAWING-SET", relation: "EVIDENCED_BY" },
      { from: "OBJ-EK75-FRAME-GEOMETRY", to: "OBJ-EK75-CAD-STEP", relation: "REQUIRES" },
      { from: "OBJ-EK75-FRAME-GEOMETRY", to: "OBJ-EK75-BOM-INTERFACE", relation: "REQUIRES" },
      { from: "OBJ-EK75-CAD-STEP", to: "EVID-EK75-CAD-STEP", relation: "EVIDENCED_BY" },
      { from: "OBJ-EK75-BOM-INTERFACE", to: "EVID-EK75-BOM-INTERFACE", relation: "EVIDENCED_BY" },
      { from: "VEL-PLY-542", to: "VEL-PLY-541", relation: "DERIVES_FROM" },
      { from: "VEDM-301-R54-FK75", to: "EVID-FK75-CFD", relation: "EVIDENCED_BY" },
      { from: "EVID-EK75-DOSSIER", to: "G10-FORMAL-RELEASE", relation: "VALIDATED_BY" },
      { from: "EVID-EK75-DRAWING-SET", to: "G1-CAD-DRAWING", relation: "VALIDATED_BY" },
      { from: "EVID-EK75-CAD-STEP", to: "G1-CAD-DRAWING", relation: "VALIDATED_BY" },
      { from: "EVID-EK75-BOM-INTERFACE", to: "G2-INTERFACE", relation: "VALIDATED_BY" },
      { from: "EVID-MATERIAL-QUALIFICATION", to: "G3-MATERIAL", relation: "VALIDATED_BY" },
      { from: "EVID-PLY-CUT-GEOMETRY", to: "G4-PLY-GEOMETRY", relation: "VALIDATED_BY" },
      { from: "EVID-FK75-NATIVE-FEA", to: "G5-FEA", relation: "VALIDATED_BY" },
      { from: "EVID-MANUFACTURING-DRAPE", to: "G6-MANUFACTURING", relation: "VALIDATED_BY" },
      { from: "EVID-NDT-PLAN", to: "G7-QC-NDT", relation: "VALIDATED_BY" },
      { from: "EVID-PROTOTYPE-VALIDATION", to: "G8-PROTOTYPE", relation: "VALIDATED_BY" },
      { from: "EVID-ISO4210", to: "G9-ISO4210", relation: "VALIDATED_BY" },
      { from: "VEDM-301-R54-FK75", to: "G5-FEA", relation: "BLOCKED_BY" },
      { from: "VEDM-301-R539-EK75", to: "G10-FORMAL-RELEASE", relation: "BLOCKED_BY" },
    ],
  };
}
