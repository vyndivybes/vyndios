export type VibpeEngineeringCaseId =
  | "ENG-CLEARANCE-001"
  | "ENG-COMPOSITE-SCREEN-001"
  | "ENG-MATERIAL-READINESS-001"
  | "ENG-CORRECTNESS-001";

export type VibpeEngineeringAnalysisResult = {
  handled: boolean;
  caseId?: VibpeEngineeringCaseId;
  status?: "PASS" | "PARTIAL" | "FAIL" | "INCONCLUSIVE";
  answer?: string;
  sourceRepository?: string;
  sourceCommit?: string;
  evidencePaths?: string[];
};

export const VEDM_ENGINEERING_REASONING_SNAPSHOT = {
  sourceRepository: "vayu-shastr/veloxis-engineering-design-manual",
  sourceCommit: "9ef41eb8afbc75429013bfd73133957ddccf3834",
  authority: "VEDM-301 Rev 5.3.9 Candidate E-K75",
  frontEndDevelopment: "Rev 5.4 FK75 — preferred VAEA fork/front-end development freeze — NOT RELEASED",
  clearance: {
    denseSteeringSweepMinMm: 7.17,
    packagingMmBySize: { XS: 8.61, S: 8.6, M: 8.37, L: 8.18, XL: 7.33 },
    qualification: "ANALYTICAL_SCREEN_ONLY",
  },
  composite: {
    tsaiWuFi: 0.623,
    positiveRootStrengthRatio: 1.43,
    hashinIndex: 0.353,
    qualification: "ANALYTICAL_SCREEN_ONLY",
  },
  correctness: {
    theoretical: "PARTIAL",
    mathematical: "PARTIAL",
    physical: "PARTIAL",
    practical: "INCONCLUSIVE",
    scientific: "PARTIAL",
  },
  openGates: [
    "native mesh-converged composite FEA",
    "MATERIAL-01 qualified interlaminar/process allowables",
    "XL tolerance/deformed-clearance closure",
    "real-prepreg drape/tooling review",
    "prototype/NDT/physical validation",
    "formal release approval",
  ],
  evidencePaths: [
    "CURRENT_CONFIGURATION_STATUS.md",
    "scripts/vibpe-assess.mjs",
    "VIBPE_Copilot/KP_METHOD_CHECKS_Rev0.1_20260928.json",
    "VIBPE_Copilot/QUESTION_ANSWERING_PROTOCOL_Rev0.3_20260928.md",
  ],
} as const;

function lineage() {
  const source = VEDM_ENGINEERING_REASONING_SNAPSHOT;
  return `${source.sourceRepository}@${source.sourceCommit.slice(0, 12)}`;
}

function result(
  caseId: VibpeEngineeringCaseId,
  status: VibpeEngineeringAnalysisResult["status"],
  answer: string,
): VibpeEngineeringAnalysisResult {
  const source = VEDM_ENGINEERING_REASONING_SNAPSHOT;
  return {
    handled: true,
    caseId,
    status,
    answer,
    sourceRepository: source.sourceRepository,
    sourceCommit: source.sourceCommit,
    evidencePaths: [...source.evidencePaths],
  };
}

function isClearanceQuestion(q: string) {
  return /\b(clearance|interference|tyre|tire|wheel envelope|steering sweep|downtube|down tube|fork crown)\b/i.test(q)
    && /\b(frame|fork|downtube|down tube|tyre|tire|wheel|clearance|latest rev|latest revision)\b/i.test(q);
}

function isCompositeFailureQuestion(q: string) {
  return /tsai[-\s]?wu|hashin|failure index|strength ratio|composite failure/i.test(q);
}

function isMaterialReadinessQuestion(q: string) {
  return /\b(material|prepreg|laminate|toray|material[-\s]?01)\b/i.test(q)
    && /\b(ready|readiness|release|acceptable|approved|qualified|current|good|valid)\b/i.test(q);
}

function isCorrectnessQuestion(q: string) {
  const dimensions = ["mathemat", "physical", "theoret", "practical", "scientific"]
    .filter((term) => q.toLowerCase().includes(term)).length;
  return dimensions >= 2 && /correct|valid|sound|assessment|evaluate|check/i.test(q);
}

function clearanceAnswer() {
  const s = VEDM_ENGINEERING_REASONING_SNAPSHOT;
  const p = s.clearance.packagingMmBySize;
  const minimum = Math.min(...Object.values(p));
  return [
    "Engineering assessment: PARTIAL — the current controlled analytical clearance screens are positive, but release clearance is not closed.",
    `Authority: ${s.authority}. ${s.frontEndDevelopment}.`,
    `Controlled analytical evidence: M dense steering-sweep minimum ${s.clearance.denseSteeringSweepMinMm.toFixed(3)} mm; nominal fork/tyre packaging XS/S/M/L/XL ${p.XS.toFixed(2)} / ${p.S.toFixed(2)} / ${p.M.toFixed(2)} / ${p.L.toFixed(2)} / ${p.XL.toFixed(2)} mm. The minimum nominal all-size packaging screen is ${minimum.toFixed(2)} mm at XL.`,
    "Interpretation: the available evidence demonstrates positive nominal separation. It does not establish an overall downtube/tyre release PASS because the pinned assessment does not contain an exact downtube-to-tyre BRep minimum tied to a governed acceptance criterion, and XL tolerance/deformed-clearance closure remains open.",
    `Evidence class: ${s.clearance.qualification}. Missing to close: exact BRep/steering-sweep downtube-to-tyre clearance, explicit required criterion, tolerance stack, structural deformation, and physical correlation.`,
    `Pinned evidence: ${lineage()} · ${s.evidencePaths.join(" · ")}.`,
  ].join("\n\n");
}

function compositeAnswer() {
  const s = VEDM_ENGINEERING_REASONING_SNAPSHOT;
  const c = s.composite;
  const screenPass = c.tsaiWuFi < 1 && c.positiveRootStrengthRatio >= 1 && c.hashinIndex < 1;
  return [
    `Engineering assessment: ${screenPass ? "PARTIAL" : "FAIL"} — the current composite analytical screens are ${screenPass ? "numerically screen-positive" : "not screen-positive"}, but they are not production release evidence.`,
    `Authority: ${s.authority}. ${s.frontEndDevelopment}.`,
    `Tsai-Wu FI ${c.tsaiWuFi.toFixed(3)} < 1.000: ${c.tsaiWuFi < 1 ? "screen PASS" : "screen FAIL"}. Positive-root strength ratio ${c.positiveRootStrengthRatio.toFixed(2)} >= 1.00: ${c.positiveRootStrengthRatio >= 1 ? "screen PASS" : "screen FAIL"}. Hashin index ${c.hashinIndex.toFixed(3)} < 1.000: ${c.hashinIndex < 1 ? "screen PASS" : "screen FAIL"}.`,
    "Limitation: MATERIAL-01 qualification, native mesh-converged composite FEA, interlaminar/process allowables and physical correlation remain open; therefore these values support development screening only and cannot establish structural or production release.",
    `Pinned evidence: ${lineage()} · CURRENT_CONFIGURATION_STATUS.md · scripts/vibpe-assess.mjs.`,
  ].join("\n\n");
}

function materialAnswer() {
  const s = VEDM_ENGINEERING_REASONING_SNAPSHOT;
  return [
    "Engineering assessment: INCONCLUSIVE for production material release.",
    `Authority: ${s.authority}.`,
    "The repository assessment keeps MATERIAL-01 open and does not claim a qualified production prepreg/material system or release FEA material basis.",
    `Open gates: ${s.openGates.join("; ")}.`,
    `Pinned evidence: ${lineage()} · scripts/vibpe-assess.mjs.`,
  ].join("\n\n");
}

function correctnessAnswer() {
  const s = VEDM_ENGINEERING_REASONING_SNAPSHOT;
  const c = s.correctness;
  return [
    "Current evidence-bound correctness assessment:",
    `Theoretical: ${c.theoretical} — method/authority logic is aligned, but exact commercial material/process closure remains open.`,
    `Mathematical: ${c.mathematical} — current analytical screens are reproducible, but the full released input/tolerance/mass chain is not yet closed.`,
    `Physical: ${c.physical} — nominal packaging and failure screens are positive; mesh-converged FEA, deformation and test correlation remain open.`,
    `Practical: ${c.practical} — cure/process, drape/tooling and NDT capability are not yet verified for the selected prepreg.`,
    `Scientific: ${c.scientific} — falsifiable criteria exist, but independent benchmark, repeatability, uncertainty and physical validation are not closed.`,
    "Overall release conclusion: NO-GO. These dimension-specific findings must not be collapsed into a whole-product PASS.",
    `Pinned evidence: ${lineage()} · scripts/vibpe-assess.mjs · VIBPE_Copilot/KP_METHOD_CHECKS_Rev0.1_20260928.json.`,
  ].join("\n\n");
}

export function tryVibpeEngineeringAnalysis(question: string): VibpeEngineeringAnalysisResult {
  const q = question.trim();
  if (!q) return { handled: false };
  if (isCorrectnessQuestion(q)) return result("ENG-CORRECTNESS-001", "PARTIAL", correctnessAnswer());
  if (isCompositeFailureQuestion(q)) return result("ENG-COMPOSITE-SCREEN-001", "PARTIAL", compositeAnswer());
  if (isClearanceQuestion(q)) return result("ENG-CLEARANCE-001", "PARTIAL", clearanceAnswer());
  if (isMaterialReadinessQuestion(q)) return result("ENG-MATERIAL-READINESS-001", "INCONCLUSIVE", materialAnswer());
  return { handled: false };
}
