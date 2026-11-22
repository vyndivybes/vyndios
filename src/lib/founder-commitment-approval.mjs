/**
 * Founder-approved exception for actual purchase commitments and supplier
 * payment posting. This is invoked *after* Better Auth and same-site/role
 * verification by requirePageActor, never from caller-provided user metadata.
 * No email, wire, bank API or supplier message is sent here.
 */
const FOUNDER_EMAIL='shyamsundhar1982@gmail.com';
export const FOUNDER_COMMITMENT_PRINCIPAL_SQL = `
  SELECT id AS verified_founder_id
    FROM public."user"
   WHERE id=$1
     AND lower(btrim(email))=$2
     AND "emailVerified" IS TRUE
   LIMIT 2
`;
const denied=()=>{throw Error('FOUNDER_COMMITMENT_APPROVAL_REQUIRED: Only an individually authenticated, email-verified managing director with an admin role may authorize purchase commitments or supplier-payment posting. Internal drafts remain permitted.');};
export async function requireVerifiedFounderCommitment({actor,sql}={}){
 if(!actor||actor.role!=='admin'||typeof actor.userId!=='string'||!actor.userId.trim()
   ||!sql||typeof sql.query!=='function')denied();
 const rows=await sql.query(FOUNDER_COMMITMENT_PRINCIPAL_SQL,[actor.userId,FOUNDER_EMAIL]);
 if(!Array.isArray(rows)||rows.length!==1||rows[0]?.verified_founder_id!==actor.userId)denied();
 return Object.freeze({
  founderVerified:true,
  purchaseReleaseAuthorizedByThisCheck:true,
  externalDispatchAuthorizedByThisCheck:false,
 });
}
