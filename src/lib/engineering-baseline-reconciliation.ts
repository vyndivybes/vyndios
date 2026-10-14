/** Historical status is not production authority. Do not rewrite source rows or fabricate BOM releases. */
export type BaselineSourceRow={
 id:string;family_code:string;variant_id?:string|null;revision_code:string;status:string;
 bom_revision?:string|null;source_ref?:string|null;created_by?:string|null;
 approved_by?:string|null;released_at?:string|null;
};
export type BomReleaseEvidence={id:string;bom_revision:string};
export type ConfigurationManifestEvidence={baseline_id:string;bom_release_id:string|null;finalized:boolean};

export type BaselineReleaseDisposition=
 "PRELAUNCH_NOT_RELEASED"|"LEGACY_MIGRATION_UNVERIFIED"|"APPROVAL_UNVERIFIED"|
 "BOM_REFERENCE_MISSING"|"BOM_RELEASE_UNVERIFIED"|"MANIFEST_UNVERIFIED"|
 "BOM_RELATIONSHIP_RECONCILED";

export function classifyEngineeringBaselines(input:{
 baselines:BaselineSourceRow[];
 bomReleases:BomReleaseEvidence[];
 manifests:ConfigurationManifestEvidence[];
}){
 if(!Array.isArray(input.baselines)||!Array.isArray(input.bomReleases)||!Array.isArray(input.manifests))
  throw Error("ENGINEERING_RECONCILIATION_INPUT_INVALID");
 const releases=new Map(input.bomReleases.map(item=>[item.id,item]));
 return input.baselines.map(row=>{
  const migration=String(row.source_ref||"").startsWith("CUTOVER:")||
   row.created_by==="system:migration"||row.approved_by==="system:migration";
  const linked=input.manifests.filter(m=>m.baseline_id===row.id&&m.finalized===true)
   .map(m=>m.bom_release_id?releases.get(m.bom_release_id):undefined)
   .some(r=>r?.bom_revision===row.bom_revision && !!row.bom_revision);
  const released=input.bomReleases.some(r=>r.bom_revision===row.bom_revision&&!!row.bom_revision);
  let releaseDisposition:BaselineReleaseDisposition;
  if(row.status!=="released") releaseDisposition="PRELAUNCH_NOT_RELEASED";
  else if(migration) releaseDisposition="LEGACY_MIGRATION_UNVERIFIED";
  else if(!row.approved_by||row.approved_by==="system:migration")releaseDisposition="APPROVAL_UNVERIFIED";
  else if(!row.bom_revision) releaseDisposition="BOM_REFERENCE_MISSING";
  else if(!released) releaseDisposition="BOM_RELEASE_UNVERIFIED";
  else if(!linked) releaseDisposition="MANIFEST_UNVERIFIED";
  else releaseDisposition="BOM_RELATIONSHIP_RECONCILED";
  const bomLinkQualified=releaseDisposition==="BOM_RELATIONSHIP_RECONCILED";
  return {
   id:row.id,familyCode:row.family_code,variantId:row.variant_id??null,
   revisionCode:row.revision_code,storedStatus:row.status,
   bomRevision:row.bom_revision??null,
   recordOrigin:migration?"SYSTEM_MIGRATION" as const:"NOT_INDEPENDENTLY_VERIFIED" as const,
   releaseDisposition,bomLinkQualified,
   // A linked BOM is still not a VEDM, material, FEA or physical release.
   productionReleaseQualified:false,
   nextAction:migration
    ?"Preserve the legacy cutover entry as prelaunch reference; require a genuine approved revision and released BOM before using it for production."
    :bomLinkQualified
    ?"BOM relationship is traceable; complete the independent engineering, material and physical release steps before production."
    :"Reconcile the original engineering approval, approved BOM release and finalized configuration manifest through existing change control."
  };
 });
}
