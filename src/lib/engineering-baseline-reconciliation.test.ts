import test from "node:test";
import assert from "node:assert/strict";
import {classifyEngineeringBaselines} from "./engineering-baseline-reconciliation.ts";

const legacy=(id:string,revision_code:string)=>({
 id,family_code:"altitude",variant_id:null,revision_code,status:"released",
 bom_revision:null,source_ref:"CUTOVER:src/lib/finance/engineering-engine.ts",
 created_by:"system:migration",approved_by:"system:migration",released_at:"2026-09-11T05:01:07Z"
});
test("all three actual cutover rows remain historically released but have no production authority",()=>{
 const rows=[legacy("ENG-ALTITUDE-C2","C2"),legacy("ENG-LATITUDE-C3","C3"),legacy("ENG-LONGITUDE-A2","A2")];
 const result=classifyEngineeringBaselines({baselines:rows,bomReleases:[],manifests:[]});
 assert.deepEqual(result.map(x=>x.releaseDisposition),
  ["LEGACY_MIGRATION_UNVERIFIED","LEGACY_MIGRATION_UNVERIFIED","LEGACY_MIGRATION_UNVERIFIED"]);
 assert.ok(result.every(x=>x.storedStatus==="released" && !x.productionReleaseQualified && !x.bomLinkQualified));
 assert.ok(result.every(x=>x.recordOrigin==="SYSTEM_MIGRATION"));
 assert.ok(result.every(x=>x.nextAction.includes("prelaunch")||x.nextAction.includes("approval")));
});
test("draft proposals cannot be production releases or silently promoted by a BOM match",()=>{
 const row={...legacy("DRAFT","R2"),status:"draft",source_ref:"VEDM:candidate",
  created_by:"engineer",approved_by:null,bom_revision:"BOM1"};
 const result=classifyEngineeringBaselines({baselines:[row],
  bomReleases:[{id:"REL1",bom_revision:"BOM1"}],
  manifests:[{baseline_id:"DRAFT",bom_release_id:"REL1",finalized:true}]})[0];
 assert.equal(result.releaseDisposition,"PRELAUNCH_NOT_RELEASED");
 assert.equal(result.productionReleaseQualified,false);
});
test("BOM release alone does not qualify a baseline without its exact finalized configuration manifest",()=>{
 const row={...legacy("APPROVED","R3"),source_ref:"AUTH:R3",created_by:"engineer",
 approved_by:"command:founder",bom_revision:"BOM-R3"};
 const result=classifyEngineeringBaselines({baselines:[row],
  bomReleases:[{id:"REL1",bom_revision:"BOM-R3"}],manifests:[]})[0];
 assert.equal(result.releaseDisposition,"MANIFEST_UNVERIFIED");
 assert.equal(result.bomLinkQualified,false);
});
test("only exact release-manifest-baseline linkage can establish a reconciled BOM reference, not final production approval",()=>{
 const row={...legacy("APPROVED","R3"),source_ref:"AUTH:R3",created_by:"engineer",
 approved_by:"command:founder",bom_revision:"BOM-R3"};
 const result=classifyEngineeringBaselines({baselines:[row],
  bomReleases:[{id:"REL1",bom_revision:"BOM-R3"}],
  manifests:[{baseline_id:"APPROVED",bom_release_id:"REL1",finalized:true}]})[0];
 assert.equal(result.releaseDisposition,"BOM_RELATIONSHIP_RECONCILED");
 assert.equal(result.bomLinkQualified,true);
 assert.equal(result.productionReleaseQualified,false);
});
test("no manifest for another baseline or wrong BOM can authorize this baseline",()=>{
 const row={...legacy("APPROVED","R3"),source_ref:"AUTH:R3",created_by:"engineer",
 approved_by:"command:founder",bom_revision:"BOM-R3"};
 const result=classifyEngineeringBaselines({baselines:[row],
  bomReleases:[{id:"REL1",bom_revision:"OTHER"}],
  manifests:[{baseline_id:"APPROVED",bom_release_id:"REL1",finalized:true}]})[0];
 assert.equal(result.releaseDisposition,"BOM_RELEASE_UNVERIFIED");
 assert.equal(result.productionReleaseQualified,false);
});
