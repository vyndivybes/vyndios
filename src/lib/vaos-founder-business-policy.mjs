/**
 * Founder/Managing Director policy declaration (20 November 2026).
 * This is an authorization DECISION recorded in governance, not verified
 * identity, legal KYC, physical stock, independently auditable source revision,
 * retrospective signature or waiver of maker-checker controls.
 *
 * Baseline counts from a prior independent production READ-ONLY observation.
 * Counts do not bind record IDs; an equal count is NOT proof that the same
 * records remain, nor that new records are simulation data.
 */
export const VYNDI_MD_SOURCE_POLICY=Object.freeze({
  schemaVersion:'VYNDI_MD_SOURCE_POLICY_V1',
  declaredAtDate:'2026-11-20',
  declaredLegalEntity:'Vāyú Shastr Pvt Ltd',
  product:'VYNDI OS',
  declaredSystemOfRecord:'VYNDI_OS',
  agentOrchestrationSystem:'VAOS_JARVIS',
  businessOwnershipDecision:'MD_DECLARED',
  sourceAuthorityDecision:'MD_APPROVED',
  historicalDataClassification:'SIMULATION_ONLY_DECLARED',
  baselineScope:'OBSERVED_EXISTING_DATASETS_NOT_FUTURE_POSTINGS',
  authenticationVerified:false,
  recordLevelClassificationVerified:false,
  businessDataVerified:false,
  productionWriteAuthorized:false,
  // Keys deliberately correspond only to independently observed row counts
  // for the initial 8 audited transactional tables, not every VYNDI table.
  simulationBaselineCounts:Object.freeze({
    salesOrders:5,
    purchaseOrders:48,
    jobCards:4,
    jobCardLines:56,
    reservations:1,
    inventoryLedger:2,
    inventoryCostLedger:2,
    travellers:1,
  }),
});
function bad(){throw Error('SIMULATION_BASELINE_INVALID');}
/**
 * Snapshot shape comparison only. Does NOT classify individual records,
 * authenticate the founder, or certify future production business activity.
 * @param {unknown} counts
 */
export function assessSimulationDeclarationBoundary(counts){
 /** @type {Record<string,number>} */
 const baseline=VYNDI_MD_SOURCE_POLICY.simulationBaselineCounts;
 if(!counts||typeof counts!=='object'||Array.isArray(counts))bad();
 /** @type {Record<string,unknown>} */
 const input=/** @type {Record<string,unknown>} */(counts);
 if(Object.keys(input).length!==Object.keys(baseline).length||
    Object.keys(input).some(k=>!Object.hasOwn(baseline,k)))bad();
 /** @type {Record<string,number>} */
 const sourceCounts={};
 for(const key of Object.keys(baseline)){
  const n=input[key];
  if(typeof n!=='number'||!Number.isSafeInteger(n)||n<0)throw Error('SIMULATION_BASELINE_INVALID');
  sourceCounts[key]=n;
 }
 const countsEqual=Object.keys(baseline).every(k=>sourceCounts[k]===baseline[k]);
 return Object.freeze({
  schemaVersion:'VYNDI_SIMULATION_DECLARATION_BOUNDARY_V1',
  status:'HOLD',
  countsEqual,
  baselineScope:'ROW_COUNTS_ONLY_NOT_RECORD_IDENTITIES',
  historicalDeclaration:'SIMULATION_ONLY_DECLARED',
  sourceRevisionCertified:false,
  recordLevelClassificationVerified:false,
  productionBusinessDataCertified:false,
  authenticationVerified:false,
  productionWriteAuthorized:false,
  holds:Object.freeze(countsEqual?['HISTORICAL_SIMULATION_ONLY','RECORD_LEVEL_CLASSIFICATION_PENDING',
    'AUTHENTICATED_OWNER_BINDING_PENDING','REAL_SOURCE_REVISION_PENDING']:
   ['HISTORICAL_SIMULATION_ONLY','SIMULATION_DECLARATION_COHORT_DRIFT','RECORD_LEVEL_CLASSIFICATION_PENDING',
    'AUTHENTICATED_OWNER_BINDING_PENDING','REAL_SOURCE_REVISION_PENDING']),
  counts:Object.freeze(sourceCounts),
 });
}
