import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getSql, type Sql } from "@/lib/db";
import { requireBusinessActor } from "@/lib/business-actor";
import { canAccessRoute } from "@/lib/page-access";
import { createVedmR3aSeed, VEDM_R3A_SOURCE_COMMIT } from "@/lib/vedm-authority-graph";
import {
  buildEngineeringDocumentWhereUsed,
  buildReleasedConfigurationManifest,
  type ControlledEngineeringRevision,
  type EngineeringDocumentLink,
} from "@/lib/engineering-pdm-model";

type DocumentRow={id:string;document_number:string;title:string;document_type:string;domain:string;owner:string;source_ref:string;created_by:string;active:boolean;created_at:string};
type RevisionRow={id:string;document_id:string;document_number:string;title:string;document_type:string;revision_code:string;status:ControlledEngineeringRevision["status"];content_sha256:string;file_name:string;media_type:string;file_size_bytes:number|string;source_uri:string;source_ref:string;created_by:string;submitted_by:string|null;approved_by:string|null;released_by:string|null;supersedes_revision_id:string|null;superseded_by_revision_id:string|null;release_note:string|null;created_at:string;approved_at:string|null;released_at:string|null;superseded_at:string|null};
type LinkRow={id:string;revision_id:string;target_type:EngineeringDocumentLink["targetType"];target_id:string;relation:EngineeringDocumentLink["relation"];authority_source_commit:string|null;source_ref:string;created_by:string;created_at:string};
type ManifestResult=ReturnType<typeof buildReleasedConfigurationManifest>;
type ManifestRow={id:string;baseline_id:string;bom_release_id:string|null;configuration_fingerprint:string;document_count:number|string;manifest_json:ManifestResult;source_ref:string;captured_by:string;captured_role:string;created_at:string};
type BaselineOption={id:string;family_code:string;variant_id:string|null;revision_code:string;bom_revision:string|null;status:string};
type EcoOption={id:string;ecr_id:string;status:string;target_baseline_id:string};
type EcnOption={id:string;notice_number:string;eco_id:string;target_baseline_id:string;target_bom_revision:string|null;released_at:string};
type BomReleaseOption={id:string;venture:string;model_id:string;bom_revision:string;released_at:string};

const sha256=z.string().regex(/^[0-9a-f]{64}$/);
const documentType=z.enum(["cad_step","drawing","fea","cfd","material_spec","laminate","test_plan","test_report","ndt","tooling","manufacturing","specification","other"]);
const targetType=z.enum(["engineering_baseline","eco","ecn","bom_revision","vedm_authority_node"]);
const relation=z.enum(["CONTROLS","EVIDENCES","VALIDATES","DERIVES_FROM","REQUIRES"]);
const transitionState=z.enum(["pending_approval","approved","rejected"]);

async function requireEngineering(action:"view"|"edit"|"approve"){
  const actor=await requireBusinessActor(action);
  if(!canAccessRoute(actor.role,"/command/engineering")) throw new Error("Engineering PDM access denied.");
  return actor;
}
function revision(row:RevisionRow):ControlledEngineeringRevision{
  return {id:row.id,documentId:row.document_id,documentNumber:row.document_number,title:row.title,documentType:row.document_type,revisionCode:row.revision_code,status:row.status,contentSha256:row.content_sha256,fileName:row.file_name,mediaType:row.media_type,fileSizeBytes:Number(row.file_size_bytes),sourceUri:row.source_uri,sourceRef:row.source_ref,releasedAt:row.released_at};
}
function link(row:LinkRow):EngineeringDocumentLink{
  return {id:row.id,revisionId:row.revision_id,targetType:row.target_type,targetId:row.target_id,relation:row.relation};
}

export async function buildEngineeringPdmStateFromSql(sql:Sql){
  const [documents,revisions,links,manifests,baselines,ecos,ecns,bomReleases]=await Promise.all([
    sql.query<DocumentRow>("select id,document_number,title,document_type,domain,owner,source_ref,created_by,active,created_at::text from vyndi_engineering_documents order by document_number,id"),
    sql.query<RevisionRow>("select r.id,r.document_id,d.document_number,d.title,d.document_type,r.revision_code,r.status,r.content_sha256,r.file_name,r.media_type,r.file_size_bytes,r.source_uri,r.source_ref,r.created_by,r.submitted_by,r.approved_by,r.released_by,r.supersedes_revision_id,r.superseded_by_revision_id,r.release_note,r.created_at::text,r.approved_at::text,r.released_at::text,r.superseded_at::text from vyndi_engineering_document_revisions r join vyndi_engineering_documents d on d.id=r.document_id order by d.document_number,r.created_at desc,r.id"),
    sql.query<LinkRow>("select id,revision_id,target_type,target_id,relation,authority_source_commit,source_ref,created_by,created_at::text from vyndi_engineering_document_links order by revision_id,target_type,target_id,relation"),
    sql.query<ManifestRow>("select id,baseline_id,bom_release_id,configuration_fingerprint,document_count,manifest_json,source_ref,captured_by,captured_role,created_at::text from vyndi_engineering_configuration_manifests where finalized=true order by created_at desc,id"),
    sql.query<BaselineOption>("select id,family_code,variant_id,revision_code,bom_revision,status from vyndi_engineering_baselines where status='released' order by family_code,revision_code,id"),
    sql.query<EcoOption>("select id,ecr_id,status,target_baseline_id from vyndi_engineering_change_orders order by updated_at desc,id"),
    sql.query<EcnOption>("select id,notice_number,eco_id,target_baseline_id,target_bom_revision,released_at::text from vyndi_engineering_change_notices order by released_at desc,id"),
    sql.query<BomReleaseOption>("select id,venture,model_id,bom_revision,released_at::text from vyndi_bom_revision_releases order by released_at desc,id"),
  ]);
  const revisionModels=revisions.map(revision);
  const linkModels=links.map(link);
  const vedmNodes=createVedmR3aSeed().nodes.map((node)=>({id:node.id,title:node.title,kind:node.kind,domain:node.domain,revision:node.revision??null,sourceCommit:VEDM_R3A_SOURCE_COMMIT}));
  return {
    documents:documents.map((row)=>({id:row.id,documentNumber:row.document_number,title:row.title,documentType:row.document_type,domain:row.domain,owner:row.owner,sourceReference:row.source_ref,active:row.active,createdAt:row.created_at})),
    revisions:revisions.map((row)=>({...revision(row),createdBy:row.created_by,submittedBy:row.submitted_by,approvedBy:row.approved_by,releasedBy:row.released_by,supersedesRevisionId:row.supersedes_revision_id,supersededByRevisionId:row.superseded_by_revision_id,releaseNote:row.release_note,createdAt:row.created_at,approvedAt:row.approved_at,supersededAt:row.superseded_at,whereUsed:buildEngineeringDocumentWhereUsed(row.id,linkModels).targets})),
    links:linkModels,
    manifests:manifests.map((row)=>({id:row.id,baselineId:row.baseline_id,bomReleaseId:row.bom_release_id,configurationFingerprint:row.configuration_fingerprint,documentCount:Number(row.document_count),manifest:row.manifest_json,sourceReference:row.source_ref,capturedBy:row.captured_by,capturedRole:row.captured_role,createdAt:row.created_at})),
    targets:{
      baselines:baselines.map((row)=>({id:row.id,familyCode:row.family_code,variantId:row.variant_id,revisionCode:row.revision_code,bomRevision:row.bom_revision})),
      ecos:ecos.map((row)=>({id:row.id,ecrId:row.ecr_id,status:row.status,targetBaselineId:row.target_baseline_id})),
      ecns:ecns.map((row)=>({id:row.id,noticeNumber:row.notice_number,ecoId:row.eco_id,targetBaselineId:row.target_baseline_id,targetBomRevision:row.target_bom_revision,releasedAt:row.released_at})),
      bomReleases:bomReleases.map((row)=>({id:row.id,venture:row.venture,modelId:row.model_id,bomRevision:row.bom_revision,releasedAt:row.released_at})),
      vedmNodes,
    },
    summary:{documentCount:documents.length,revisionCount:revisions.length,releasedRevisionCount:revisionModels.filter((row)=>row.status==="released").length,supersededRevisionCount:revisionModels.filter((row)=>row.status==="superseded").length,manifestCount:manifests.length},
  };
}

export type EngineeringPdmState=Awaited<ReturnType<typeof buildEngineeringPdmStateFromSql>>;

export const getEngineeringPdmState=createServerFn({method:"GET"}).handler(async()=>{
  await requireEngineering("view");
  return buildEngineeringPdmStateFromSql(await getSql());
});

export const createEngineeringDocument=createServerFn({method:"POST"})
  .validator(z.object({documentNumber:z.string().trim().min(2).max(160),title:z.string().trim().min(2).max(300),documentType,domain:z.string().trim().min(2).max(160),owner:z.string().trim().min(2).max(200),sourceReference:z.string().trim().min(2).max(800)}))
  .handler(async({data})=>{
    const actor=await requireEngineering("edit");
    const sql=await getSql();
    const id="ENG-DOC-"+crypto.randomUUID();
    await sql.query("insert into vyndi_engineering_documents(id,document_number,title,document_type,domain,owner,source_ref,created_by) values($1,$2,$3,$4,$5,$6,$7,$8)",[id,data.documentNumber,data.title,data.documentType,data.domain,data.owner,data.sourceReference,actor.userId]);
    await sql.query("insert into vyndi_audit_events(id,entity_type,entity_id,action,actor_user_id,actor_role,source_reference,payload_json) values($1,'engineering_document',$2,'ENGINEERING_DOCUMENT_CREATED',$3,$4,$5,$6::jsonb)",[crypto.randomUUID(),id,actor.userId,actor.role,data.sourceReference,JSON.stringify({documentNumber:data.documentNumber,documentType:data.documentType,domain:data.domain})]);
    return {ok:true,id};
  });

export const registerEngineeringDocumentRevision=createServerFn({method:"POST"})
  .validator(z.object({documentId:z.string().trim().min(1).max(160),revisionCode:z.string().trim().min(1).max(80),contentSha256:sha256,fileName:z.string().trim().min(1).max(300),mediaType:z.string().trim().min(1).max(160),fileSizeBytes:z.number().int().positive(),sourceUri:z.string().trim().min(3).max(1200),sourceReference:z.string().trim().min(2).max(800)}))
  .handler(async({data})=>{
    const actor=await requireEngineering("edit");
    const sql=await getSql();
    const docs=await sql.query<{id:string;active:boolean}>("select id,active from vyndi_engineering_documents where id=$1",[data.documentId]);
    if(!docs[0]||!docs[0].active) throw new Error("Active engineering document master not found.");
    const id="ENG-DOC-REV-"+crypto.randomUUID();
    await sql.query("insert into vyndi_engineering_document_revisions(id,document_id,revision_code,status,content_sha256,file_name,media_type,file_size_bytes,source_uri,source_ref,created_by) values($1,$2,$3,'draft',$4,$5,$6,$7,$8,$9,$10)",[id,data.documentId,data.revisionCode,data.contentSha256,data.fileName,data.mediaType,data.fileSizeBytes,data.sourceUri,data.sourceReference,actor.userId]);
    return {ok:true,id,status:"draft" as const};
  });

async function validateTarget(sql:Sql,type:EngineeringDocumentLink["targetType"],id:string){
  if(type==="engineering_baseline") return Boolean((await sql.query<{id:string}>("select id from vyndi_engineering_baselines where id=$1",[id]))[0]);
  if(type==="eco") return Boolean((await sql.query<{id:string}>("select id from vyndi_engineering_change_orders where id=$1",[id]))[0]);
  if(type==="ecn") return Boolean((await sql.query<{id:string}>("select id from vyndi_engineering_change_notices where id=$1",[id]))[0]);
  if(type==="bom_revision") return Boolean((await sql.query<{id:string}>("select id from vyndi_bom_revision_releases where id=$1",[id]))[0]);
  return createVedmR3aSeed().nodes.some((node)=>node.id===id);
}

export const linkEngineeringDocumentRevision=createServerFn({method:"POST"})
  .validator(z.object({revisionId:z.string().trim().min(1).max(180),targetType,targetId:z.string().trim().min(1).max(220),relation,sourceReference:z.string().trim().min(2).max(800)}))
  .handler(async({data})=>{
    const actor=await requireEngineering("edit");
    const sql=await getSql();
    const revisions=await sql.query<{status:string}>("select status from vyndi_engineering_document_revisions where id=$1",[data.revisionId]);
    if(!revisions[0]||revisions[0].status!=="draft") throw new Error("Where-used links can only be added to a draft engineering document revision.");
    if(!(await validateTarget(sql,data.targetType,data.targetId))) throw new Error("Canonical engineering where-used target not found.");
    const id="ENG-DOC-LINK-"+crypto.randomUUID();
    await sql.query("insert into vyndi_engineering_document_links(id,revision_id,target_type,target_id,relation,authority_source_commit,source_ref,created_by) values($1,$2,$3,$4,$5,$6,$7,$8)",[id,data.revisionId,data.targetType,data.targetId,data.relation,data.targetType==="vedm_authority_node"?VEDM_R3A_SOURCE_COMMIT:null,data.sourceReference,actor.userId]);
    return {ok:true,id};
  });

export const transitionEngineeringDocumentRevision=createServerFn({method:"POST"})
  .validator(z.object({revisionId:z.string().trim().min(1).max(180),toStatus:transitionState,sourceReference:z.string().trim().min(2).max(800),reason:z.string().trim().min(2).max(1000)}))
  .handler(async({data})=>{
    const actor=await requireEngineering(data.toStatus==="pending_approval"?"edit":"approve");
    const sql=await getSql();
    const rows=await sql.query<{status:string;created_by:string}>("select status,created_by from vyndi_engineering_document_revisions where id=$1",[data.revisionId]);
    const current=rows[0];
    if(!current) throw new Error("Engineering document revision not found.");
    const allowed=(current.status==="draft"&&data.toStatus==="pending_approval")||(current.status==="pending_approval"&&["approved","rejected"].includes(data.toStatus));
    if(!allowed) throw new Error("Invalid engineering document lifecycle transition: "+current.status+" → "+data.toStatus);
    if(data.toStatus==="pending_approval"){
      const count=await sql.query<{count:number|string}>("select count(*) as count from vyndi_engineering_document_links where revision_id=$1",[data.revisionId]);
      if(Number(count[0]?.count??0)===0) throw new Error("Document revision cannot be submitted without at least one governed where-used link.");
    }
    if(data.toStatus==="approved"&&current.created_by===actor.userId) throw new Error("SOD_MAKER_CHECKER: document creator cannot approve the same revision.");
    await sql.query("update vyndi_engineering_document_revisions set status=$2,submitted_by=case when $2='pending_approval' then $3 else submitted_by end,approved_by=case when $2='approved' then $3 else approved_by end,approved_at=case when $2='approved' then now() else approved_at end,source_ref=$4 where id=$1",[data.revisionId,data.toStatus,actor.userId,data.sourceReference]);
    await sql.query("insert into vyndi_audit_events(id,entity_type,entity_id,action,actor_user_id,actor_role,source_reference,payload_json) values($1,'engineering_document_revision',$2,'ENGINEERING_DOCUMENT_STATUS_CHANGED',$3,$4,$5,$6::jsonb)",[crypto.randomUUID(),data.revisionId,actor.userId,actor.role,data.sourceReference,JSON.stringify({from:current.status,to:data.toStatus,reason:data.reason})]);
    return {ok:true,fromStatus:current.status,toStatus:data.toStatus};
  });

export const releaseEngineeringDocumentRevision=createServerFn({method:"POST"})
  .validator(z.object({revisionId:z.string().trim().min(1).max(180),releaseNote:z.string().trim().min(2).max(1200),sourceReference:z.string().trim().min(2).max(800)}))
  .handler(async({data})=>{
    const actor=await requireEngineering("approve");
    const sql=await getSql();
    const rows=await sql.query<{release_vyndi_engineering_document_revision:string}>("select release_vyndi_engineering_document_revision($1,$2,$3,$4,$5)",[data.revisionId,data.releaseNote,data.sourceReference,actor.userId,actor.role]);
    return {ok:true,revisionId:rows[0]?.release_vyndi_engineering_document_revision??data.revisionId};
  });

export const captureEngineeringConfigurationManifest=createServerFn({method:"POST"})
  .validator(z.object({baselineId:z.string().trim().min(1).max(180),bomReleaseId:z.string().trim().max(180).nullable().optional(),sourceReference:z.string().trim().min(2).max(800)}))
  .handler(async({data})=>{
    const actor=await requireEngineering("approve");
    const sql=await getSql();
    const baselines=await sql.query<{id:string;bom_revision:string|null;status:string}>("select id,bom_revision,status from vyndi_engineering_baselines where id=$1",[data.baselineId]);
    const baseline=baselines[0];
    if(!baseline||baseline.status!=="released") throw new Error("Released Engineering baseline not found.");
    const rows=await sql.query<RevisionRow>("select distinct r.id,r.document_id,d.document_number,d.title,d.document_type,r.revision_code,r.status,r.content_sha256,r.file_name,r.media_type,r.file_size_bytes,r.source_uri,r.source_ref,r.created_by,r.submitted_by,r.approved_by,r.released_by,r.supersedes_revision_id,r.superseded_by_revision_id,r.release_note,r.created_at::text,r.approved_at::text,r.released_at::text,r.superseded_at::text from vyndi_engineering_document_revisions r join vyndi_engineering_documents d on d.id=r.document_id join vyndi_engineering_document_links l on l.revision_id=r.id where r.status='released' and l.relation='CONTROLS' and ((l.target_type='engineering_baseline' and l.target_id=$1) or (l.target_type='bom_revision' and $2::text is not null and l.target_id=$2) or (l.target_type='ecn' and exists(select 1 from vyndi_engineering_change_notices n where n.id=l.target_id and n.target_baseline_id=$1))) order by d.document_number,r.id",[data.baselineId,data.bomReleaseId??null]);
    const manifest=buildReleasedConfigurationManifest({baselineId:data.baselineId,bomRevision:baseline.bom_revision,revisions:rows.map(revision)});
    const id="ENG-MANIFEST-"+crypto.randomUUID();
    const documents=manifest.documents.map((item)=>({document_id:item.documentId,revision_id:item.revisionId,content_sha256:item.contentSha256}));
    await sql.query("select capture_vyndi_engineering_configuration_manifest($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9::jsonb)",[id,data.baselineId,data.bomReleaseId??null,manifest.configurationFingerprint,JSON.stringify(manifest),data.sourceReference,actor.userId,actor.role,JSON.stringify(documents)]);
    return {ok:true,id,manifest};
  });
