import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Kpi, Panel } from "@/components/kpi";
import {
  approvePeopleOfficeActualExpenditure,
  createPeopleOfficeActualExpenditure,
  listPeopleOfficeActualSpend,
  postPeopleOfficeActualPayment,
  submitPeopleOfficeActualExpenditure,
} from "@/lib/finance/people-office-actual-spend-authority";

type Row = Record<string, unknown>;
const text = (row: Row, ...keys: string[]) => { for (const key of keys) if (row[key] != null) return String(row[key]); return ""; };
const num = (row: Row, ...keys: string[]) => { for (const key of keys) if (row[key] != null) return Number(row[key]) || 0; return 0; };
const inr = (value: number) => `₹${value.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
const lakh = (value: number) => `₹${value.toFixed(2)}L`;
const today = () => new Date().toISOString().slice(0, 10);

export const Route = createFileRoute("/command/accounting/people-office-payments")({
  loader: () => listPeopleOfficeActualSpend(),
  component: PeopleOfficeActualSpend,
});

function PeopleOfficeActualSpend() {
  const router = useRouter();
  const data = Route.useLoaderData() as {
    costItems: Row[];
    assets: Row[];
    expenditures: Row[];
    payments: Row[];
    cashAuthority: Row[];
  };

  const [sourceType, setSourceType] = useState<"cost_item" | "asset">("cost_item");
  const [sourceId, setSourceId] = useState("");
  const [planMonth, setPlanMonth] = useState("1");
  const [incurredOn, setIncurredOn] = useState(today());
  const [description, setDescription] = useState("");
  const [amountInr, setAmountInr] = useState("");
  const [sourceReference, setSourceReference] = useState("");
  const [notes, setNotes] = useState("");

  const [paymentExpenditureId, setPaymentExpenditureId] = useState("");
  const [paymentPlanMonth, setPaymentPlanMonth] = useState("1");
  const [paidOn, setPaidOn] = useState(today());
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentEvidence, setPaymentEvidence] = useState("");
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const sourceRows = sourceType === "cost_item" ? data.costItems : data.assets;
  const openExpenditures = data.expenditures.filter((row) => ["approved", "part_paid"].includes(text(row, "lifecycle_status")));
  const pending = data.expenditures.filter((row) => text(row, "lifecycle_status") === "pending_approval").length;
  const openAmount = openExpenditures.reduce((sum, row) => sum + num(row, "amount_open_inr"), 0);
  const totalPaid = data.payments.reduce((sum, row) => sum + num(row, "amount_inr"), 0);
  const latestCash = data.cashAuthority[0];

  const selectedPayment = useMemo(
    () => openExpenditures.find((row) => text(row, "id") === paymentExpenditureId),
    [openExpenditures, paymentExpenditureId],
  );

  async function refresh() {
    await router.invalidate();
  }

  async function createActual(event: React.FormEvent) {
    event.preventDefault();
    setBusy("create"); setMessage(""); setError("");
    try {
      const result = await createPeopleOfficeActualExpenditure({
        data: {
          sourceType,
          sourceId,
          planMonth: Number(planMonth),
          incurredOn,
          description,
          amountInr: Number(amountInr),
          sourceReference,
          notes,
        },
      });
      setMessage(`${result.id} created as a draft actual expenditure. No cash moved.`);
      setDescription(""); setAmountInr(""); setSourceReference(""); setNotes("");
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Actual expenditure could not be created.");
    } finally { setBusy(""); }
  }

  async function transition(id: string, action: "submit" | "approve") {
    setBusy(`${action}:${id}`); setMessage(""); setError("");
    try {
      if (action === "submit") {
        await submitPeopleOfficeActualExpenditure({ data: { id } });
        setMessage(`${id} submitted for approval. No cash moved.`);
      } else {
        await approvePeopleOfficeActualExpenditure({ data: { id } });
        setMessage(`${id} approved and accrued to the General Ledger. Bank cash is unchanged until payment.`);
      }
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : `Actual expenditure could not be ${action}ed.`);
    } finally { setBusy(""); }
  }

  async function postPayment(event: React.FormEvent) {
    event.preventDefault();
    setBusy("payment"); setMessage(""); setError("");
    try {
      const result = await postPeopleOfficeActualPayment({
        data: {
          expenditureId: paymentExpenditureId,
          paymentPlanMonth: Number(paymentPlanMonth),
          paidOn,
          amountInr: Number(paymentAmount),
          evidenceReference: paymentEvidence,
        },
      });
      setMessage(`${result.paymentId} posted. Bank and canonical cash reconcile through M${result.paymentPlanMonth} actual revision R${result.actualRevision}; closing cash is ${lakh(result.newClosingCashLakh)}.`);
      setPaymentAmount(""); setPaymentEvidence("");
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Payment could not be posted.");
    } finally { setBusy(""); }
  }

  function selectPayment(row: Row) {
    setPaymentExpenditureId(text(row, "id"));
    setPaymentAmount(String(num(row, "amount_open_inr")));
    setPaymentPlanMonth(String(num(row, "plan_month") || 1));
  }

  return <div className="space-y-6">
    <header className="border-b border-border pb-6">
      <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-green">Finance · transaction-driven expenditure</p>
      <h1 className="mt-1 font-display text-4xl text-accent">People & Office Actual Spend</h1>
      <p className="mt-2 max-w-5xl text-sm leading-6 text-muted">Planning approval authorises a budget record; it does not spend cash. This console creates the separate actual obligation, posts it to the General Ledger on approval, and moves Bank plus canonical cash only when evidenced payment is posted. Accrual month and payment cash month are controlled separately.</p>
      <div className="mt-3 flex flex-wrap gap-4 text-sm font-semibold"><Link to="/command/people-office" className="text-accent">People & Office plans →</Link><Link to="/command/accounting" className="text-accent">Accounting →</Link><Link to="/command/cash" className="text-accent">Cash authority →</Link></div>
    </header>

    <div className="grid gap-3 sm:grid-cols-4">
      <Kpi label="Pending approval" value={String(pending)} hint="Actual obligations awaiting approval" tone={pending ? "warn" : "ok"}/>
      <Kpi label="Open approved obligations" value={inr(openAmount)} hint="Approved / part-paid" tone={openAmount ? "warn" : "ok"}/>
      <Kpi label="Posted payments" value={inr(totalPaid)} hint={`${data.payments.length} evidenced bank transaction${data.payments.length === 1 ? "" : "s"}`} tone="ok"/>
      <Kpi label="Latest canonical cash" value={latestCash ? lakh(num(latestCash, "closing_cash_lakh")) : "—"} hint={latestCash ? `Verified M${num(latestCash, "plan_month")}` : "No verified cash baseline"} tone={latestCash && num(latestCash, "closing_cash_lakh") < 0 ? "danger" : "ok"}/>
    </div>

    {message ? <p role="status" className="rounded-xl border border-ok/40 bg-ok/10 px-4 py-3 text-sm text-ok">{message}</p> : null}
    {error ? <p role="alert" className="rounded-xl border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-danger">{error}</p> : null}

    <Panel title="1 · Record actual expenditure" kicker="Draft transaction · no journal and no cash movement">
      <form onSubmit={createActual} className="grid gap-4 lg:grid-cols-12">
        <label className="lg:col-span-2"><span className="text-[10px] font-semibold uppercase tracking-wider text-muted">Source type</span><select value={sourceType} onChange={(event)=>{ setSourceType(event.target.value as "cost_item" | "asset"); setSourceId(""); }} className="mt-1 w-full rounded-xl border border-border bg-bg px-3 py-2 text-sm"><option value="cost_item">Cost item</option><option value="asset">Asset / consumable</option></select></label>
        <label className="lg:col-span-4"><span className="text-[10px] font-semibold uppercase tracking-wider text-muted">Approved source</span><select required value={sourceId} onChange={(event)=>setSourceId(event.target.value)} className="mt-1 w-full rounded-xl border border-border bg-bg px-3 py-2 text-sm"><option value="">Select approved source…</option>{sourceRows.map((row)=><option key={text(row,"id")} value={text(row,"id")}>{text(row,"name")} · {text(row,"cost_group","asset_class")}</option>)}</select></label>
        <label className="lg:col-span-2"><span className="text-[10px] font-semibold uppercase tracking-wider text-muted">Accrual plan month</span><input required type="number" min={1} max={36} value={planMonth} onChange={(event)=>setPlanMonth(event.target.value)} className="mt-1 w-full rounded-xl border border-border bg-bg px-3 py-2 text-sm"/></label>
        <label className="lg:col-span-2"><span className="text-[10px] font-semibold uppercase tracking-wider text-muted">Incurred on</span><input required type="date" value={incurredOn} onChange={(event)=>setIncurredOn(event.target.value)} className="mt-1 w-full rounded-xl border border-border bg-bg px-3 py-2 text-sm"/></label>
        <label className="lg:col-span-2"><span className="text-[10px] font-semibold uppercase tracking-wider text-muted">Amount · INR</span><input required type="number" min="0.01" step="0.01" value={amountInr} onChange={(event)=>setAmountInr(event.target.value)} placeholder="40000" className="mt-1 w-full rounded-xl border border-border bg-bg px-3 py-2 text-sm"/></label>
        <label className="lg:col-span-5"><span className="text-[10px] font-semibold uppercase tracking-wider text-muted">Description</span><input required value={description} onChange={(event)=>setDescription(event.target.value)} placeholder="September workshop rent" className="mt-1 w-full rounded-xl border border-border bg-bg px-3 py-2 text-sm"/></label>
        <label className="lg:col-span-4"><span className="text-[10px] font-semibold uppercase tracking-wider text-muted">Source evidence</span><input required value={sourceReference} onChange={(event)=>setSourceReference(event.target.value)} placeholder="Lease invoice / payroll sheet / vendor bill" className="mt-1 w-full rounded-xl border border-border bg-bg px-3 py-2 text-sm"/></label>
        <label className="lg:col-span-3"><span className="text-[10px] font-semibold uppercase tracking-wider text-muted">Notes</span><input value={notes} onChange={(event)=>setNotes(event.target.value)} placeholder="Optional context" className="mt-1 w-full rounded-xl border border-border bg-bg px-3 py-2 text-sm"/></label>
        <div className="lg:col-span-12 flex justify-end"><button disabled={busy !== ""} className="rounded-full border border-accent bg-accent/10 px-5 py-2 text-xs font-semibold uppercase tracking-[0.12em] text-accent disabled:opacity-50">{busy === "create" ? "Creating…" : "Create actual draft"}</button></div>
      </form>
    </Panel>

    <Panel title="2 · Actual expenditure register" kicker="Draft → pending approval → accrued obligation → part-paid / paid">
      <div className="overflow-x-auto"><table className="w-full min-w-[1200px] text-sm"><thead className="border-b border-border text-[10px] uppercase tracking-wider text-subtle"><tr><th className="px-3 py-3 text-left">Actual</th><th className="px-3 py-3 text-left">Source</th><th className="px-3 py-3 text-left">Accrual</th><th className="px-3 py-3 text-right">Actual</th><th className="px-3 py-3 text-right">Paid</th><th className="px-3 py-3 text-right">Open</th><th className="px-3 py-3 text-left">Accounting</th><th className="px-3 py-3 text-left">Status / action</th></tr></thead><tbody>{data.expenditures.map((row)=>{ const id=text(row,"id"); const status=text(row,"lifecycle_status"); return <tr key={id} className="border-t border-border/70 align-top"><td className="px-3 py-3"><p className="font-mono text-xs">{id}</p><p className="mt-1 max-w-xs text-xs text-muted">{text(row,"description")}</p></td><td className="px-3 py-3"><p className="font-semibold">{text(row,"source_label")}</p><p className="text-[10px] uppercase text-muted">{text(row,"source_category")}</p></td><td className="px-3 py-3">M{num(row,"plan_month")} · {text(row,"incurred_on")}</td><td className="px-3 py-3 text-right font-semibold tabular-nums">{inr(num(row,"amount_inr"))}</td><td className="px-3 py-3 text-right tabular-nums">{inr(num(row,"amount_paid_inr"))}</td><td className="px-3 py-3 text-right tabular-nums">{inr(num(row,"amount_open_inr"))}</td><td className="px-3 py-3"><p className="font-mono text-xs">Dr {text(row,"debit_account_code")} / Cr {text(row,"liability_account_code")}</p><p className="mt-1 text-[10px] text-muted">Approval accrual; Bank 1000 only on payment</p></td><td className="px-3 py-3"><p className="font-semibold uppercase text-[11px]">{status.replaceAll("_"," ")}</p><div className="mt-2 flex gap-2">{status === "draft" ? <button disabled={busy!==""} onClick={()=>transition(id,"submit")} className="rounded-full border border-border px-3 py-1 text-[10px] font-semibold">Submit</button> : null}{status === "pending_approval" ? <button disabled={busy!==""} onClick={()=>transition(id,"approve")} className="rounded-full border border-accent px-3 py-1 text-[10px] font-semibold text-accent">Approve & accrue</button> : null}{["approved","part_paid"].includes(status) ? <button onClick={()=>selectPayment(row)} className="rounded-full border border-ok/50 px-3 py-1 text-[10px] font-semibold text-ok">Select payment</button> : null}</div></td></tr>;})}</tbody></table>{data.expenditures.length===0 ? <p className="py-5 text-sm text-muted">No actual expenditure transactions have been recorded yet.</p> : null}</div>
    </Panel>

    <Panel title="3 · Post evidenced payment" kicker="Dr payable · Cr Bank · revise payment-month canonical cash · feed VIBPE">
      <form onSubmit={postPayment} className="grid gap-4 lg:grid-cols-12">
        <label className="lg:col-span-4"><span className="text-[10px] font-semibold uppercase tracking-wider text-muted">Approved open obligation</span><select required value={paymentExpenditureId} onChange={(event)=>{ const id=event.target.value; setPaymentExpenditureId(id); const row=openExpenditures.find((item)=>text(item,"id")===id); setPaymentAmount(row ? String(num(row,"amount_open_inr")) : ""); setPaymentPlanMonth(row ? String(num(row,"plan_month")) : "1"); }} className="mt-1 w-full rounded-xl border border-border bg-bg px-3 py-2 text-sm"><option value="">Select approved expenditure…</option>{openExpenditures.map((row)=><option key={text(row,"id")} value={text(row,"id")}>{text(row,"source_label")} · accrual M{num(row,"plan_month")} · open {inr(num(row,"amount_open_inr"))}</option>)}</select></label>
        <label className="lg:col-span-2"><span className="text-[10px] font-semibold uppercase tracking-wider text-muted">Payment cash month</span><input required type="number" min={1} max={36} value={paymentPlanMonth} onChange={(event)=>setPaymentPlanMonth(event.target.value)} className="mt-1 w-full rounded-xl border border-border bg-bg px-3 py-2 text-sm"/></label>
        <label className="lg:col-span-2"><span className="text-[10px] font-semibold uppercase tracking-wider text-muted">Paid on</span><input required type="date" value={paidOn} onChange={(event)=>setPaidOn(event.target.value)} className="mt-1 w-full rounded-xl border border-border bg-bg px-3 py-2 text-sm"/></label>
        <label className="lg:col-span-2"><span className="text-[10px] font-semibold uppercase tracking-wider text-muted">Amount · INR</span><input required type="number" min="0.01" step="0.01" max={selectedPayment ? num(selectedPayment,"amount_open_inr") : undefined} value={paymentAmount} onChange={(event)=>setPaymentAmount(event.target.value)} className="mt-1 w-full rounded-xl border border-border bg-bg px-3 py-2 text-sm"/></label>
        <label className="lg:col-span-2"><span className="text-[10px] font-semibold uppercase tracking-wider text-muted">Bank / UTR evidence</span><input required value={paymentEvidence} onChange={(event)=>setPaymentEvidence(event.target.value)} placeholder="UTR / bank reference" className="mt-1 w-full rounded-xl border border-border bg-bg px-3 py-2 text-sm"/></label>
        <div className="lg:col-span-12 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-bg-elevated/50 p-3"><p className="max-w-4xl text-xs leading-5 text-muted">Accrual month and payment cash month may differ. The selected payment month controls the canonical cash revision. VYNDI does not infer a plan month from the payment date. Posting is blocked if that month has no verified closing-cash baseline.</p><button disabled={busy!=="" || !selectedPayment} className="rounded-full border border-ok/50 bg-ok/10 px-5 py-2 text-xs font-semibold uppercase tracking-[0.12em] text-ok disabled:opacity-50">{busy === "payment" ? "Posting…" : "Post payment"}</button></div>
      </form>
    </Panel>

    <Panel title="Payment evidence register" kicker="Append-only bank evidence · journal and cash revision lineage">
      <div className="overflow-x-auto"><table className="w-full min-w-[1100px] text-sm"><thead className="border-b border-border text-[10px] uppercase tracking-wider text-subtle"><tr><th className="px-3 py-3 text-left">Payment</th><th className="px-3 py-3 text-left">Actual / source</th><th className="px-3 py-3 text-left">Accrual → cash month</th><th className="px-3 py-3 text-left">Paid</th><th className="px-3 py-3 text-right">Amount</th><th className="px-3 py-3 text-left">Evidence</th><th className="px-3 py-3 text-left">Accounting / cash</th></tr></thead><tbody>{data.payments.map((row)=><tr key={text(row,"id")} className="border-t border-border/70"><td className="px-3 py-3 font-mono text-xs">{text(row,"id")}</td><td className="px-3 py-3"><p className="font-semibold">{text(row,"source_label")}</p><p className="text-[10px] text-muted">{text(row,"expenditure_id")}</p></td><td className="px-3 py-3">M{num(row,"accrual_plan_month")} → M{num(row,"plan_month")}</td><td className="px-3 py-3">{text(row,"paid_on")}</td><td className="px-3 py-3 text-right font-semibold tabular-nums">{inr(num(row,"amount_inr"))}</td><td className="px-3 py-3 max-w-sm break-words text-xs">{text(row,"evidence_reference")}</td><td className="px-3 py-3"><p className="font-mono text-xs">{text(row,"journal_id")}</p><p className="mt-1 text-[10px] text-muted">Cash R{num(row,"actual_revision")} → {lakh(num(row,"new_closing_cash_lakh"))}</p></td></tr>)}</tbody></table>{data.payments.length===0 ? <p className="py-5 text-sm text-muted">No People & Office payments have been posted yet.</p> : null}</div>
    </Panel>

    <Panel title="Controlled accounting map" kicker="Existing VYNDI chart of accounts · no parallel ledger">
      <div className="grid gap-3 text-sm md:grid-cols-2 lg:grid-cols-3"><p className="rounded-xl border border-border p-3"><strong>Payroll</strong><br/><span className="text-muted">Dr 6100 People / Payroll · Cr 2200 Payroll / Statutory Payable</span></p><p className="rounded-xl border border-border p-3"><strong>Rent / Office</strong><br/><span className="text-muted">Dr 6200 Office / Facility · Cr 2000 Trade Payables</span></p><p className="rounded-xl border border-border p-3"><strong>Statutory / Professional</strong><br/><span className="text-muted">Dr 6300 Professional / Statutory · Cr 2200 Statutory Payable</span></p><p className="rounded-xl border border-border p-3"><strong>Outsourcing</strong><br/><span className="text-muted">Dr 6400 Outsourcing · Cr 2000 Trade Payables</span></p><p className="rounded-xl border border-border p-3"><strong>Office consumable</strong><br/><span className="text-muted">Dr 6200 Office / Facility · Cr 2000 Trade Payables</span></p><p className="rounded-xl border border-border p-3"><strong>Capital equipment</strong><br/><span className="text-muted">Dr 1500 Fixed Assets · Cr 2000 Trade Payables</span></p></div>
    </Panel>
  </div>;
}