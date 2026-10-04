import test from "node:test";
import assert from "node:assert/strict";
import {
  buildEngineeringDocumentWhereUsed,
  buildReleasedConfigurationManifest,
  compareEngineeringDocumentRevisions,
  type ControlledEngineeringRevision,
  type EngineeringDocumentLink,
} from "./engineering-pdm-model.ts";

const rev=(overrides:Partial<ControlledEngineeringRevision>={}):ControlledEngineeringRevision=>({
  id:"REV-A",documentId:"DOC-1",documentNumber:"VEDM-301",title:"Frame geometry authority",documentType:"drawing",
  revisionCode:"A",status:"released",contentSha256:"a".repeat(64),fileName:"frame-a.step",mediaType:"model/step",
  fileSizeBytes:1000,sourceUri:"github://repo/frame-a.step",sourceRef:"TEST",releasedAt:"2026-10-01T00:00:00Z",...overrides,
});

test("document comparison detects content identity and metadata change without reading binary payloads",()=>{
  const result=compareEngineeringDocumentRevisions(rev(),rev({id:"REV-B",revisionCode:"B",contentSha256:"b".repeat(64),fileName:"frame-b.step",fileSizeBytes:1200}));
  assert.equal(result.sameContent,false);
  assert.deepEqual(result.changedFields,["revisionCode","contentSha256","fileName","fileSizeBytes"]);
});

test("where-used returns explicit governed targets and never invents relationships",()=>{
  const links:EngineeringDocumentLink[]=[
    {id:"L1",revisionId:"REV-A",targetType:"engineering_baseline",targetId:"BASE-1",relation:"CONTROLS"},
    {id:"L2",revisionId:"REV-A",targetType:"eco",targetId:"ECO-1",relation:"EVIDENCES"},
  ];
  const result=buildEngineeringDocumentWhereUsed("REV-A",links);
  assert.equal(result.targets.length,2);
  assert.deepEqual(result.targets.map((x)=>x.targetId),["BASE-1","ECO-1"]);
  assert.equal(buildEngineeringDocumentWhereUsed("REV-X",links).targets.length,0);
});

test("released configuration manifest keeps exact revision and checksum evidence",()=>{
  const manifest=buildReleasedConfigurationManifest({
    baselineId:"BASE-1",
    bomRevision:"BOM-R1",
    revisions:[
      rev(),
      rev({id:"REV-B",documentId:"DOC-2",documentNumber:"VEDM-503",title:"FEA authority",revisionCode:"2",contentSha256:"c".repeat(64),fileName:"fea.pdf"}),
    ],
  });
  assert.equal(manifest.documentCount,2);
  assert.deepEqual(manifest.documents.map((x)=>x.revisionId),["REV-A","REV-B"]);
  assert.equal(manifest.documents[0]!.contentSha256,"a".repeat(64));
  assert.equal(manifest.configurationFingerprint.length,64);
  assert.equal(manifest.configurationFingerprint,"adce0ed57c0f826237131ff6b5989c686deac16463ccbb8a78a4ae4d7e458b5f");
});

test("manifest rejects non-released revisions and duplicate document masters",()=>{
  assert.throws(()=>buildReleasedConfigurationManifest({baselineId:"BASE-1",bomRevision:null,revisions:[rev({status:"approved"})]}),/released revisions/i);
  assert.throws(()=>buildReleasedConfigurationManifest({baselineId:"BASE-1",bomRevision:null,revisions:[rev(),rev({id:"REV-B",revisionCode:"B"})]}),/duplicate document/i);
});
