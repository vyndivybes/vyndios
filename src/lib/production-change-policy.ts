export type ProductionChangeGuardState = {
  jobCardStatus: string;
  issuedLines: number;
  consumedReservations: number;
  progressedTravellers: number;
  progressedGates: number;
  progressedEvidence: number;
  committedPurchaseOrders: number;
};

/** Disallow replacement when material, serial, quality or supplier commitments
 * have progressed beyond a revocable planning/release state. */
export function assertSafeProductionSupersession(state: ProductionChangeGuardState): void {
  if (state.jobCardStatus !== "released" && state.jobCardStatus !== "hold")
    throw new Error("Production change requires a released/held build without active or completed WIP.");
  const blockers: string[] = [];
  if (state.issuedLines) blockers.push("issued Job Card lines");
  if (state.consumedReservations) blockers.push("consumed inventory reservations");
  if (state.progressedTravellers) blockers.push("in-progress or completed serial travellers");
  if (state.progressedGates || state.progressedEvidence) blockers.push("post-release Quality/EPR evidence");
  if (state.committedPurchaseOrders) blockers.push("submitted or committed purchase orders");
  if (blockers.length) throw new Error("Controlled production change HOLD: " + blockers.join(", ") + ". Resolve through disposition before re-release.");
}

export function assertControlledEcnBom(
  frozenBom: string | null,
  currentBom: string,
  ecnTargetBom: string | null,
): void {
  if (ecnTargetBom && ecnTargetBom !== currentBom)
    throw new Error("Released ECN target BOM does not match the current approved production BOM.");
  if (frozenBom !== currentBom && ecnTargetBom !== currentBom)
    throw new Error("An approved ECN explicitly targeting the changed BOM is required.");
}
