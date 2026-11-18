/** VYNDI OS inference admission policy; planning only, never transaction authority. */
export type InferenceClassification='PUBLIC'|'SYNTHETIC'|'CONFIDENTIAL';
export type InferenceCapability='text'|'vision'|'audio'|'document';
export type InferenceRoute={
  classification?:string;
  capability?:string;
  supportedCapabilities?:string[];
  provider?:string;
  providerKind?:string;
  costTier?:string;
  freeTierVerified?:boolean;
  mode?:string;
  allowExternal?:boolean;
};
export type InferenceDecision={state:'HOLD'|'PREPARE_ONLY';holds:readonly string[];businessWriteAuthorized:false;paidInferenceAuthorized:false};
export function assessInferenceRoute(x:InferenceRoute={}):InferenceDecision {
  const holds:string[]=[];
  if (!['PUBLIC','SYNTHETIC','CONFIDENTIAL'].includes(x.classification??'')) holds.push('DATA_CLASSIFICATION_REQUIRED');
  if (!['text','vision','audio','document'].includes(x.capability??'') ||
      !(x.supportedCapabilities??['text']).includes(x.capability??'')) holds.push('CAPABILITY_UNVERIFIED');
  if (typeof x.provider!=='string'||!x.provider.trim()) holds.push('PROVIDER_NOT_DECLARED');
  if (!['external','local'].includes(x.providerKind??'')) holds.push('INVALID_PROVIDER_KIND');
  if (!['development','independence'].includes(x.mode??'')) holds.push('INVALID_MODE');
  if (x.costTier!=='free') holds.push('PAID_ROUTING_NOT_AUTHORIZED');
  if (x.providerKind==='external') {
    if(x.mode!=='development') holds.push('EXTERNAL_PROVIDER_DISABLED_IN_INDEPENDENCE');
    if(x.classification!=='PUBLIC'&&x.classification!=='SYNTHETIC') holds.push('DATA_RESIDENCY_DENIED');
    if(x.allowExternal!==true) holds.push('EXTERNAL_CONSENT_REQUIRED');
    if(x.freeTierVerified!==true) holds.push('FREE_TIER_UNVERIFIED');
  }
  return Object.freeze({state:holds.length?'HOLD':'PREPARE_ONLY',holds:Object.freeze(holds),
    businessWriteAuthorized:false,paidInferenceAuthorized:false});
}
/** This check is only a prerequisite; the VAOS evidence assessor remains authoritative. */
export function assessProviderDisconnection(x:{offlineHours?:number;verifiedEvidence?:boolean}={}) {
  const holds:string[]=[];
  if (!Number.isFinite(x.offlineHours)|| (x.offlineHours??0)<72) holds.push('OFFLINE_TRIAL_REQUIRED');
  if(x.verifiedEvidence!==true)holds.push('INDEPENDENT_EVIDENCE_REQUIRED');
  return Object.freeze({state:holds.length?'HOLD' as const:'READY_FOR_HUMAN_REVIEW' as const,
    holds:Object.freeze(holds),autoDisconnectAuthorized:false,productionWriteAuthorized:false});
}
