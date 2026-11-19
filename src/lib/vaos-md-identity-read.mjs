/**
 * Evidence about an existing Better Auth account for the Managing Director,
 * NOT authentication by email, source-of-truth certification, shared SSO,
 * new sessions, role grants or authorization for financial/physical actions.
 *
 * The principal is fixed by policy; never accept a caller-selected identity.
 */
const FOUNDER='shyamsundhar1982@gmail.com';
export const MD_IDENTITY_EVIDENCE_SQL = `
SELECT
 (SELECT count(*)::integer FROM public."user" u
   WHERE lower(btrim(u.email))=$1) AS identity_count,
 (SELECT count(*)::integer FROM public."user" u
   WHERE lower(btrim(u.email))=$1 AND u."emailVerified" IS TRUE)
   AS verified_identity_count,
 (SELECT count(*)::integer FROM public."user" u
   JOIN public.vindy_user_roles r ON r.user_id=u.id
   WHERE lower(btrim(u.email))=$1 AND r.role='admin')
   AS admin_assignment_count,
 (SELECT count(*)::integer FROM public."user" u
   JOIN public."account" a ON a."userId"=u.id
   WHERE lower(btrim(u.email))=$1) AS linked_provider_count,
 (SELECT count(*)::integer FROM public."user" u
   JOIN public."session" s ON s."userId"=u.id
   WHERE lower(btrim(u.email))=$1 AND s."expiresAt">now())
   AS unexpired_session_count`;
/** @param {unknown} value */
function safeCount(value){
 if(typeof value!=='number'||!Number.isSafeInteger(value)||value<0)
  throw Error('MD_IDENTITY_EVIDENCE_INVALID');
 return value;
}
/** @typedef {{identity_count:number,verified_identity_count:number,
 * admin_assignment_count:number,linked_provider_count:number,
 * unexpired_session_count:number}} MdIdentitySqlRow */
/** @typedef {import('./db').Sql} MdIdentitySql */
/**
 * Read-only, bounded, fixed-principal credential evidence. This is NOT a
 * login action and cannot mint Better Auth sessions or business authority.
 * @param {{sql?:MdIdentitySql}} options
 */
export async function readManagingDirectorIdentityEvidence(options={}){
 if(!options||typeof options!=='object'||Array.isArray(options)||
    Object.keys(options).some(key=>key!=='sql'))throw Error('MD_IDENTITY_SCOPE_FORBIDDEN');
 const {sql}=options;
 if(!sql||typeof sql.query!=='function')throw Error('MD_IDENTITY_SQL_UNAVAILABLE');
 const rows=await sql.query(MD_IDENTITY_EVIDENCE_SQL,[FOUNDER]);
 if(!Array.isArray(rows)||rows.length!==1||!rows[0])throw Error('MD_IDENTITY_EVIDENCE_INVALID');
 const row=rows[0];
 const n=safeCount(row.identity_count);
 const verified=safeCount(row.verified_identity_count);
 const admin=safeCount(row.admin_assignment_count);
 const providers=safeCount(row.linked_provider_count);
 const sessions=safeCount(row.unexpired_session_count);
 if(verified>n||admin>n||(n===0&&(providers!==0||sessions!==0)))
  throw Error('MD_IDENTITY_EVIDENCE_INVALID');
 const unique=n===1;
 const holds=['INDEPENDENT_BROWSER_SESSION_AND_SSO_UNVERIFIED','NO_CROSS_APP_AUTH_GRANT'];
 if(!unique)holds.push('FOUNDER_IDENTITY_NOT_UNIQUE');
 if(unique&&!verified)holds.push('VYNDI_EMAIL_NOT_VERIFIED');
 if(unique&&!admin)holds.push('VYNDI_ADMIN_ROLE_NOT_ASSIGNED');
 if(unique&&!providers)holds.push('VYNDI_PROVIDER_LINK_MISSING');
 if(unique&&!sessions)holds.push('CURRENT_VYNDI_BROWSER_SESSION_NOT_PROVED');
 return Object.freeze({
  schemaVersion:'VYNDI_MD_IDENTITY_EVIDENCE_V1',
  status:'HOLD',readOnly:true,
  existingAccountLocated:unique,
  emailVerified:unique&&verified===1,
  adminRoleAssigned:unique&&admin===1,
  accountProviderLinked:unique&&providers>0,
  unexpiredSessionRecordPresent:unique&&sessions>0,
  // Session rows do NOT establish a session for the VAOS requesting browser.
  vaosSessionVerifiedHere:false,
  vyndiBrowserSessionVerifiedHere:false,
  crossPlatformSsoEnabled:false,
  mdAuthenticatedAcrossBoth:false,
  businessApprovalAuthorized:false,
  productionWriteAuthorized:false,
  sourceRevisionCertified:false,
  holds:Object.freeze(holds),
 });
}
