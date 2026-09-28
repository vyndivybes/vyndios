import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Kpi, Panel } from "@/components/kpi";
import {
  approvePeopleOfficeActualExpenditure,
  createExternalSupportReceipt,
  createPeopleOfficeActualExpenditure,
  listPeopleOfficeActualSpend,
  postFounderReimbursement,
  postPeopleOfficeActualPayment,
  postThirdPartyReimbursement,
  submitPeopleOfficeActualExpenditure,
} from "@/lib/finance/people-office-actual-spend-authority";
import {
  EXTERNAL_SUPPORT_DESTINATIONS,
  MANUAL_EXPENSE_CATEGORIES,
  REPAYMENT_STATUSES,
  THIRD_PARTY_PAYER_TYPES,
} from "@/lib/finance/expense-classification";

type Row = Record<string, unknown>;
const text = (row: Row, ...keys: string[]) => { for (const key of keys) if (row[key] != null) return String(row[key]); return ""; };
const num = (row: Row, ...keys: string[]) => { for (const key of keys) if (row[key] != null) return Number(row[key]) || 0; return 0; };
const inr = (value: number) => `₹${value.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
const lakh = (value: number) => `₹${value.toFixed(2)}L`;
const today = () => new Date().toISOString().slice(0, 10);
const evidenceLines = (value: string) => value.split(";").map((part) => part.trim()).filter(Boolean);

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
    founderReimbursements: Row[];
    thirdPartyReimbursements: Row[];
    externalSupportReceipts: Row[];
    cashAuthority: Row[];
  };

  const [sourceType, setSourceType] = useState<"cost_item" | "asset" | "manual_expense">("cost_item");
  const [sourceId, setSourceId] = useState("");
  const [fundingSource, setFundingSource] = useState<"company_bank" | "founder_personal" | "third_party">("company_bank");
  const [thirdPartyPayerName, setThirdPartyPayerName] = useState("");
  const [thirdPartyPayerType, setThirdPartyPayerType] = useState<(typeof THIRD_PARTY_PAYER_TYPES)[number]>("friend");
  const [thirdPartyRepaymentStatus, setThirdPartyRepaymentStatus] = useState<(typeof REPAYMENT_STATUSES)[number]>("undecided");
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
  const [reimbursementExpenditureId, setReimbursementExpenditureId] = useState("");
  const [reimbursementPlanMonth, setReimbursementPlanMonth] = useState("1");
  const [reimbursedOn, setReimbursedOn] = useState(today());
  const [reimbursementAmount, setReimbursementAmount] = useState("");
  const [reimbursementEvidence, setReimbursementEvidence] = useState("");
  const [thirdPartyReimbursementExpenditureId, setThirdPartyReimbursementExpenditureId] = useState("");
  const [thirdPartyReimbursementPlanMonth, setThirdPartyReimbursementPlanMonth] = useState("1");
  const [thirdPartyReimbursedOn, setThirdPartyReimbursedOn] = useState(today());
  const [thirdPartyReimbursementAmount, setThirdPartyReimbursementAmount] = useState("");
  const [thirdPartyReimbursementEvidence, setThirdPartyReimbursementEvidence] = useState("");

  const [supportReceivedFrom, setSupportReceivedFrom] = useState("");
  const [supportSenderType, setSupportSenderType] = useState<(typeof THIRD_PARTY_PAYER_TYPES)[number]>("friend");
  const [supportReceivedOn, setSupportReceivedOn] = useState(today());
  const [supportAmount, setSupportAmount] = useState("");
  const [supportReceivedInto, setSupportReceivedInto] = useState<(typeof EXTERNAL_SUPPORT_DESTINATIONS)[number]>("founder_personal");
  const [supportPlanMonth, setSupportPlanMonth] = useState("1");
  const [supportRelatedExpenditureId, setSupportRelatedExpenditureId] = useState("");
  const [supportPurpose, setSupportPurpose] = useState("");
  const [supportRepaymentStatus, setSupportRepaymentStatus] = useState<(typeof REPAYMENT_STATUSES)[number]>("undecided");
  const [supportEvidence, setSupportEvidence] = useState("");
  const [supportNotes, setSupportNotes] = useState("");
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const manualExpenseRows: Row[] = MANUAL_EXPENSE_CATEGORIES.map((category) => ({
    id: category.id,
    name: category.label,
    cost_group: `Dr ${category.debitAccountCode}`,
  }));
  const sourceRows = sourceType === "cost_item" ? data.costItems : sourceType === "asset" ? data.assets : manualExpenseRows;
  const openExpenditures = data.expenditures.filter((row) => ["approved", "part_paid"].includes(text(row, "lifecycle_status")));
  const companyOpenExpenditures = openExpenditures.filter((row) => text(row, "funding_source") === "company_bank");
  const founderOpenExpenditures = openExpenditures.filter((row) => text(row, "funding_source") === "founder_personal");
  const thirdPartyRepayableOpenExpenditures = openExpenditures.filter(
    (row) => text(row, "funding_source") === "third_party" && text(row, "third_party_repayment_status") === "required",
  );
  const pending = data.expenditures.filter((row) => text(row, "lifecycle_status") === "pending_approval").length;
  const openAmount = openExpenditures.reduce((sum, row) => sum + num(row, "amount_open_inr"), 0);
  const founderOutstanding = founderOpenExpenditures.reduce((sum, row) => sum + num(row, "amount_open_inr"), 0);
  const thirdPartyOutstanding = thirdPartyRepayableOpenExpenditures.reduce((sum, row) => sum + num(row, "amount_open_inr"), 0);
  const pendingSupport = data.externalSupportReceipts.filter((row) => text(row, "accounting_status") === "pending_classification").length;
  const totalPaid = data.payments.reduce((sum, row) => sum + num(row, "amount_inr"), 0);
  const latestCash = data.cashAuthority[0];

  const selectedPayment = useMemo(
    () => companyOpenExpenditures.find((row) => text(row, "id") === paymentExpenditureId),
    [companyOpenExpenditures, paymentExpenditureId],
  );
  const selectedReimbursement = useMemo(
    () => founderOpenExpenditures.find((row) => text(row, "id") === reimbursementExpenditureId),
    [founderOpenExpenditures, reimbursementExpenditureId],
  );
  const selectedThirdPartyReimbursement = useMemo(
    () => thirdPartyRepayableOpenExpenditures.find((row) => text(row, "id") === thirdPartyReimbursementExpenditureId),
    [thirdPartyRepayableOpenExpenditures, thirdPartyReimbursementExpenditureId],
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
          fundingSource,
          thirdPartyPayerName,
          thirdPartyPayerType,
          thirdPartyRepaymentStatus,
        },
      });
      setMessage(
        `${result.id} created as a draft actual expenditure. ${
          fundingSource === "founder_personal"
            ? "Founder / Director personal funds selected; company cash will remain unchanged on approval."
            : fundingSource === "third_party"
              ? "Third-party funding recorded with payer identity and repayment status; company cash remains unchanged."
              : "No cash moved."
        }`,
      );
      setDescription(""); setAmountInr(""); setSourceReference(""); setNotes("");
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Actual expenditure could not be created.");
    } finally { setBusy(""); }
  }

  async function transition(id: string, action: "submit" | "approve", funding = "company_bank") {
    setBusy(`${action}:${id}`); setMessage(""); setError("");
    try {
      if (action === "submit") {
        await submitPeopleOfficeActualExpenditure({ data: { id } });
        setMessage(`${id} submitted for approval. No cash moved.`);
      } else {
        const soleOperatorSelfApproval = funding === "founder_personal";
        await approvePeopleOfficeActualExpenditure({ data: { id, soleOperatorSelfApproval } });
        setMessage(
          funding === "founder_personal"
            ? `${id} approved with Sole-operator self-approval disclosure. Expense accrued to Founder / Director Current Account 2400; company bank cash unchanged.`
            : funding === "third_party"
              ? `${id} approved as third-party funded. The controlled liability/clearing account is retained; company cash remains unchanged until an authorised reimbursement if required.`
              : `${id} approved and accrued to the General Ledger. Bank cash is unchanged until payment.`,
        );
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

  async function postReimbursement(event: React.FormEvent) {
    event.preventDefault();
    setBusy("reimbursement"); setMessage(""); setError("");
    try {
      const result = await postFounderReimbursement({
        data: {
          expenditureId: reimbursementExpenditureId,
          paymentPlanMonth: Number(reimbursementPlanMonth),
          reimbursedOn,
          amountInr: Number(reimbursementAmount),
          evidenceReference: reimbursementEvidence,
        },
      });
      setMessage(`${result.reimbursementId} posted. Founder / Director Current Account 2400 reduced and company Bank 1000/canonical cash updated through M${result.paymentPlanMonth} R${result.actualRevision}; closing cash is ${lakh(result.newClosingCashLakh)}.`);
      setReimbursementAmount(""); setReimbursementEvidence("");
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Founder reimbursement could not be posted.");
    } finally { setBusy(""); }
  }

  async function postThirdPartyReimbursementEntry(event: React.FormEvent) {
    event.preventDefault();
    setBusy("third-party-reimbursement"); setMessage(""); setError("");
    try {
      const result = await postThirdPartyReimbursement({
        data: {
          expenditureId: thirdPartyReimbursementExpenditureId,
          paymentPlanMonth: Number(thirdPartyReimbursementPlanMonth),
          reimbursedOn: thirdPartyReimbursedOn,
          amountInr: Number(thirdPartyReimbursementAmount),
          evidenceReference: thirdPartyReimbursementEvidence,
        },
      });
      setMessage(`${result.reimbursementId} posted. Third-Party Reimbursements Payable 2450 reduced and company Bank 1000/canonical cash updated through M${result.paymentPlanMonth} R${result.actualRevision}.`);
      setThirdPartyReimbursementAmount(""); setThirdPartyReimbursementEvidence("");
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Third-party reimbursement could not be posted.");
    } finally { setBusy(""); }
  }

  async function recordExternalSupport(event: React.FormEvent) {
    event.preventDefault();
    setBusy("external-support"); setMessage(""); setError("");
    try {
      const result = await createExternalSupportReceipt({
        data: {
          receivedFrom: supportReceivedFrom,
          senderType: supportSenderType,
          receivedOn: supportReceivedOn,
          amountInr: Number(supportAmount),
          receivedInto: supportReceivedInto,
          planMonth: Number(supportPlanMonth),
          relatedExpenditureId: supportRelatedExpenditureId,
          purpose: supportPurpose,
          repaymentStatus: supportRepaymentStatus,
          evidenceReference: supportEvidence,
          notes: supportNotes,
        },
      });
      setMessage(
        `${result.id} recorded. ${
          result.companyCashMoved
            ? "Company bank/canonical cash updated with controlled liability or clearing classification."
            : "No company cash movement was posted; the support remains recorded for classification and traceability."
        }`,
      );
      setSupportReceivedFrom(""); setSupportAmount(""); setSupportPurpose(""); setSupportEvidence(""); setSupportNotes("");
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "External support could not be recorded.");
    } finally { setBusy(""); }
  }

  function selectPayment(row: Row) {
    setPaymentExpenditureId(text(row, "id"));
    setPaymentAmount(String(num(row, "amount_open_inr")));
    setPaymentPlanMonth(String(num(row, "plan_month") || 1));
  }

  function selectReimbursement(row: Row) {
    setReimbursementExpenditureId(text(row, "id"));
    setReimbursementAmount(String(num(row, "amount_open_inr")));
    setReimbursementPlanMonth(String(num(row, "plan_month") || 1));
  }
  function selectThirdPartyReimbursement(row: Row) {
    setThirdPartyReimbursementExpenditureId(text(row, "id"));
    setThirdPartyReimbursementAmount(String(num(row, "amount_open_inr")));
    setThirdPartyReimbursementPlanMonth(String(num(row, "plan_month") || 1));
  }

  return <div className="space-y-6">
    <header className="border-b border-border pb-6">
      <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-green">Finance · transaction-driven expenditure</p>
      <h1 className="mt-1 font-display text-4xl text-accent">Expense & Reimbursement Register</h1>
      <p className="mt-2 max-w-5xl text-sm leading-6 text-muted">Planning approval authorises a budget record; it does not spend cash. This register records company-funded, Founder / Director-paid and third-party-paid expenditure, plus external support received. Company-bank cash moves only on evidenced payment, reimbursement or bank receipt. Uncertain third-party help is held in External Support Clearing 2460 rather than being invented as income. Accrual month and cash month remain controlled separately.</p>
      <div className="mt-3 flex flex-wrap gap-4 text-sm font-semibold"><Link to="/command/people-office" className="text-accent">People & Office plans →</Link><Link to="/command/accounting" className="text-accent">Accounting →</Link><Link to="/command/cash" className="text-accent">Cash authority →</Link></div>
    </header>

    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-7">
      <Kpi label="Pending approval" value={String(pending)} hint="Actual obligations awaiting approval" tone={pending ? "warn" : "ok"}/>
      <Kpi label="Open approved obligations" value={inr(openAmount)} hint="Approved / part-paid" tone={openAmount ? "warn" : "ok"}/>
      <Kpi label="Posted payments" value={inr(totalPaid)} hint={`${data.payments.length} evidenced company-bank transaction${data.payments.length === 1 ? "" : "s"}`} tone="ok"/>
      <Kpi label="Founder payable" value={inr(founderOutstanding)} hint="Founder / Director personal funds awaiting reimbursement" tone={founderOutstanding ? "warn" : "ok"}/>
      <Kpi label="Third-party payable" value={inr(thirdPartyOutstanding)} hint="Repayment-required third-party spend" tone={thirdPartyOutstanding ? "warn" : "ok"}/>
      <Kpi label="Support pending class." value={String(pendingSupport)} hint="No / Undecided external support" tone={pendingSupport ? "warn" : "ok"}/>
      <Kpi label="Latest canonical cash" value={latestCash ? lakh(num(latestCash, "closing_cash_lakh")) : "—"} hint={latestCash ? `Verified M${num(latestCash, "plan_month")}` : "No verified cash baseline"} tone={latestCash && num(latestCash, "closing_cash_lakh") < 0 ? "danger" : "ok"}/>
    </div>

    {message ? <p role="status" className="rounded-xl border border-ok/40 bg-ok/10 px-4 py-3 text-sm text-ok">{message}</p> : null}
    {error ? <p role="alert" className="rounded-xl border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-danger">{error}</p> : null}

    <Panel title="1 · Record actual expenditure" kicker="Draft transaction · no journal and no cash movement">
      <form onSubmit={createActual} className="grid gap-4 lg:grid-cols-12">
        <label className="lg:col-span-2"><span className="text-[10px] font-semibold uppercase tracking-wider text-muted">Source type</span><select value={sourceType} onChange={(event)=>{ const next=event.target.value as "cost_item" | "asset" | "manual_expense"; setSourceType(next); setSourceId(next === "manual_expense" ? "digital_services" : ""); }} className="mt-1 w-full rounded-xl border border-border bg-bg px-3 py-2 text-sm"><option value="cost_item">Approved cost item</option><option value="asset">Approved asset / consumable</option><option value="manual_expense">Manual operating expense</option></select></label>

        <label className="lg:col-span-3"><span className="text-[10px] font-semibold uppercase tracking-wider text-muted">Funding source</span><select value={fundingSource} onChange={(event)=>setFundingSource(event.target.value as "company_bank" | "founder_personal" | "third_party")} className="mt-1 w-full rounded-xl border border-border bg-bg px-3 py-2 text-sm"><option value="company_bank">Company bank</option><option value="founder_personal">Founder / Director personal funds</option><option value="third_party">Third party paid on behalf of company</option></select><span className="mt-1 block text-[10px] text-muted">{fundingSource === "founder_personal" ? "Approval credits 2400 Founder / Director Current Account; company cash stays unchanged." : fundingSource === "third_party" ? "Payer identity and repayment status are mandatory. Repayable amounts use 2450; No/Undecided uses 2460 External Support Clearing." : "Approval creates an obligation; a later evidenced company payment moves Bank 1000."}</span></label>

        <label className="lg:col-span-4"><span className="text-[10px] font-semibold uppercase tracking-wider text-muted">{sourceType === "manual_expense" ? "Expense category" : "Approved source"}</span><select required value={sourceId} onChange={(event)=>setSourceId(event.target.value)} className="mt-1 w-full rounded-xl border border-border bg-bg px-3 py-2 text-sm"><option value="">{sourceType === "manual_expense" ? "Select manual expense category…" : "Select approved source…"}</option>{sourceRows.map((row)=><option key={text(row,"id")} value={text(row,"id")}>{text(row,"name")} · {text(row,"cost_group","asset_class")}</option>)}</select>{sourceType === "manual_expense" ? <span className="mt-1 block text-[10px] text-muted">Use this for genuine operating costs such as office, digital services, travel, professional services, outsourcing, manufacturing overhead, and finance charges. Payroll, inventory, capital assets, GST and AR/AP remain in their governed modules.</span> : null}</label>

        <label className="lg:col-span-2"><span className="text-[10px] font-semibold uppercase tracking-wider text-muted">Accrual plan month</span><input required type="number" min={1} max={36} value={planMonth} onChange={(event)=>setPlanMonth(event.target.value)} className="mt-1 w-full rounded-xl border border-border bg-bg px-3 py-2 text-sm"/></label>

        {fundingSource === "third_party" ? <>
          <label className="lg:col-span-4"><span className="text-[10px] font-semibold uppercase tracking-wider text-muted">Payer name</span><input required value={thirdPartyPayerName} onChange={(event)=>setThirdPartyPayerName(event.target.value)} placeholder="Person / organisation that paid" className="mt-1 w-full rounded-xl border border-border bg-bg px-3 py-2 text-sm"/></label>
          <label className="lg:col-span-3"><span className="text-[10px] font-semibold uppercase tracking-wider text-muted">Payer type</span><select value={thirdPartyPayerType} onChange={(event)=>setThirdPartyPayerType(event.target.value as (typeof THIRD_PARTY_PAYER_TYPES)[number])} className="mt-1 w-full rounded-xl border border-border bg-bg px-3 py-2 text-sm">{THIRD_PARTY_PAYER_TYPES.map((value)=><option key={value} value={value}>{value.replaceAll("_"," ")}</option>)}</select></label>
          <label className="lg:col-span-3"><span className="text-[10px] font-semibold uppercase tracking-wider text-muted">Repayment expected</span><select value={thirdPartyRepaymentStatus} onChange={(event)=>setThirdPartyRepaymentStatus(event.target.value as (typeof REPAYMENT_STATUSES)[number])} className="mt-1 w-full rounded-xl border border-border bg-bg px-3 py-2 text-sm"><option value="required">Yes · reimbursement required</option><option value="not_required">No · not expected</option><option value="undecided">Undecided</option></select></label>
        </> : null}

        <label className="lg:col-span-2"><span className="text-[10px] font-semibold uppercase tracking-wider text-muted">Incurred on</span><input required type="date" value={incurredOn} onChange={(event)=>setIncurredOn(event.target.value)} className="mt-1 w-full rounded-xl border border-border bg-bg px-3 py-2 text-sm"/></label>
        <label className="lg:col-span-2"><span className="text-[10px] font-semibold uppercase tracking-wider text-muted">Amount (INR)</span><input required type="number" min="0.01" step="0.01" value={amountInr} onChange={(event)=>setAmountInr(event.target.value)} placeholder="2500" className="mt-1 w-full rounded-xl border border-border bg-bg px-3 py-2 text-sm"/></label>
        <label className="lg:col-span-5"><span className="text-[10px] font-semibold uppercase tracking-wider text-muted">Description</span><input required value={description} onChange={(event)=>setDescription(event.target.value)} placeholder="Cloudflare domain renewal / business travel / professional fee" className="mt-1 w-full rounded-xl border border-border bg-bg px-3 py-2 text-sm"/></label>
        <label className="lg:col-span-4"><span className="text-[10px] font-semibold uppercase tracking-wider text-muted">Evidence / invoice / transaction reference</span><input required value={sourceReference} onChange={(event)=>setSourceReference(event.target.value)} placeholder="Invoice / UTR / bank reference / transaction ID" className="mt-1 w-full rounded-xl border border-border bg-bg px-3 py-2 text-sm"/></label>
        <label className="lg:col-span-3"><span className="text-[10px] font-semibold uppercase tracking-wider text-muted">Notes</span><input value={notes} onChange={(event)=>setNotes(event.target.value)} placeholder="Optional context" className="mt-1 w-full rounded-xl border border-border bg-bg px-3 py-2 text-sm"/></label>
        <div className="lg:col-span-12 flex justify-end"><button disabled={busy !== ""} className="rounded-full border border-accent bg-accent/10 px-5 py-2 text-xs font-semibold uppercase tracking-[0.12em] text-accent disabled:opacity-50">{busy === "create" ? "Creating…" : "Create actual draft"}</button></div>
      </form>
    </Panel>

    <Panel title="2 · Actual expenditure register" kicker="Draft → pending approval → accrued obligation → part-paid / paid">
      <div className="overflow-x-auto"><table className="w-full min-w-[1200px] text-sm"><thead className="border-b border-border text-[10px] uppercase tracking-wider text-subtle"><tr><th className="px-3 py-3 text-left">Actual</th><th className="px-3 py-3 text-left">Source</th><th className="px-3 py-3 text-left">Accrual</th><th className="px-3 py-3 text-right">Actual</th><th className="px-3 py-3 text-right">Paid</th><th className="px-3 py-3 text-right">Open</th><th className="px-3 py-3 text-left">Accounting</th><th className="px-3 py-3 text-left">Status / action</th></tr></thead><tbody>{data.expenditures.map((row)=>{ const id=text(row,"id"); const status=text(row,"lifecycle_status"); const funding=text(row,"funding_source") || "company_bank"; return <tr key={id} className="border-t border-border/70 align-top"><td className="px-3 py-3"><p className="font-mono text-xs">{id}</p><p className="mt-1 max-w-xs text-xs text-muted">{text(row,"description")}</p></td><td className="px-3 py-3"><p className="font-semibold">{text(row,"source_label")}</p><p className="text-[10px] uppercase text-muted">{text(row,"source_category")}</p><p className="mt-1 text-[10px] font-semibold text-subtle">{funding === "founder_personal" ? "Founder / Director personal funds" : funding === "third_party" ? `Third party · ${text(row,"third_party_payer_name")} · repayment ${text(row,"third_party_repayment_status").replaceAll("_"," ")}` : "Company bank"}</p></td><td className="px-3 py-3">M{num(row,"plan_month")} · {text(row,"incurred_on")}</td><td className="px-3 py-3 text-right font-semibold tabular-nums">{inr(num(row,"amount_inr"))}</td><td className="px-3 py-3 text-right tabular-nums">{inr(num(row,"amount_paid_inr"))}</td><td className="px-3 py-3 text-right tabular-nums">{inr(num(row,"amount_open_inr"))}</td><td className="px-3 py-3"><p className="font-mono text-xs">Dr {text(row,"debit_account_code")} / Cr {text(row,"liability_account_code")}</p><p className="mt-1 text-[10px] text-muted">{funding === "founder_personal" ? "Approval accrual · Cr 2400 · company cash unchanged" : funding === "third_party" ? (text(row,"third_party_repayment_status") === "required" ? "Approval accrual · Cr 2450 · reimburse only through third-party reimbursement" : "Approval accrual · Cr 2460 External Support Clearing · no automatic income classification") : "Approval accrual; Bank 1000 only on payment"}</p>{text(row,"governance_marker") ? <p className="mt-1 text-[10px] font-semibold text-accent">{text(row,"governance_marker")}</p> : null}</td><td className="px-3 py-3"><p className="font-semibold uppercase text-[11px]">{status.replaceAll("_"," ")}</p><div className="mt-2 flex gap-2">{status === "draft" ? <button disabled={busy!==""} onClick={()=>transition(id,"submit")} className="rounded-full border border-border px-3 py-1 text-[10px] font-semibold">Submit</button> : null}{status === "pending_approval" ? <button disabled={busy!==""} onClick={()=>transition(id,"approve",funding)} className="rounded-full border border-accent px-3 py-1 text-[10px] font-semibold text-accent">{funding === "founder_personal" ? "Sole-operator self-approval" : "Approve & accrue"}</button> : null}{["approved","part_paid"].includes(status) && funding === "company_bank" ? <button onClick={()=>selectPayment(row)} className="rounded-full border border-ok/50 px-3 py-1 text-[10px] font-semibold text-ok">Select payment</button> : null}{["approved","part_paid"].includes(status) && funding === "founder_personal" ? <button onClick={()=>selectReimbursement(row)} className="rounded-full border border-accent/60 px-3 py-1 text-[10px] font-semibold text-accent">Select reimbursement</button> : null}{["approved","part_paid"].includes(status) && funding === "third_party" && text(row,"third_party_repayment_status") === "required" ? <button onClick={()=>selectThirdPartyReimbursement(row)} className="rounded-full border border-accent/60 px-3 py-1 text-[10px] font-semibold text-accent">Select third-party reimbursement</button> : null}{["approved","part_paid"].includes(status) && funding === "third_party" && text(row,"third_party_repayment_status") !== "required" ? <span className="text-[10px] font-semibold text-muted">Pending classification · no reimbursement posted</span> : null}</div></td></tr>;})}</tbody></table>{data.expenditures.length===0 ? <p className="py-5 text-sm text-muted">No actual expenditure transactions have been recorded yet.</p> : null}</div>
    </Panel>

    <Panel title="Evidence & traceability register" kicker="Source evidence · reconciliation details · governance · journal lineage">
      <div className="space-y-3">
        {data.expenditures.map((row) => {
          const evidence = evidenceLines(text(row,"notes"));
          const funding = text(row,"funding_source") || "company_bank";
          return <article key={text(row,"id")} className="rounded-2xl border border-border bg-bg-elevated/40 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-mono text-xs text-accent">{text(row,"id")}</p>
                <h3 className="mt-1 font-semibold">{text(row,"description")}</h3>
                <p className="mt-1 text-xs text-muted">{text(row,"source_label")} · {text(row,"incurred_on")} · {inr(num(row,"amount_inr"))}</p>
              </div>
              <div className="text-right">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted">Governance</p>
                <p className="mt-1 text-xs font-semibold text-accent">{text(row,"governance_marker") || "Standard controlled approval"}</p>
                <p className="mt-1 text-[10px] text-muted">{funding === "founder_personal" ? "Founder / Director personal funds" : "Company bank"}</p>
              </div>
            </div>
            <div className="mt-4 grid gap-4 lg:grid-cols-3">
              <div className="rounded-xl border border-border/70 p-3">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted">Evidence source</p>
                <p className="mt-2 break-words font-mono text-xs">{text(row,"source_reference") || "No source evidence reference recorded"}</p>
              </div>
              <div className="rounded-xl border border-border/70 p-3 lg:col-span-2">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted">Reconciliation / evidence details</p>
                {evidence.length ? <ul className="mt-2 space-y-2 text-xs leading-5 text-muted">{evidence.map((item,index)=><li key={`${text(row,"id")}-evidence-${index}`} className="rounded-lg border border-border/50 bg-bg px-3 py-2">{item}</li>)}</ul> : <p className="mt-2 text-xs text-muted">No detailed evidence notes recorded.</p>}
              </div>
            </div>
            <div className="mt-3 grid gap-3 text-xs md:grid-cols-3">
              <p className="rounded-xl border border-border/70 p-3"><span className="block text-[10px] font-semibold uppercase tracking-wider text-muted">Accounting</span><span className="mt-1 block font-mono">Dr {text(row,"debit_account_code")} / Cr {text(row,"liability_account_code")}</span></p>
              <p className="rounded-xl border border-border/70 p-3"><span className="block text-[10px] font-semibold uppercase tracking-wider text-muted">Journal lineage</span><span className="mt-1 block break-words font-mono">{text(row,"obligation_journal_id") || "Not yet posted"}</span></p>
              <p className="rounded-xl border border-border/70 p-3"><span className="block text-[10px] font-semibold uppercase tracking-wider text-muted">Open / paid</span><span className="mt-1 block">{inr(num(row,"amount_open_inr"))} open · {inr(num(row,"amount_paid_inr"))} paid</span></p>
            </div>
          </article>;
        })}
        {data.expenditures.length===0 ? <p className="py-5 text-sm text-muted">No expenditure evidence is available yet.</p> : null}
      </div>
    </Panel>

    <Panel title="3 · Post evidenced payment" kicker="Dr payable · Cr Bank · revise payment-month canonical cash · feed VIBPE">
      <form onSubmit={postPayment} className="grid gap-4 lg:grid-cols-12">
        <label className="lg:col-span-4"><span className="text-[10px] font-semibold uppercase tracking-wider text-muted">Approved open obligation</span><select required value={paymentExpenditureId} onChange={(event)=>{ const id=event.target.value; setPaymentExpenditureId(id); const row=companyOpenExpenditures.find((item)=>text(item,"id")===id); setPaymentAmount(row ? String(num(row,"amount_open_inr")) : ""); setPaymentPlanMonth(row ? String(num(row,"plan_month")) : "1"); }} className="mt-1 w-full rounded-xl border border-border bg-bg px-3 py-2 text-sm"><option value="">Select approved expenditure…</option>{companyOpenExpenditures.map((row)=><option key={text(row,"id")} value={text(row,"id")}>{text(row,"source_label")} · accrual M{num(row,"plan_month")} · open {inr(num(row,"amount_open_inr"))}</option>)}</select></label>
        <label className="lg:col-span-2"><span className="text-[10px] font-semibold uppercase tracking-wider text-muted">Payment cash month</span><input required type="number" min={1} max={36} value={paymentPlanMonth} onChange={(event)=>setPaymentPlanMonth(event.target.value)} className="mt-1 w-full rounded-xl border border-border bg-bg px-3 py-2 text-sm"/></label>
        <label className="lg:col-span-2"><span className="text-[10px] font-semibold uppercase tracking-wider text-muted">Paid on</span><input required type="date" value={paidOn} onChange={(event)=>setPaidOn(event.target.value)} className="mt-1 w-full rounded-xl border border-border bg-bg px-3 py-2 text-sm"/></label>
        <label className="lg:col-span-2"><span className="text-[10px] font-semibold uppercase tracking-wider text-muted">Amount · INR</span><input required type="number" min="0.01" step="0.01" max={selectedPayment ? num(selectedPayment,"amount_open_inr") : undefined} value={paymentAmount} onChange={(event)=>setPaymentAmount(event.target.value)} className="mt-1 w-full rounded-xl border border-border bg-bg px-3 py-2 text-sm"/></label>
        <label className="lg:col-span-2"><span className="text-[10px] font-semibold uppercase tracking-wider text-muted">Bank / UTR evidence</span><input required value={paymentEvidence} onChange={(event)=>setPaymentEvidence(event.target.value)} placeholder="UTR / bank reference" className="mt-1 w-full rounded-xl border border-border bg-bg px-3 py-2 text-sm"/></label>
        <div className="lg:col-span-12 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-bg-elevated/50 p-3"><p className="max-w-4xl text-xs leading-5 text-muted">Accrual month and payment cash month may differ. The selected payment month controls the canonical cash revision. VYNDI does not infer a plan month from the payment date. Posting is blocked if that month has no verified closing-cash baseline.</p><button disabled={busy!=="" || !selectedPayment} className="rounded-full border border-ok/50 bg-ok/10 px-5 py-2 text-xs font-semibold uppercase tracking-[0.12em] text-ok disabled:opacity-50">{busy === "payment" ? "Posting…" : "Post payment"}</button></div>
      </form>
    </Panel>

    <Panel title="4 · Reimburse Founder / Director" kicker="Dr 2400 Founder / Director Current Account · Cr Bank 1000 · revise canonical cash">
      <form onSubmit={postReimbursement} className="grid gap-4 lg:grid-cols-12">
        <label className="lg:col-span-4"><span className="text-[10px] font-semibold uppercase tracking-wider text-muted">Founder-paid open expenditure</span><select required value={reimbursementExpenditureId} onChange={(event)=>{ const id=event.target.value; setReimbursementExpenditureId(id); const row=founderOpenExpenditures.find((item)=>text(item,"id")===id); setReimbursementAmount(row ? String(num(row,"amount_open_inr")) : ""); setReimbursementPlanMonth(row ? String(num(row,"plan_month")) : "1"); }} className="mt-1 w-full rounded-xl border border-border bg-bg px-3 py-2 text-sm"><option value="">Select founder-paid expenditure…</option>{founderOpenExpenditures.map((row)=><option key={text(row,"id")} value={text(row,"id")}>{text(row,"source_label")} · open founder payable {inr(num(row,"amount_open_inr"))}</option>)}</select></label>
        <label className="lg:col-span-2"><span className="text-[10px] font-semibold uppercase tracking-wider text-muted">Cash month</span><input required type="number" min={1} max={36} value={reimbursementPlanMonth} onChange={(event)=>setReimbursementPlanMonth(event.target.value)} className="mt-1 w-full rounded-xl border border-border bg-bg px-3 py-2 text-sm"/></label>
        <label className="lg:col-span-2"><span className="text-[10px] font-semibold uppercase tracking-wider text-muted">Reimbursed on</span><input required type="date" value={reimbursedOn} onChange={(event)=>setReimbursedOn(event.target.value)} className="mt-1 w-full rounded-xl border border-border bg-bg px-3 py-2 text-sm"/></label>
        <label className="lg:col-span-2"><span className="text-[10px] font-semibold uppercase tracking-wider text-muted">Amount · INR</span><input required type="number" min="0.01" step="0.01" max={selectedReimbursement ? num(selectedReimbursement,"amount_open_inr") : undefined} value={reimbursementAmount} onChange={(event)=>setReimbursementAmount(event.target.value)} className="mt-1 w-full rounded-xl border border-border bg-bg px-3 py-2 text-sm"/></label>
        <label className="lg:col-span-2"><span className="text-[10px] font-semibold uppercase tracking-wider text-muted">Bank / UTR evidence</span><input required value={reimbursementEvidence} onChange={(event)=>setReimbursementEvidence(event.target.value)} placeholder="Company reimbursement UTR" className="mt-1 w-full rounded-xl border border-border bg-bg px-3 py-2 text-sm"/></label>
        <div className="lg:col-span-12 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-bg-elevated/50 p-3"><p className="max-w-4xl text-xs leading-5 text-muted">This is the only step that reduces company cash for founder-paid spend. The original expense approval did not touch Bank 1000.</p><button disabled={busy!=="" || !selectedReimbursement} className="rounded-full border border-accent/50 bg-accent/10 px-5 py-2 text-xs font-semibold uppercase tracking-[0.12em] text-accent disabled:opacity-50">{busy === "reimbursement" ? "Posting…" : "Post reimbursement"}</button></div>
      </form>
    </Panel>

    <Panel title="5 · Reimburse third party" kicker="Repayment-required only · Dr 2450 · Cr Bank 1000 · revise canonical cash">
      <form onSubmit={postThirdPartyReimbursementEntry} className="grid gap-4 lg:grid-cols-12">
        <label className="lg:col-span-4"><span className="text-[10px] font-semibold uppercase tracking-wider text-muted">Third-party payable</span><select required value={thirdPartyReimbursementExpenditureId} onChange={(event)=>{ const id=event.target.value; setThirdPartyReimbursementExpenditureId(id); const row=thirdPartyRepayableOpenExpenditures.find((item)=>text(item,"id")===id); setThirdPartyReimbursementAmount(row ? String(num(row,"amount_open_inr")) : ""); setThirdPartyReimbursementPlanMonth(row ? String(num(row,"plan_month")) : "1"); }} className="mt-1 w-full rounded-xl border border-border bg-bg px-3 py-2 text-sm"><option value="">Select repayable third-party expense…</option>{thirdPartyRepayableOpenExpenditures.map((row)=><option key={text(row,"id")} value={text(row,"id")}>{text(row,"third_party_payer_name")} · {text(row,"source_label")} · open {inr(num(row,"amount_open_inr"))}</option>)}</select></label>
        <label className="lg:col-span-2"><span className="text-[10px] font-semibold uppercase tracking-wider text-muted">Cash month</span><input required type="number" min={1} max={36} value={thirdPartyReimbursementPlanMonth} onChange={(event)=>setThirdPartyReimbursementPlanMonth(event.target.value)} className="mt-1 w-full rounded-xl border border-border bg-bg px-3 py-2 text-sm"/></label>
        <label className="lg:col-span-2"><span className="text-[10px] font-semibold uppercase tracking-wider text-muted">Reimbursed on</span><input required type="date" value={thirdPartyReimbursedOn} onChange={(event)=>setThirdPartyReimbursedOn(event.target.value)} className="mt-1 w-full rounded-xl border border-border bg-bg px-3 py-2 text-sm"/></label>
        <label className="lg:col-span-2"><span className="text-[10px] font-semibold uppercase tracking-wider text-muted">Amount · INR</span><input required type="number" min="0.01" step="0.01" max={selectedThirdPartyReimbursement ? num(selectedThirdPartyReimbursement,"amount_open_inr") : undefined} value={thirdPartyReimbursementAmount} onChange={(event)=>setThirdPartyReimbursementAmount(event.target.value)} className="mt-1 w-full rounded-xl border border-border bg-bg px-3 py-2 text-sm"/></label>
        <label className="lg:col-span-2"><span className="text-[10px] font-semibold uppercase tracking-wider text-muted">Bank / UTR evidence</span><input required value={thirdPartyReimbursementEvidence} onChange={(event)=>setThirdPartyReimbursementEvidence(event.target.value)} placeholder="Company reimbursement UTR" className="mt-1 w-full rounded-xl border border-border bg-bg px-3 py-2 text-sm"/></label>
        <div className="lg:col-span-12 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-bg-elevated/50 p-3"><p className="max-w-4xl text-xs leading-5 text-muted">Only expenses explicitly marked <strong>Repayment expected: Yes</strong> can use this path. No/Undecided third-party help remains in External Support Clearing 2460 until separately classified.</p><button disabled={busy!=="" || !selectedThirdPartyReimbursement} className="rounded-full border border-accent/50 bg-accent/10 px-5 py-2 text-xs font-semibold uppercase tracking-[0.12em] text-accent disabled:opacity-50">{busy === "third-party-reimbursement" ? "Posting…" : "Post third-party reimbursement"}</button></div>
      </form>
    </Panel>

    <Panel title="6 · External Support / Expense Assistance Received" kicker="Record help received after or toward expenditure · never auto-classify uncertain support as income">
      <form onSubmit={recordExternalSupport} className="grid gap-4 lg:grid-cols-12">
        <label className="lg:col-span-3"><span className="text-[10px] font-semibold uppercase tracking-wider text-muted">Received from</span><input required value={supportReceivedFrom} onChange={(event)=>setSupportReceivedFrom(event.target.value)} placeholder="Friend / person / organisation" className="mt-1 w-full rounded-xl border border-border bg-bg px-3 py-2 text-sm"/></label>
        <label className="lg:col-span-2"><span className="text-[10px] font-semibold uppercase tracking-wider text-muted">Sender type</span><select value={supportSenderType} onChange={(event)=>setSupportSenderType(event.target.value as (typeof THIRD_PARTY_PAYER_TYPES)[number])} className="mt-1 w-full rounded-xl border border-border bg-bg px-3 py-2 text-sm">{THIRD_PARTY_PAYER_TYPES.map((value)=><option key={value} value={value}>{value.replaceAll("_"," ")}</option>)}</select></label>
        <label className="lg:col-span-2"><span className="text-[10px] font-semibold uppercase tracking-wider text-muted">Received on</span><input required type="date" value={supportReceivedOn} onChange={(event)=>setSupportReceivedOn(event.target.value)} className="mt-1 w-full rounded-xl border border-border bg-bg px-3 py-2 text-sm"/></label>
        <label className="lg:col-span-2"><span className="text-[10px] font-semibold uppercase tracking-wider text-muted">Amount (INR)</span><input required type="number" min="0.01" step="0.01" value={supportAmount} onChange={(event)=>setSupportAmount(event.target.value)} className="mt-1 w-full rounded-xl border border-border bg-bg px-3 py-2 text-sm"/></label>
        <label className="lg:col-span-3"><span className="text-[10px] font-semibold uppercase tracking-wider text-muted">Received into</span><select value={supportReceivedInto} onChange={(event)=>setSupportReceivedInto(event.target.value as (typeof EXTERNAL_SUPPORT_DESTINATIONS)[number])} className="mt-1 w-full rounded-xl border border-border bg-bg px-3 py-2 text-sm"><option value="founder_personal">Founder personal account</option><option value="company_bank">Company bank</option><option value="vendor_direct">Paid vendor directly</option></select></label>

        <label className="lg:col-span-2"><span className="text-[10px] font-semibold uppercase tracking-wider text-muted">Plan month</span><input required type="number" min={1} max={36} value={supportPlanMonth} onChange={(event)=>setSupportPlanMonth(event.target.value)} className="mt-1 w-full rounded-xl border border-border bg-bg px-3 py-2 text-sm"/></label>
        <label className="lg:col-span-4"><span className="text-[10px] font-semibold uppercase tracking-wider text-muted">Related expenditure</span><select value={supportRelatedExpenditureId} onChange={(event)=>setSupportRelatedExpenditureId(event.target.value)} className="mt-1 w-full rounded-xl border border-border bg-bg px-3 py-2 text-sm"><option value="">Not linked / classify later</option>{data.expenditures.map((row)=><option key={text(row,"id")} value={text(row,"id")}>{text(row,"id")} · {text(row,"description")}</option>)}</select></label>
        <label className="lg:col-span-3"><span className="text-[10px] font-semibold uppercase tracking-wider text-muted">Repayment expected</span><select value={supportRepaymentStatus} onChange={(event)=>setSupportRepaymentStatus(event.target.value as (typeof REPAYMENT_STATUSES)[number])} className="mt-1 w-full rounded-xl border border-border bg-bg px-3 py-2 text-sm"><option value="required">Yes · repayment required</option><option value="not_required">No · help / support</option><option value="undecided">Undecided</option></select></label>
        <label className="lg:col-span-3"><span className="text-[10px] font-semibold uppercase tracking-wider text-muted">Evidence / UTR</span><input required value={supportEvidence} onChange={(event)=>setSupportEvidence(event.target.value)} placeholder="UTR / transaction reference" className="mt-1 w-full rounded-xl border border-border bg-bg px-3 py-2 text-sm"/></label>
        <label className="lg:col-span-6"><span className="text-[10px] font-semibold uppercase tracking-wider text-muted">Purpose</span><input required value={supportPurpose} onChange={(event)=>setSupportPurpose(event.target.value)} placeholder="Help toward expenditure already incurred by founder" className="mt-1 w-full rounded-xl border border-border bg-bg px-3 py-2 text-sm"/></label>
        <label className="lg:col-span-6"><span className="text-[10px] font-semibold uppercase tracking-wider text-muted">Notes</span><input value={supportNotes} onChange={(event)=>setSupportNotes(event.target.value)} placeholder="Context / conditions / conversation note" className="mt-1 w-full rounded-xl border border-border bg-bg px-3 py-2 text-sm"/></label>

        <div className="lg:col-span-12 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-bg-elevated/50 p-3"><p className="max-w-4xl text-xs leading-5 text-muted">{supportRepaymentStatus === "required" ? "Repayable support is classified to 2450 Third-Party Reimbursements Payable." : "No / Undecided support is marked Pending classification and held in 2460 External Support Clearing—not sales income."} {supportReceivedInto === "company_bank" ? "Because the money entered the company bank, VYNDI will also revise canonical cash using the selected plan month." : "Because company bank did not receive the money, VYNDI records the support and evidence without manufacturing a company cash movement."}</p><button disabled={busy!==""} className="rounded-full border border-ok/50 bg-ok/10 px-5 py-2 text-xs font-semibold uppercase tracking-[0.12em] text-ok disabled:opacity-50">{busy === "external-support" ? "Recording…" : "Record external support"}</button></div>
      </form>
    </Panel>

    <Panel title="Payment evidence register" kicker="Append-only bank evidence · journal and cash revision lineage">
      <div className="overflow-x-auto"><table className="w-full min-w-[1100px] text-sm"><thead className="border-b border-border text-[10px] uppercase tracking-wider text-subtle"><tr><th className="px-3 py-3 text-left">Payment</th><th className="px-3 py-3 text-left">Actual / source</th><th className="px-3 py-3 text-left">Accrual → cash month</th><th className="px-3 py-3 text-left">Paid</th><th className="px-3 py-3 text-right">Amount</th><th className="px-3 py-3 text-left">Evidence</th><th className="px-3 py-3 text-left">Accounting / cash</th></tr></thead><tbody>{data.payments.map((row)=><tr key={text(row,"id")} className="border-t border-border/70"><td className="px-3 py-3 font-mono text-xs">{text(row,"id")}</td><td className="px-3 py-3"><p className="font-semibold">{text(row,"source_label")}</p><p className="text-[10px] text-muted">{text(row,"expenditure_id")}</p></td><td className="px-3 py-3">M{num(row,"accrual_plan_month")} → M{num(row,"plan_month")}</td><td className="px-3 py-3">{text(row,"paid_on")}</td><td className="px-3 py-3 text-right font-semibold tabular-nums">{inr(num(row,"amount_inr"))}</td><td className="px-3 py-3 max-w-sm break-words text-xs">{text(row,"evidence_reference")}</td><td className="px-3 py-3"><p className="font-mono text-xs">{text(row,"journal_id")}</p><p className="mt-1 text-[10px] text-muted">Cash R{num(row,"actual_revision")} → {lakh(num(row,"new_closing_cash_lakh"))}</p></td></tr>)}</tbody></table>{data.payments.length===0 ? <p className="py-5 text-sm text-muted">No People & Office payments have been posted yet.</p> : null}</div>
    </Panel>

    <Panel title="Founder reimbursement register" kicker="Append-only settlement evidence against Current Account 2400">
      <div className="overflow-x-auto"><table className="w-full min-w-[1100px] text-sm"><thead className="border-b border-border text-[10px] uppercase tracking-wider text-subtle"><tr><th className="px-3 py-3 text-left">Reimbursement</th><th className="px-3 py-3 text-left">Actual / source</th><th className="px-3 py-3 text-left">Accrual → cash month</th><th className="px-3 py-3 text-left">Reimbursed</th><th className="px-3 py-3 text-right">Amount</th><th className="px-3 py-3 text-left">Evidence</th><th className="px-3 py-3 text-left">Accounting / cash</th></tr></thead><tbody>{data.founderReimbursements.map((row)=><tr key={text(row,"id")} className="border-t border-border/70"><td className="px-3 py-3 font-mono text-xs">{text(row,"id")}</td><td className="px-3 py-3"><p className="font-semibold">{text(row,"source_label")}</p><p className="text-[10px] text-muted">{text(row,"expenditure_id")}</p></td><td className="px-3 py-3">M{num(row,"accrual_plan_month")} → M{num(row,"plan_month")}</td><td className="px-3 py-3">{text(row,"reimbursed_on")}</td><td className="px-3 py-3 text-right font-semibold tabular-nums">{inr(num(row,"amount_inr"))}</td><td className="px-3 py-3 max-w-sm break-words text-xs">{text(row,"evidence_reference")}</td><td className="px-3 py-3"><p className="font-mono text-xs">Dr 2400 / Cr 1000 · {text(row,"journal_id")}</p><p className="mt-1 text-[10px] text-muted">Cash R{num(row,"actual_revision")} → {lakh(num(row,"new_closing_cash_lakh"))}</p></td></tr>)}</tbody></table>{data.founderReimbursements.length===0 ? <p className="py-5 text-sm text-muted">No founder reimbursements have been posted yet.</p> : null}</div>
    </Panel>

    <Panel title="Third-party reimbursement register" kicker="Append-only settlement evidence against account 2450">
      <div className="overflow-x-auto"><table className="w-full min-w-[1100px] text-sm"><thead className="border-b border-border text-[10px] uppercase tracking-wider text-subtle"><tr><th className="px-3 py-3 text-left">Reimbursement</th><th className="px-3 py-3 text-left">Payer / expense</th><th className="px-3 py-3 text-left">Accrual → cash month</th><th className="px-3 py-3 text-left">Reimbursed</th><th className="px-3 py-3 text-right">Amount</th><th className="px-3 py-3 text-left">Evidence</th><th className="px-3 py-3 text-left">Accounting / cash</th></tr></thead><tbody>{data.thirdPartyReimbursements.map((row)=><tr key={text(row,"id")} className="border-t border-border/70"><td className="px-3 py-3 font-mono text-xs">{text(row,"id")}</td><td className="px-3 py-3"><p className="font-semibold">{text(row,"third_party_payer_name")}</p><p className="text-[10px] text-muted">{text(row,"source_label")} · {text(row,"expenditure_id")}</p></td><td className="px-3 py-3">M{num(row,"accrual_plan_month")} → M{num(row,"plan_month")}</td><td className="px-3 py-3">{text(row,"reimbursed_on")}</td><td className="px-3 py-3 text-right font-semibold tabular-nums">{inr(num(row,"amount_inr"))}</td><td className="px-3 py-3 max-w-sm break-words text-xs">{text(row,"evidence_reference")}</td><td className="px-3 py-3"><p className="font-mono text-xs">Dr 2450 / Cr 1000 · {text(row,"journal_id")}</p><p className="mt-1 text-[10px] text-muted">Cash R{num(row,"actual_revision")} → {lakh(num(row,"new_closing_cash_lakh"))}</p></td></tr>)}</tbody></table>{data.thirdPartyReimbursements.length===0 ? <p className="py-5 text-sm text-muted">No third-party reimbursements have been posted yet.</p> : null}</div>
    </Panel>

    <Panel title="External support register" kicker="Assistance received · repayment status · related expense · classification and cash lineage">
      <div className="overflow-x-auto"><table className="w-full min-w-[1250px] text-sm"><thead className="border-b border-border text-[10px] uppercase tracking-wider text-subtle"><tr><th className="px-3 py-3 text-left">Support</th><th className="px-3 py-3 text-left">Received from</th><th className="px-3 py-3 text-left">Received / destination</th><th className="px-3 py-3 text-right">Amount</th><th className="px-3 py-3 text-left">Purpose / related expense</th><th className="px-3 py-3 text-left">Repayment / classification</th><th className="px-3 py-3 text-left">Evidence / accounting</th></tr></thead><tbody>{data.externalSupportReceipts.map((row)=><tr key={text(row,"id")} className="border-t border-border/70 align-top"><td className="px-3 py-3 font-mono text-xs">{text(row,"id")}</td><td className="px-3 py-3"><p className="font-semibold">{text(row,"received_from")}</p><p className="text-[10px] uppercase text-muted">{text(row,"sender_type")}</p></td><td className="px-3 py-3">{text(row,"received_on")}<p className="mt-1 text-[10px] text-muted">{text(row,"received_into").replaceAll("_"," ")} · M{num(row,"plan_month")}</p></td><td className="px-3 py-3 text-right font-semibold tabular-nums">{inr(num(row,"amount_inr"))}</td><td className="px-3 py-3"><p>{text(row,"purpose")}</p><p className="mt-1 text-[10px] text-muted">{text(row,"related_expenditure_id") ? `${text(row,"related_expenditure_id")} · ${text(row,"related_expenditure_description")}` : "Not linked to an expenditure"}</p></td><td className="px-3 py-3"><p className="font-semibold">{text(row,"repayment_status").replaceAll("_"," ")}</p><p className="mt-1 text-[10px] font-semibold text-accent">{text(row,"accounting_status") === "pending_classification" ? "Pending classification" : text(row,"accounting_status").replaceAll("_"," ")}</p><p className="mt-1 font-mono text-[10px]">Cr {text(row,"liability_account_code")}</p></td><td className="px-3 py-3"><p className="max-w-xs break-words text-xs">{text(row,"evidence_reference")}</p><p className="mt-1 font-mono text-[10px]">{text(row,"journal_id") || "No company-bank journal"}</p>{text(row,"journal_id") ? <p className="mt-1 text-[10px] text-muted">Cash R{num(row,"actual_revision")} → {lakh(num(row,"new_closing_cash_lakh"))}</p> : <p className="mt-1 text-[10px] text-muted">Company cash unchanged</p>}</td></tr>)}</tbody></table>{data.externalSupportReceipts.length===0 ? <p className="py-5 text-sm text-muted">No external support or expense assistance has been recorded yet.</p> : null}</div>
    </Panel>

    <Panel title="Controlled accounting map" kicker="Existing VYNDI chart of accounts · no parallel ledger">
      <div className="grid gap-3 text-sm md:grid-cols-2 lg:grid-cols-3"><p className="rounded-xl border border-border p-3"><strong>Payroll</strong><br/><span className="text-muted">Dr 6100 People / Payroll · Cr 2200 Payroll / Statutory Payable</span></p><p className="rounded-xl border border-border p-3"><strong>Rent / Office</strong><br/><span className="text-muted">Dr 6200 Office / Facility · Cr 2000 Trade Payables</span></p><p className="rounded-xl border border-border p-3"><strong>Travel / Business Development</strong><br/><span className="text-muted">Dr 6250 Travel / Business Development · Cr controlled liability (2400 when founder-paid)</span></p><p className="rounded-xl border border-border p-3"><strong>Statutory / Professional</strong><br/><span className="text-muted">Dr 6300 Professional / Statutory · Cr 2200 Statutory Payable</span></p><p className="rounded-xl border border-border p-3"><strong>Outsourcing</strong><br/><span className="text-muted">Dr 6400 Outsourcing · Cr 2000 Trade Payables</span></p><p className="rounded-xl border border-border p-3"><strong>Office consumable</strong><br/><span className="text-muted">Dr 6200 Office / Facility · Cr 2000 Trade Payables</span></p><p className="rounded-xl border border-border p-3"><strong>Capital equipment</strong><br/><span className="text-muted">Dr 1500 Fixed Assets · Cr 2000 Trade Payables</span></p><p className="rounded-xl border border-accent/40 p-3"><strong>Founder-paid business expense</strong><br/><span className="text-muted">Dr controlled expense / asset · Cr 2400 Founder / Director Current Account. No company cash until reimbursement.</span></p><p className="rounded-xl border border-accent/40 p-3"><strong>Third-party reimbursement payable</strong><br/><span className="text-muted">Dr controlled expense / asset · Cr 2450 Third-Party Reimbursements Payable when repayment is required.</span></p><p className="rounded-xl border border-accent/40 p-3"><strong>External Support Clearing</strong><br/><span className="text-muted">Cr 2460 for No / Undecided third-party help until classification. It is not auto-posted as sales income.</span></p></div>
    </Panel>
  </div>;
}