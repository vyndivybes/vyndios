import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireBusinessActor } from "@/lib/business-actor";
import { getCommandRole } from "@/lib/command-access";
import { canPerform } from "@/lib/page-access";
import { getRouteMeta } from "@/lib/page-metadata";
import { getSql } from "@/lib/db";
import { prepareExternalCaCertificate, assessCaPortalCheck } from "./ca-certificate-controls.mjs";

const permissionRoute = "/command/finance-control";
async function requireFinanceView() {
  const role=await getCommandRole();
  if(!role || !canPerform(role,"view",getRouteMeta(permissionRoute)))
    throw new Error("CA certificate register view permission denied.");
}
async function requireFinanceEdit() {
  const actor=await requireBusinessActor("edit");
  if(!canPerform(actor.role,"edit",getRouteMeta(permissionRoute)))
    throw new Error("CA certificate evidence recording permission denied.");
  return actor;
}
async function requireIndependentChecker() {
  const actor=await requireBusinessActor("approve");
  if(!canPerform(actor.role,"approve",getRouteMeta(permissionRoute)))
    throw new Error("CA certificate UDIN checking permission denied.");
  return actor;
}
const id=z.string().trim().min(3).max(160).regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]+$/);
const evidence=z.string().trim().min(5).max(500);
const day=z.string().regex(/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/);
const udin=z.string().trim().toUpperCase().regex(/^[0-9]{8}[A-Z0-9]{10}$/);
const documentSha=z.string().trim().toLowerCase().regex(/^[0-9a-f]{64}$/);
const membership=z.string().regex(/^[0-9]{6}$/);
const certificateType=z.enum(["financial_statements","tax_audit","gst_audit","other_certificate"]);

export const getCaSignedCertificateRegister=createServerFn({method:"GET"}).handler(async()=>{
  await requireFinanceView();
  const sql=await getSql();
  const rows=await sql.query<{
    certificate_id:string;document_type:string;period_from:string;period_to:string;
    signed_on:string;ca_name:string;ca_membership_number:string;udin:string;
    signed_document_sha256:string;signed_document_reference:string;status:string;
    recorded_by:string;recorded_at:string;checked_by:string|null;checked_at:string|null;
    observed_membership_number:string|null;checker_recorded_outcome:string|null;
    portal_check_evidence_reference:string|null;
  }>(
    `select certificate_id,document_type,period_from::text,period_to::text,signed_on::text,
            ca_name,ca_membership_number,udin,signed_document_sha256,signed_document_reference,
            status,recorded_by,recorded_at::text,checked_by,checked_at::text,
            observed_membership_number,checker_recorded_outcome,portal_check_evidence_reference
       from epr_finance_ca_signed_certificates
      order by recorded_at desc limit 100`
  );
  return rows.map(row=>({...row,icaiApiVerified:false,certificateIssuedBySystem:false}));
});

/** Only records a signed EXTERNAL CA document and its cited hash/UDIN.
 * Never issues or certifies a document.
 */
export const registerExternalCaSignedCertificate=createServerFn({method:"POST"})
  .validator(z.object({
    id, type:certificateType,
    periodFrom:day,periodTo:day,signedOn:day,
    caName:z.string().trim().min(3).max(160),membershipNumber:membership,
    udin,signedDocumentSha256:documentSha,signedDocumentReference:evidence,
  }))
  .handler(async({data})=>{
    const actor=await requireFinanceEdit();
    const record=prepareExternalCaCertificate(data);
    const sql=await getSql();
    const rows=await sql.query<{certificate_id:string}>(
      `with registered as (
         insert into epr_finance_ca_signed_certificates(
           certificate_id,document_type,period_from,period_to,signed_on,
           ca_name,ca_membership_number,udin,signed_document_sha256,signed_document_reference,recorded_by
         ) values($1,$2,$3::date,$4::date,$5::date,$6,$7,$8,$9,$10,$11)
         returning certificate_id,signed_document_reference
       ), logged as (
         insert into epr_finance_ca_certificate_events(certificate_id,event_type,actor_user_id,evidence_reference)
         select certificate_id,'recorded',$11,signed_document_reference from registered
         returning certificate_id
       ) select registered.certificate_id from registered join logged using(certificate_id)`,
      [record.id,record.type,record.periodFrom,record.periodTo,record.signedOn,
       record.caName,record.membershipNumber,record.udin,
       record.signedDocumentSha256,record.signedDocumentReference,actor.userId]
    );
    if(!rows[0])throw new Error("External CA certificate registration was not recorded.");
    return {ok:true,id:rows[0].certificate_id,status:"recorded_unverified" as const,
      issuedBySystem:false,icaiVerified:false};
  });

/** Records an independently observed portal result. Checker must perform the
 * actual UDIN lookup with ICAI independently; this service does NOT call ICAI.
 */
export const recordIndependentCaUdinCheck=createServerFn({method:"POST"})
  .validator(z.object({
    id,observedMembershipNumber:membership,
    outcome:z.enum(["match","not_found","mismatch"]),
    verificationReference:evidence,
  }))
  .handler(async({data})=>{
    const actor=await requireIndependentChecker();
    const sql=await getSql();
    const [stored]=await sql.query<{
      certificate_id:string;status:string;recorded_by:string;ca_membership_number:string;
    }>(
      `select certificate_id,status,recorded_by,ca_membership_number
         from epr_finance_ca_signed_certificates where certificate_id=$1`,[data.id]);
    if(!stored)throw new Error("Recorded CA certificate not found.");
    const check=assessCaPortalCheck({
      certificate:{status:stored.status,recordedBy:stored.recorded_by,membershipNumber:stored.ca_membership_number} as never,
      checkerId:actor.userId,observedMembershipNumber:data.observedMembershipNumber,
      outcome:data.outcome,verificationReference:data.verificationReference,
    });
    const rows=await sql.query<{certificate_id:string;status:string}>(
      `with checked as (
         update epr_finance_ca_signed_certificates
            set status=$2,checked_by=$3,checked_at=now(),observed_membership_number=$4,
                checker_recorded_outcome=$5,portal_check_evidence_reference=$6
          where certificate_id=$1 and status='recorded_unverified' and recorded_by<>$3
          returning certificate_id,status
       ), logged as (
          insert into epr_finance_ca_certificate_events(certificate_id,event_type,actor_user_id,evidence_reference)
          select certificate_id,status,$3,$6 from checked
          returning certificate_id
       ) select checked.certificate_id,checked.status from checked join logged using(certificate_id)`,
      [data.id,check.status,actor.userId,data.observedMembershipNumber,data.outcome,
       data.verificationReference]
    );
    if(!rows[0])throw new Error("Certificate changed, already checked, or self-approval prohibited.");
    return {ok:true,id:rows[0].certificate_id,status:rows[0].status,
      icaiApiVerified:false,externalCertificateIssuedBySystem:false};
  });
