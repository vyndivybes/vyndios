import { VEDM_R3A_SOURCE_COMMIT, VEDM_R3A_SOURCE_REPOSITORY } from "./vedm-authority-graph";

export const CURRENT_VEDM_AUTHORITY = {
  frameGeometry: "VEDM-301 Rev 5.3.9 Candidate E-K75",
  preferredFrontEnd: "Rev 5.4 FK75",
  status: "PREFERRED VAEA DEVELOPMENT FREEZE — NOT PRODUCTION RELEASE",
  sourceReference: `${VEDM_R3A_SOURCE_REPOSITORY}@${VEDM_R3A_SOURCE_COMMIT}`,
  authorityGraphSchema: "VYNDI_VEDM_AUTHORITY_GRAPH_V1",
  sourceRepository: VEDM_R3A_SOURCE_REPOSITORY,
  sourceCommit: VEDM_R3A_SOURCE_COMMIT,
  closureReference: "docs/engineering/VELOXIS_VEDM_Rev5.4_FK75_VAEA_Engineering_Closure_2026-09-20.html",
  summary:
    "E-K75 controls frame/rider geometry. FK75 preserves those datums and the +8 mm DT/HT correction while adding the truncated-Kamm fork crown and current closure evidence.",
  releaseBlockers: [
    "Native mesh-converged composite FEA",
    "MATERIAL-01 qualified interlaminar/process allowables",
    "XL tolerance and deformed-clearance closure",
    "Real-prepreg drape/tooling/NDT review",
    "Prototype/ISO 4210 physical validation",
    "Formal engineering release approval",
  ],
} as const;

export const CURRENT_CARBON_EPR_PILOT_AUTHORITY =
  `${CURRENT_VEDM_AUTHORITY.frameGeometry} · ${CURRENT_VEDM_AUTHORITY.preferredFrontEnd} · CONTROLLED DEVELOPMENT PILOT — NOT PRODUCTION RELEASE`;
