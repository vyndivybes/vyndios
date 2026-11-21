import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";

/**
 * Founder-only commissioning page. Backend Better Auth clientPrivileges is the
 * real authority: verified founder email and same native session user ID.
 * Generated client secret is kept in component memory ONLY; no storage, logs,
 * URL, query string, analytics, or GitHub text receives credential material.
 */
export const Route=createFileRoute("/sso-client")({component:FounderClientRegistration});

const REDIRECT="https://vaos.vayushastr.workers.dev/api/founder-sso-callback";
const FOUNDER_EMAIL="shyamsundhar1982@gmail.com";
function FounderClientRegistration(){
 const [authorized,setAuthorized]=useState(false);
 const [checking,setChecking]=useState(true);
 const [busy,setBusy]=useState(false);
 const [status,setStatus]=useState("");
 const [credential,setCredential]=useState<{id:string;secret:string}|null>(null);

 useEffect(()=>{
  let alive=true;
  void import("@/lib/auth/client").then(({authClient})=>authClient.getSession())
   .then(({data})=>{
    if(!alive)return;
    const user=data?.user;
    setAuthorized(user?.email?.trim().toLowerCase()===FOUNDER_EMAIL&&user.emailVerified===true);
   })
   .catch(()=>{if(alive)setAuthorized(false);})
   .finally(()=>{if(alive)setChecking(false);});
  return ()=>{alive=false;};
 },[]);

 async function copyCredential(kind:"id"|"secret"){
  if(!credential)return;
  // Clipboard access is triggered only by this explicit button click.
  // Never log, persist, reveal, transmit, or interpolate the credential into status.
  const value=kind==="secret"?credential.secret:credential.id;
  try{
   if(!navigator.clipboard?.writeText)throw Error("CLIPBOARD_UNAVAILABLE");
   await navigator.clipboard.writeText(value);
   setStatus(kind==="secret"
    ?"Secret copied. Paste it directly into the Cloudflare encrypted secret field. Clear this screen afterward."
    :"Client ID copied. Paste it into the Cloudflare VAOS client ID field.");
  }catch{
   setStatus("Browser clipboard access was blocked. Click the credential field and press Ctrl+A, then Ctrl+C. Paste only into Cloudflare.");
  }
 }

 async function register(){
  if(!authorized||busy||credential)return;
  setBusy(true);
  setStatus("");
  try{
   const {authClient}=await import("@/lib/auth/client");
   const response=await authClient.oauth2.createClient({
    client_name:"VAOS JARVIS — Vāyú Shastr internal founder login",
    redirect_uris:[REDIRECT],
    token_endpoint_auth_method:"client_secret_basic",
    grant_types:["authorization_code"],
    response_types:["code"],
   });
   if(response.error){
    setStatus("Registration declined. Your existing login and permissions are unchanged.");
    return;
   }
   const obj=(response.data??{}) as unknown as Record<string,unknown>;
   const id=typeof obj.client_id==="string"?obj.client_id:"";
   const secret=typeof obj.client_secret==="string"?obj.client_secret:"";
   if(!id||!secret){
    setStatus("No confidential client credential returned. Stop commissioning and inspect the provider.");
    return;
   }
   setCredential({id,secret});
   setStatus("Registered. Store the two credentials as Cloudflare VAOS encrypted secrets, then clear them from this screen.");
  }catch{
   setStatus("OAuth client registration is unavailable. Keep your existing accounts.");
  }finally{setBusy(false);}
 }
 return(
  <main className="min-h-screen bg-slate-950 px-6 py-16 text-white">
   <section className="mx-auto max-w-xl rounded-3xl border border-white/10 bg-slate-900 p-8 shadow-2xl">
    <p className="text-xs font-semibold uppercase tracking-widest text-orange-400">VYNDI OS · Security commissioning</p>
    <h1 className="mt-4 text-2xl font-semibold">Register VAOS founder SSO</h1>
    <p className="mt-4 text-sm text-slate-300">
     Creates exactly one confidential OAuth client for the fixed VAOS callback using
     authorization code and PKCE. Does not activate SSO or business writes.
    </p>
    <p className="mt-3 text-sm text-slate-400">
     This is only for the verified existing founder account. Never paste the secret into
     ChatGPT, GitHub, email or screenshots. Use Cloudflare encrypted secrets.
    </p>
    {checking?<p className="mt-6 text-sm">Checking your VYNDI sign-in…</p>
     :!authorized?<p role="alert" className="mt-6 text-sm text-amber-300">
       Sign in using the verified founder account to commission this client.
      </p>
     :<button type="button" disabled={busy||!!credential} onClick={()=>void register()}
       className="mt-6 rounded-xl bg-orange-500 px-5 py-3 text-sm font-semibold text-black disabled:opacity-50">
       {busy?"Registering…":"Register one VAOS confidential client"}
      </button>
    }
    {credential&&
     <div className="mt-6 space-y-4 border-t border-white/10 pt-6">
      <p className="text-sm font-semibold text-amber-300">One-time credentials — keep private</p>
      <label className="block text-xs">Client ID
       <input readOnly value={credential.id} className="mt-2 block w-full rounded-lg border border-white/20 bg-slate-950 px-3 py-2"/>
      </label>
      <button type="button" onClick={()=>void copyCredential("id")}
       className="rounded-lg border border-white/20 px-4 py-2 text-sm font-semibold">
       Copy Client ID
      </button>
      <label className="block text-xs">Client secret
       <input readOnly type="password" autoComplete="off" value={credential.secret} className="mt-2 block w-full rounded-lg border border-white/20 bg-slate-950 px-3 py-2"/>
      </label>
      <button type="button" onClick={()=>void copyCredential("secret")}
       className="rounded-lg bg-orange-500 px-4 py-2 text-sm font-semibold text-black">
       Copy Secret
      </button>
      <button type="button" onClick={()=>setCredential(null)}
       className="rounded-xl border border-white/20 px-4 py-3 text-sm">Clear credentials</button>
     </div>
    }
    {status?<p role="status" className="mt-5 text-sm text-slate-300">{status}</p>:null}
   </section>
  </main>
 );
}
