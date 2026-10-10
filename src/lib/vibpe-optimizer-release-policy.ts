export type ReleaseLineageInput = {
  deployedSourceSha: string | null | undefined;
  ibpeSourceSha: string | null | undefined;
  packetSourceSha: string | null | undefined;
  packetId: string | null | undefined;
  runParentPacketId: string | null | undefined;
};

function normalized(value: string | null | undefined) {
  return String(value ?? "").trim().toLowerCase();
}

export function isReleaseMathAndCashReady(
  optimizationStatus: string | null | undefined,
  cashGuardrailStatus: string | null | undefined,
) {
  return (optimizationStatus === "optimal" || optimizationStatus === "feasible")
    && cashGuardrailStatus === "feasible";
}

export function isReleaseGovernanceReady(governance: Record<string, unknown> | null | undefined) {
  return Boolean(
    governance
      && governance.advisoryOnly === true
      && governance.mayCreateTransactions === false
      && governance.humanApprovalRequiredForBusinessAction === true,
  );
}

/**
 * Source provenance is independent of whether an optimizer has run.
 * The packet's parent IBPE existence is checked by the closure reader.
 * A missing run must block RUN/ACCEPTANCE, not SOURCE-LINEAGE.
 */
export function hasExactSourceLineage(input: ReleaseLineageInput) {
  const deployed = normalized(input.deployedSourceSha);
  const ibpe = normalized(input.ibpeSourceSha);
  const packet = normalized(input.packetSourceSha);
  const packetId = String(input.packetId ?? "").trim();

  if (deployed.length < 7 || ibpe.length < 7 || packet.length < 7 || !packetId) return false;
  return deployed === ibpe && ibpe === packet;
}

/** Exact packet-to-run lineage is an additional release prerequisite. */
export function hasExactReleaseLineage(input: ReleaseLineageInput) {
  const packetId = String(input.packetId ?? "").trim();
  const runParentPacketId = String(input.runParentPacketId ?? "").trim();
  return hasExactSourceLineage(input) && Boolean(runParentPacketId) && packetId === runParentPacketId;
}
