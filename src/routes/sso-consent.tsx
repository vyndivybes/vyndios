import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

/**
 * Better Auth's oauthProviderClient attaches the signed oauth_query to its
 * consent request. The query is never interpreted here as proof of identity.
 * The provider validates scopes, session and the registered client.
 */
export const Route=createFileRoute("/sso-consent")({component:SsoConsent});

function trustedReturn(value:unknown):string|null{
 if(typeof value!=="string"||!value||value.length>4096)return null;
 try{
  const u=new URL(value,window.location.origin);
  if(u.protocol!=="https:"||u.username||u.password||u.hash)return null;
  if(u.origin==="https://vaos.vayushastr.workers.dev"&&
     u.pathname==="/api/founder-sso-callback"&&
     u.searchParams.has("code")&&u.searchParams.has("state")&&
     u.searchParams.get("iss")==="https://vyndios.vayushastr.workers.dev/api/auth")
    return u.href;
  if(u.origin===window.location.origin&&
     (u.pathname==="/api/auth/oauth2/authorize"||
      u.pathname==="/api/auth/oauth2/continue"))
    return u.href;
 }catch{ /* fail closed */ }
 return null;
}
function SsoConsent(){
 const [busy,setBusy]=useState(false);
 const [status,setStatus]=useState("");
 async function decision(accept:boolean){
  if(busy)return;
  setBusy(true);
  setStatus("");
  try{
   const {authClient}=await import("@/lib/auth/client");
   const response=await authClient.oauth2.consent({
    accept,
    scope:accept?"openid email":undefined,
   });
   if(response.error){
    setStatus("Unable to complete authorization. Return to VYNDI OS and try again.");
    return;
   }
   // Never navigate based on unsigned oauth_query, Referer, or caller parameters.
   // Accept only a validated URL supplied by the trusted Better Auth response.
   const result=(response.data??{}) as Record<string,unknown>;
   const target=trustedReturn(result.redirect_uri??result.redirectURI??result.url??result.redirect);
   if(target)window.location.assign(target);
   else setStatus("Authorization response has no trusted continuation. No VAOS login was created.");
  }catch{
   setStatus("Authorization service unavailable. Your VYNDI account is unchanged.");
  }finally{setBusy(false);}
 }
 return(
  <main className="min-h-screen bg-slate-950 px-6 py-16 text-white">
   <section className="mx-auto max-w-md rounded-3xl border border-white/10 bg-slate-900 p-8 shadow-2xl">
    <p className="text-sm font-semibold tracking-widest text-orange-400">VĀYÚ SHASTR · VYNDI OS</p>
    <h1 className="mt-4 text-2xl font-semibold">Authorize VAOS JARVIS</h1>
    <p className="mt-4 text-sm text-slate-300">
     VAOS requests permission to confirm your signed-in identity and verified email.
     This does not grant access to financial records, procurement, inventory, or write actions.
    </p>
    <p className="mt-3 text-xs text-slate-400">
     Confirm only if you initiated the sign-in from your VAOS page.
    </p>
    <div className="mt-8 flex gap-3">
     <button type="button" disabled={busy} onClick={()=>void decision(false)}
      className="flex-1 rounded-xl border border-white/20 px-4 py-3 text-sm font-semibold disabled:opacity-50">Deny</button>
     <button type="button" disabled={busy} onClick={()=>void decision(true)}
      className="flex-1 rounded-xl bg-orange-500 px-4 py-3 text-sm font-semibold text-black disabled:opacity-50">Allow identity verification</button>
    </div>
    {status?<p role="status" className="mt-4 text-sm text-slate-300">{status}</p>:null}
   </section>
  </main>
 );
}
