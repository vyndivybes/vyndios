/**
 * Founder-only SSO protocol: VYNDI Better Auth is the identity authority;
 * VAOS uses a short-lived S256 PKCE authorization code to establish its own
 * origin-bound hardened cookie after a signed server-to-server redemption.
 *
 * This is an AUTHENTICATION operation, never an ERP write grant or source
 * certification. Do not accept caller-supplied user identities, emails, scopes,
 * audiences, tenants, roles, domains or redirect destinations.
 */
export const FOUNDER_SSO_CLIENT_ID='vaos-jarvis-v1';
export const FOUNDER_SSO_CALLBACK='https://vaos.vayushastr.workers.dev/api/sso/callback';
export const FOUNDER_SSO_ISSUER='https://vyndios.vayushastr.workers.dev';
export const FOUNDER_SSO_PROTOCOL_VERSION='vaos-founder-sso.v1';
export const FOUNDER_SSO_REDEEM_PATH='/api/sso/redeem';
export const FOUNDER_SSO_AUTHORIZATION_PATH='/api/sso/authorize';
export const FOUNDER_SSO_EMAIL='shyamsundhar1982@gmail.com';

const SAFE_43_128=/^[a-zA-Z0-9_-]{43,128}$/;
const SAFE_CODE=/^[a-zA-Z0-9_-]{43,128}$/;
const AUTH_FIELDS=['client_id','redirect_uri','response_type','state','nonce','code_challenge','code_challenge_method'];
const REDEEM_FIELDS=['protocolVersion','serviceIdentity','audience','method','path','purpose','clientId','redirectUri','code','codeVerifier'];
const invalidAuth=()=>{throw Error('SSO_AUTHORIZATION_INVALID')};
const invalidRedeem=()=>{throw Error('SSO_REDEEM_INVALID')};
/** @param {URLSearchParams} params */
export function validateFounderSsoAuthorization(params){
 if(!(params instanceof URLSearchParams))return invalidAuth();
 const all=[...params.keys()];
 if(all.length!==AUTH_FIELDS.length||AUTH_FIELDS.some(key=>params.getAll(key).length!==1)||
    all.some(key=>!AUTH_FIELDS.includes(key))||
    params.get('client_id')!==FOUNDER_SSO_CLIENT_ID||
    params.get('redirect_uri')!==FOUNDER_SSO_CALLBACK||
    params.get('response_type')!=='code'||
    params.get('code_challenge_method')!=='S256')return invalidAuth();
 const state=params.get('state'),nonce=params.get('nonce'),challenge=params.get('code_challenge');
 if(!SAFE_43_128.test(state||'')||!SAFE_43_128.test(nonce||'')||
    !/^[A-Za-z0-9_-]{43}$/.test(challenge||''))return invalidAuth();
 return Object.freeze({
  clientId:FOUNDER_SSO_CLIENT_ID,redirectUri:FOUNDER_SSO_CALLBACK,
  state,nonce,challenge
 });
}
/** @param {unknown} raw */
export function validateFounderSsoRedeem(raw){
 if(!raw||typeof raw!=='object'||Array.isArray(raw))return invalidRedeem();
 const fields=Object.keys(raw);
 if(fields.length!==REDEEM_FIELDS.length||fields.some(k=>!REDEEM_FIELDS.includes(k)))
  return invalidRedeem();
 const d=raw;
 if(d.protocolVersion!==FOUNDER_SSO_PROTOCOL_VERSION||d.serviceIdentity!=='vaos'||
    d.audience!=='vyndi-os'||d.method!=='POST'||d.path!==FOUNDER_SSO_REDEEM_PATH||
    d.purpose!=='authenticate-founder'||d.clientId!==FOUNDER_SSO_CLIENT_ID||
    d.redirectUri!==FOUNDER_SSO_CALLBACK||
    !SAFE_CODE.test(d.code||'')||!SAFE_43_128.test(d.codeVerifier||''))
  return invalidRedeem();
 return Object.freeze({code:d.code,codeVerifier:d.codeVerifier,
  clientId:FOUNDER_SSO_CLIENT_ID,redirectUri:FOUNDER_SSO_CALLBACK});
}
