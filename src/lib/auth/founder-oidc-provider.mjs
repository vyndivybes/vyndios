/**
 * Vāyú Shastr founder OAuth2.1/OIDC issuer commissioning gate.
 *
 * This does not open OAuth endpoints until a reviewed provider schema, 
 * trusted VAOS client and production browser qualification exist.
 * Better Auth owns the authorization-code lifecycle; never mint an identity
 * from an email parameter or use the signed read-only VAOS bridge as login.
 */
const FOUNDER='shyamsundhar1982@gmail.com';
const TRUSTED_CLIENT=/^[A-Za-z0-9][A-Za-z0-9._:~-]{5,127}$/;
const CONTROL='commissioned-v1';

/** @param {Record<string, unknown>} env */
export function founderOidcProviderEnabled(env={}){
 return env?.VYNDI_SSO_PROVIDER_ENABLED===CONTROL;
}

/**
 * Strict account-level privilege control for OAuth client registration,
 * modification and deletion. Unverified principal or an unbound session is
 * NEVER sufficient, even if a source business policy says MD_APPROVED.
 * @param {{user?:unknown,session?:unknown}} actor
 */
export async function founderCanManageOidcClient({user,session}={}){
 if(!user||typeof user!=='object'||!session||typeof session!=='object')return false;
 const email=typeof user.email==='string'?user.email.trim().toLowerCase():'';
 return email===FOUNDER&&user.emailVerified===true&&
  typeof user.id==='string'&&user.id.length>0&&
  typeof session.userId==='string'&&session.userId===user.id;
}

/** @param {Record<string,unknown>} env */
export function founderOidcProviderOptions(env={}){
 if(!founderOidcProviderEnabled(env))return null;
 const hasId=Object.hasOwn(env,'VYNDI_SSO_TRUSTED_CLIENT_ID');
 const id=env.VYNDI_SSO_TRUSTED_CLIENT_ID;
 if(hasId&&(typeof id!=='string'||!TRUSTED_CLIENT.test(id)))
  throw Error('OIDC_TRUSTED_CLIENT_INVALID');
 return {
  loginPage:'/login',
  consentPage:'/sso-consent',
  // A registered confidential client requires an independently signed-in
  // and verified Better Auth founder session. Never enable open registration.
  allowDynamicClientRegistration:false,
  allowUnauthenticatedClientRegistration:false,
  clientPrivileges:founderCanManageOidcClient,
  cachedTrustedClients:new Set(hasId?[id]:[]),
  scopes:['openid','email'],
  // No "offline_access", user profile or business permissions.
  codeExpiresIn:300,
  idTokenExpiresIn:300,
  accessTokenExpiresIn:900,
 };
}
