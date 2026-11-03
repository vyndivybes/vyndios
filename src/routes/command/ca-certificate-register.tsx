import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useState, type ChangeEvent, type FormEvent } from "react";
import { Panel } from "@/components/kpi";
import {
  getCaSignedCertificateRegister,
  registerExternalCaSignedCertificate,
  recordIndependentCaUdinCheck,
} from "@/lib/finance/ca-certificate-authority";

export const Route=createFileRoute("/command/ca-certificate-register")({
  loader:()=>getCaSignedCertificateRegister(),
  component: CaCertificateRegister,
});

const today=()=>new Date().toISOString().slice(0,10);

const inputClass="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-fg";
const controlLabel="text-xs font-semibold text-muted";
function CaCertificateRegister() {
  const rows=Route.useLoaderData();
  const router=useRouter();
  const [form,setForm]=useState({
    id:"",type:"financial_statements" as "financial_statements"|"tax_audit"|"gst_audit"|"other_certificate",
    periodFrom:"",periodTo:"",signedOn:today(),
    caName:"",membershipNumber:"",udin:"",signedDocumentReference:"",signedDocumentSha256:"",
  });
  const [checker,setChecker]=useState({
    id:"",observedMembershipNumber:"",outcome:"match" as "match"|"not_found"|"mismatch",
    verificationReference:"",
  });
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState("");
  const [chosenFile,setChosenFile]=useState("");
  async function digestSignedPdf(event:ChangeEvent<HTMLInputElement>) {
    setForm(p=>({...p,signedDocumentSha256:""}));
    setChosenFile("");
    setMessage("");
    const file=event.target.files?.[0];
    if(!file)return;
    if(file.size===0 || file.size>20_000_000 || !file.name.toLowerCase().endsWith(".pdf")) {
      setMessage("Choose a signed PDF up to 20 MB. The PDF remains in your browser.");
      return;
    }
    try {
      const hash=await crypto.subtle.digest("SHA-256",await file.arrayBuffer());
      const sha=Array.from(new Uint8Array(hash),b=>b.toString(16).padStart(2,"0")).join("");
      setForm(p=>({...p,signedDocumentSha256:sha}));
      setChosenFile(file.name);
    } catch {
      setMessage("Could not hash the signed PDF in this browser.");
    }
  }
  async function record(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);setMessage("");
    try {
      if(!chosenFile || !form.signedDocumentSha256)throw Error("First select the externally signed CA PDF.");
      await registerExternalCaSignedCertificate({data:form});
      setMessage("External CA signed document recorded. UDIN verification remains outstanding.");
      await router.invalidate();
    } catch(e) {setMessage(e instanceof Error?e.message:"Recording failed");}
    finally {setBusy(false);}
  }
  async function check(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);setMessage("");
    try {
      await recordIndependentCaUdinCheck({data:checker});
      setMessage("Independent portal observation saved. This application did not access ICAI or issue a certificate.");
      await router.invalidate();
    } catch(e) {setMessage(e instanceof Error?e.message:"Portal observation failed");}
    finally {setBusy(false);}
  }
  return <main className="mx-auto max-w-6xl space-y-5">
    <header className="space-y-2">
      <p className="text-xs font-semibold uppercase tracking-wider text-accent">Finance · external CA certification evidence</p>
      <h1 className="font-display text-3xl text-fg">CA-Signed Accounts Register</h1>
      <p className="max-w-4xl text-sm text-muted">
        Record a financial statement or report <strong>already signed by an independent practising Chartered Accountant</strong>.
        The CA issues the actual certificate and UDIN externally. This screen does not issue certificates,
        verify ICAI credentials online, audit the books, or change posted transactions.
      </p>
      <Link to="/command/accounting-statements" className="inline-block text-sm font-semibold text-accent">
        ← Posted Financial Statements
      </Link>
    </header>
    {message && <p role="status" className="rounded-lg border border-border p-3 text-sm text-fg">{message}</p>}
    <div className="grid gap-4 xl:grid-cols-2">
      <Panel title="Record externally signed CA certificate" kicker="Signed document + ICAI member and UDIN evidence">
        <form onSubmit={record} className="grid gap-3 sm:grid-cols-2">
          <label className={controlLabel}>Certificate ID<input className={inputClass} required value={form.id}
            onChange={e=>setForm(p=>({...p,id:e.target.value}))}/></label>
          <label className={controlLabel}>Certificate type<select className={inputClass} value={form.type}
            onChange={e=>setForm(p=>({...p,type:e.target.value as typeof p.type}))}>
            <option value="financial_statements">Financial statements</option>
            <option value="tax_audit">Tax audit report</option>
            <option value="gst_audit">GST audit report</option>
            <option value="other_certificate">Other CA certificate</option>
          </select></label>
          <label className={controlLabel}>Accounting period from<input className={inputClass} type="date" required value={form.periodFrom}
            onChange={e=>setForm(p=>({...p,periodFrom:e.target.value}))}/></label>
          <label className={controlLabel}>Accounting period to<input className={inputClass} type="date" required value={form.periodTo}
            onChange={e=>setForm(p=>({...p,periodTo:e.target.value}))}/></label>
          <label className={controlLabel}>CA name<input className={inputClass} required value={form.caName}
            onChange={e=>setForm(p=>({...p,caName:e.target.value}))}/></label>
          <label className={controlLabel}>CA membership number (6 digits)<input className={inputClass} inputMode="numeric" required maxLength={6}
            value={form.membershipNumber} onChange={e=>setForm(p=>({...p,membershipNumber:e.target.value}))}/></label>
          <label className={controlLabel}>ICAI-issued UDIN<input className={inputClass} required maxLength={18}
            value={form.udin} onChange={e=>setForm(p=>({...p,udin:e.target.value.toUpperCase()}))}/></label>
          <label className={controlLabel}>CA signature date<input className={inputClass} type="date" required value={form.signedOn}
            onChange={e=>setForm(p=>({...p,signedOn:e.target.value}))}/></label>
          <label className={controlLabel}>Signed PDF (hashed locally, not uploaded)<input className={inputClass} type="file" accept=".pdf,application/pdf" required
            onChange={e=>void digestSignedPdf(e)}/></label>
          <label className={controlLabel}>Signed PDF retention/reference<input className={inputClass} required value={form.signedDocumentReference}
            onChange={e=>setForm(p=>({...p,signedDocumentReference:e.target.value}))}/></label>
          <p className="sm:col-span-2 break-all text-xs text-muted">
            File: {chosenFile||"Not selected"} · SHA-256: {form.signedDocumentSha256||"Not calculated"}
          </p>
          <button type="submit" disabled={busy||!form.signedDocumentSha256}
            className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-bg disabled:opacity-50">
            Record external CA certificate
          </button>
        </form>
      </Panel>
      <Panel title="Independent UDIN portal observation" kicker="Separate checker · manual ICAI verification only">
        <form onSubmit={check} className="grid gap-3">
          <p className="text-xs text-muted">A second authorized reviewer must inspect the certificate and check its UDIN on the official ICAI portal. Record the result and retain the supporting evidence. VYNDI does not perform that portal check.</p>
          <a className="text-sm font-semibold text-accent" href="https://udin.icai.org/" target="_blank" rel="noopener noreferrer">
            Open official ICAI UDIN portal ↗
          </a>
          <label className={controlLabel}>Previously recorded certificate<select className={inputClass} required value={checker.id}
            onChange={e=>{
              const selected=rows.find(r=>r.certificate_id===e.target.value);
              setChecker(p=>({...p,id:e.target.value,observedMembershipNumber:selected?.ca_membership_number??""}));
            }}>
            <option value="">Select pending certificate</option>
            {rows.filter(r=>r.status==="recorded_unverified").map(r=>
              <option key={r.certificate_id} value={r.certificate_id}>{r.certificate_id} · {r.udin}</option>)}
          </select></label>
          <label className={controlLabel}>Membership number observed on portal<input className={inputClass} required
            value={checker.observedMembershipNumber}
            onChange={e=>setChecker(p=>({...p,observedMembershipNumber:e.target.value}))}/></label>
          <label className={controlLabel}>Observed result<select className={inputClass} value={checker.outcome}
            onChange={e=>setChecker(p=>({...p,outcome:e.target.value as typeof p.outcome}))}>
            <option value="match">Match observed</option>
            <option value="not_found">UDIN not found</option>
            <option value="mismatch">Details mismatch</option>
          </select></label>
          <label className={controlLabel}>Retained portal-check evidence reference<input className={inputClass} required
            value={checker.verificationReference}
            onChange={e=>setChecker(p=>({...p,verificationReference:e.target.value}))}/></label>
          <button type="submit" disabled={busy||!checker.id}
            className="rounded-lg border border-accent px-4 py-2 text-sm font-semibold text-accent disabled:opacity-50">
            Record independent check
          </button>
        </form>
      </Panel>
    </div>
    <Panel title="CA-signed document register" kicker="Administrative evidence, not a software-generated CA opinion">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[900px] text-left text-sm">
          <thead><tr className="border-b border-border text-muted"><th className="p-2">ID / type</th><th className="p-2">Period</th>
            <th className="p-2">Practising CA</th><th className="p-2">UDIN</th><th className="p-2">Status</th><th className="p-2">Retained evidence</th></tr></thead>
          <tbody>{rows.map(r=><tr key={r.certificate_id} className="border-b border-border align-top">
            <td className="p-2">{r.certificate_id}<br/><span className="text-xs text-muted">{r.document_type}</span></td>
            <td className="p-2">{r.period_from} → {r.period_to}</td>
            <td className="p-2">{r.ca_name}<br/><span className="text-xs text-muted">{r.ca_membership_number}</span></td>
            <td className="p-2 font-mono text-xs">{r.udin}</td>
            <td className="p-2">{r.status.replaceAll("_"," ")}<br/><span className="text-xs text-muted">
              {r.checked_by? "Manual checker evidence retained": "Not independently checked"}</span></td>
            <td className="p-2 text-xs">{r.signed_document_reference}<br/>
              <span className="break-all font-mono text-[10px] text-muted">{r.signed_document_sha256}</span></td>
          </tr>)}</tbody>
        </table>
        {!rows.length&&<p className="p-4 text-sm text-muted">No externally signed CA certificates recorded.</p>}
      </div>
    </Panel>
  </main>;
}
