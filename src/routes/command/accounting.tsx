import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { BookOpenCheck, Boxes, Landmark, ReceiptText, Scale, WalletCards } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Kpi, Panel } from "@/components/kpi";
import {
  getAccountingWorkbench,
  importBankStatementLine,
  matchBankStatementLine,
  savePayrollControl,
} from "@/lib/finance/accounting-authority";
import { CORE_CHART_OF_ACCOUNTS } from "@/lib/finance/general-ledger";

export const Route = createFileRoute("/command/accounting")({
  loader: () => getAccountingWorkbench(),
  component: AccountingWorkbench,
});

const accountNames = new Map(CORE_CHART_OF_ACCOUNTS.map((account) => [account.code, account.name]));
const text = (row: Record<string, unknown>, key: string) => String(row[key] ?? "");
const num = (row: Record<string, unknown>, key: string) => Number(row[key] ?? 0);
const money = (value: unknown) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(Number(value ?? 0));
const today = () => new Date().toISOString().slice(0, 10);
const month = () => new Date().toISOString().slice(0, 7);

function AccountingWorkbench() {
  const data = Route.useLoaderData();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [bankDraft, setBankDraft] = useState({ id: "", bankAccountRef: "BANK-01", statementDate: today(), amountInr: 0, reference: "" });
  const [payrollDraft, setPayrollDraft] = useState({ payrollId: "", sourceExpenditureId: "", period: month(), grossPayInr: 0, deductionsInr: 0, employerCostInr: 0, statutoryPayableInr: 0, paymentReference: "", returnEvidenceReference: "" });

  const summary = data.summary as Record<string, unknown>;
  const openExceptions = data.exceptions.filter((row) => !row.resolved);
  const tbDebit = data.trialBalance.reduce((sum, row) => sum + num(row, "debit_inr"), 0);
  const tbCredit = data.trialBalance.reduce((sum, row) => sum + num(row, "credit_inr"), 0);
  const tbDifference = Math.round((tbDebit - tbCredit) * 100) / 100;

  async function run(task: () => Promise<unknown>, success: string) {
    setBusy(true);
    setMessage("");
    try {
      await task();
      setMessage(success);
      await router.invalidate();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Accounting action could not be completed.");
    } finally {
      setBusy(false);
    }
  }

  async function reconcileBank(row: Record<string, unknown>) {
    const journalId = window.prompt("Posted journal ID to reconcile", "")?.trim();
    if (!journalId) return;
    await run(
      () => matchBankStatementLine({ data: { statementLineId: text(row, "id"), journalId } }),
      `${text(row, "id")} reconciled to ${journalId}.`,
    );
  }

  return (
    <main className="mx-auto max-w-7xl space-y-6">
      <header className="flex flex-col gap-4 border-b border-border pb-6 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-green">Finance · transaction-derived accounting</p>
          <h1 className="mt-2 font-display text-4xl text-accent">Accounting Workbench</h1>
          <p className="mt-2 max-w-4xl text-sm leading-6 text-muted">
            Operational transactions post into governed double-entry journals. This surface exposes the resulting General Ledger,
            Trial Balance, job cost/WIP/FG valuation and statutory-evidence controls without creating a second finance truth.
          </p>
        </div>
        <p className="max-w-sm text-xs leading-5 text-muted">Use Finance → Accounting & Statements for formal statements; this workbench remains the journal, reconciliation and accounting-control surface.</p>
      </header>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <Kpi label="Posted journals" value={String(summary.posted_journals ?? 0)} hint="Source-linked double entry" />
        <Kpi label="Trial balance" value={tbDifference === 0 ? "Balanced" : money(Math.abs(tbDifference))} hint="Debit minus credit" tone={tbDifference === 0 ? "ok" : "danger"} />
        <Kpi label="Posting exceptions" value={String(summary.open_posting_exceptions ?? 0)} hint="Require reconciliation" tone={Number(summary.open_posting_exceptions ?? 0) ? "danger" : "ok"} />
        <Kpi label="Bank unmatched" value={String(summary.unmatched_bank_lines ?? 0)} hint="Statement lines" tone={Number(summary.unmatched_bank_lines ?? 0) ? "warn" : "ok"} />
        <Kpi label="GST evidence" value={String(summary.gst_evidence_exceptions ?? 0)} hint="Missing source evidence" tone={Number(summary.gst_evidence_exceptions ?? 0) ? "warn" : "ok"} />
        <Kpi label="Payroll evidence" value={String(summary.payroll_evidence_exceptions ?? 0)} hint="Payment / return gaps" tone={Number(summary.payroll_evidence_exceptions ?? 0) ? "warn" : "ok"} />
      </div>

      {message ? <div role="status" className="rounded-lg border border-border bg-surface px-4 py-3 text-sm text-muted">{message}</div> : null}

      <Panel title="Trial Balance" kicker="Posted journals only">
        <div className="grid gap-2">
          <div className="grid grid-cols-[88px_minmax(0,1fr)_140px_140px_140px] gap-2 border-b border-border pb-2 text-[10px] font-semibold uppercase tracking-wider text-subtle">
            <span>Account</span><span>Name</span><span className="text-right">Debit</span><span className="text-right">Credit</span><span className="text-right">Balance</span>
          </div>
          {data.trialBalance.length ? data.trialBalance.map((row) => (
            <div key={text(row, "account_code")} className="grid grid-cols-[88px_minmax(0,1fr)_140px_140px_140px] gap-2 border-b border-border/60 py-2 text-sm">
              <span className="font-mono text-xs">{text(row, "account_code")}</span>
              <span className="min-w-0 break-words text-muted">{accountNames.get(text(row, "account_code")) ?? "Unmapped account"}</span>
              <span className="text-right tabular-nums">{money(row.debit_inr)}</span>
              <span className="text-right tabular-nums">{money(row.credit_inr)}</span>
              <span className="text-right font-semibold tabular-nums">{money(row.balance_inr)}</span>
            </div>
          )) : <Empty>No posted journal balance exists yet.</Empty>}
        </div>
      </Panel>

      <Panel title="General Ledger" kicker="Source → journal → account">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {data.journals.slice(0, 24).map((row) => (
            <article key={text(row, "id")} className="rounded-xl border border-border bg-bg/40 p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0"><p className="font-mono text-xs text-accent break-all">{text(row, "id")}</p><p className="mt-1 text-sm font-semibold break-words">{text(row, "description")}</p></div>
                <BookOpenCheck className="size-4 shrink-0 text-green" />
              </div>
              <dl className="mt-3 grid grid-cols-2 gap-2 text-xs text-muted">
                <Stat label="Date" value={text(row, "entry_date")} />
                <Stat label="Source" value={`${text(row, "source_type")} · ${text(row, "source_id")}`} />
                <Stat label="Debit" value={money(row.debit_inr)} />
                <Stat label="Credit" value={money(row.credit_inr)} />
              </dl>
            </article>
          ))}
          {!data.journals.length ? <Empty>No accounting journals posted yet.</Empty> : null}
        </div>
      </Panel>

      <Panel title="Job Cost · WIP · Finished Goods" kicker="FIFO actual material → controlled completion">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {data.jobCosts.map((row) => (
            <article key={text(row, "id")} className="rounded-xl border border-border p-4">
              <div className="flex items-start justify-between gap-3"><div><p className="font-mono text-xs text-accent">{text(row, "job_card_id")}</p><p className="mt-1 text-sm font-semibold">{text(row, "model")}</p></div><Boxes className="size-4 text-green" /></div>
              <dl className="mt-3 grid grid-cols-2 gap-2 text-xs text-muted">
                <Stat label="Material actual" value={money(row.material_actual_inr)} />
                <Stat label="Variance" value={money(row.material_variance_inr)} />
                <Stat label="Unit actual" value={money(row.unit_actual_cost_inr)} />
                <Stat label="FG value" value={money(row.finished_goods_value_inr)} />
                <Stat label="WIP" value={money(row.wip_value_inr)} />
                <Stat label="Completed" value={String(row.completed_quantity ?? 0)} />
              </dl>
            </article>
          ))}
          {!data.jobCosts.length ? <Empty>Job cost snapshots will appear when controlled Production completes.</Empty> : null}
        </div>
      </Panel>

      <Panel title="GST / ITC Ledger" kicker="Invoice-level tax evidence">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {data.gst.map((row) => (
            <article key={text(row, "id")} className="rounded-xl border border-border p-4 text-sm">
              <div className="flex items-center justify-between gap-2"><span className="font-mono text-xs text-accent">{text(row, "id")}</span><ReceiptText className="size-4 text-green" /></div>
              <p className="mt-2 font-semibold uppercase text-xs">{text(row, "direction")} · {text(row, "period")}</p>
              <p className="mt-2 text-muted">Taxable {money(row.taxable_value_inr)} · GST {money(row.gst_inr)}</p>
              <p className="mt-1 text-xs text-muted break-words">Evidence: {text(row, "evidence_reference") || "Missing"}</p>
            </article>
          ))}
          {!data.gst.length ? <Empty>No GST ledger entries yet.</Empty> : null}
        </div>
      </Panel>

      <Panel title="Bank Reconciliation" kicker="Bank statement ↔ posted bank journal">
        <div className="grid gap-4 xl:grid-cols-[1fr_1.6fr]">
          <form onSubmit={(event) => { event.preventDefault(); void run(() => importBankStatementLine({ data: bankDraft }), `${bankDraft.id} imported.`); }} className="rounded-xl border border-border p-4">
            <h3 className="text-sm font-semibold">Import statement line</h3>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <Field label="Statement ID"><input className="control mt-1.5" value={bankDraft.id} onChange={(e) => setBankDraft({ ...bankDraft, id: e.target.value })} placeholder="BANK-2026-001" /></Field>
              <Field label="Bank account"><input className="control mt-1.5" value={bankDraft.bankAccountRef} onChange={(e) => setBankDraft({ ...bankDraft, bankAccountRef: e.target.value })} /></Field>
              <Field label="Date"><input className="control mt-1.5" type="date" value={bankDraft.statementDate} onChange={(e) => setBankDraft({ ...bankDraft, statementDate: e.target.value })} /></Field>
              <Field label="Amount · +receipt / −payment"><input className="control mt-1.5" type="number" step="0.01" value={bankDraft.amountInr} onChange={(e) => setBankDraft({ ...bankDraft, amountInr: Number(e.target.value) })} /></Field>
              <Field label="Bank reference"><input className="control mt-1.5" value={bankDraft.reference} onChange={(e) => setBankDraft({ ...bankDraft, reference: e.target.value })} /></Field>
            </div>
            <button disabled={busy || !bankDraft.id || !bankDraft.reference || bankDraft.amountInr === 0} className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-bg disabled:opacity-40"><Landmark className="size-4" />Import line</button>
          </form>
          <div className="grid gap-2">
            {data.bank.slice(0, 30).map((row) => (
              <div key={text(row, "id")} className="grid grid-cols-[minmax(0,1fr)_120px_140px] gap-3 rounded-lg border border-border px-3 py-3 text-sm">
                <div className="min-w-0"><p className="font-mono text-xs break-all">{text(row, "id")}</p><p className="mt-1 text-xs text-muted break-words">{text(row, "statement_date")} · {text(row, "reference")}</p></div>
                <span className="text-right tabular-nums">{money(row.amount_inr)}</span>
                {row.matched_journal_id ? <span className="break-all text-right text-xs text-green">{text(row, "matched_journal_id")}</span> : <button disabled={busy} type="button" onClick={() => void reconcileBank(row)} className="text-right text-xs font-semibold text-accent">Match journal</button>}
              </div>
            ))}
            {!data.bank.length ? <Empty>No bank statement lines imported.</Empty> : null}
          </div>
        </div>
      </Panel>

      <Panel title="Fixed Asset Register" kicker="Derived from governed capital expenditure">
        <div className="rounded-xl border border-border bg-surface/60 p-4 text-sm leading-6 text-muted">
          New fixed assets are created only when an approved People &amp; Office actual expenditure capitalizes to account 1500.
          This register is read-only for financial source truth; it no longer permits a second manual asset-creation path.
          <div className="mt-3"><Link to="/command/accounting/people-office-payments" className="font-semibold text-accent">Open People &amp; Office Actual Spend →</Link></div>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">{data.assets.map((row) => <article key={text(row, "asset_id")} className="rounded-xl border border-border p-4 text-sm"><p className="font-mono text-xs text-accent">{text(row, "asset_id")}</p><p className="mt-1 font-semibold">{text(row, "description")}</p><p className="mt-2 text-muted">Cost {money(row.acquisition_cost_inr)} · Acc. dep. {money(row.accumulated_depreciation_inr)}</p><p className="mt-2 text-xs text-muted break-words">Authority: {text(row, "source_expenditure_id") || "Legacy pre-consolidation record"} · Evidence: {text(row, "source_reference") || "Missing"}</p></article>)}</div>
      </Panel>

      <Panel title="Payroll / Statutory Control" kicker="Linked compliance evidence · no parallel cash truth">
        <div className="mb-4 rounded-xl border border-border bg-surface/60 p-4 text-sm leading-6 text-muted">
          Each new payroll control must link to an approved People &amp; Office payroll expenditure. Employer cost must equal the governed obligation, and any payment evidence must match an actual governed bank/UTR payment. The control records statutory evidence only; it does not post cash.
        </div>
        <form onSubmit={(event) => { event.preventDefault(); void run(() => savePayrollControl({ data: payrollDraft }), `${payrollDraft.payrollId} linked payroll control saved.`); }} className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <Field label="Payroll ID"><input className="control mt-1.5" value={payrollDraft.payrollId} onChange={(e) => setPayrollDraft({ ...payrollDraft, payrollId: e.target.value })} /></Field>
          <Field label="Governed payroll expenditure ID"><input className="control mt-1.5" value={payrollDraft.sourceExpenditureId} onChange={(e) => setPayrollDraft({ ...payrollDraft, sourceExpenditureId: e.target.value })} placeholder="People & Office actual expenditure ID" /></Field>
          <Field label="Period"><input className="control mt-1.5" type="month" value={payrollDraft.period} onChange={(e) => setPayrollDraft({ ...payrollDraft, period: e.target.value })} /></Field>
          <Field label="Gross pay"><input className="control mt-1.5" type="number" min="0" step="0.01" value={payrollDraft.grossPayInr} onChange={(e) => setPayrollDraft({ ...payrollDraft, grossPayInr: Number(e.target.value) })} /></Field>
          <Field label="Deductions"><input className="control mt-1.5" type="number" min="0" step="0.01" value={payrollDraft.deductionsInr} onChange={(e) => setPayrollDraft({ ...payrollDraft, deductionsInr: Number(e.target.value) })} /></Field>
          <Field label="Employer cost · must equal governed obligation"><input className="control mt-1.5" type="number" min="0" step="0.01" value={payrollDraft.employerCostInr} onChange={(e) => setPayrollDraft({ ...payrollDraft, employerCostInr: Number(e.target.value) })} /></Field>
          <Field label="Statutory/TDS payable"><input className="control mt-1.5" type="number" min="0" step="0.01" value={payrollDraft.statutoryPayableInr} onChange={(e) => setPayrollDraft({ ...payrollDraft, statutoryPayableInr: Number(e.target.value) })} /></Field>
          <Field label="Governed payment evidence · if paid"><input className="control mt-1.5" value={payrollDraft.paymentReference} onChange={(e) => setPayrollDraft({ ...payrollDraft, paymentReference: e.target.value })} placeholder="Must match People & Office bank / UTR evidence" /></Field>
          <Field label="Return evidence"><input className="control mt-1.5" value={payrollDraft.returnEvidenceReference} onChange={(e) => setPayrollDraft({ ...payrollDraft, returnEvidenceReference: e.target.value })} /></Field>
          <div className="flex items-end"><button disabled={busy || !payrollDraft.payrollId || !payrollDraft.sourceExpenditureId} className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-bg disabled:opacity-40"><WalletCards className="size-4" />Save linked control</button></div>
        </form>
        <div className="mt-3"><Link to="/command/accounting/people-office-payments" className="text-xs font-semibold text-accent">Open governed payroll expenditure/payment source →</Link></div>
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">{data.payroll.map((row) => <article key={text(row, "payroll_id")} className="rounded-xl border border-border p-4 text-sm"><p className="font-mono text-xs text-accent">{text(row, "payroll_id")} · {text(row, "period")}</p><p className="mt-2 text-muted">Gross {money(row.gross_pay_inr)} · employer cost {money(row.employer_cost_inr)} · statutory {money(row.statutory_payable_inr)}</p><p className="mt-1 text-xs text-muted break-words">Authority: {text(row, "source_expenditure_id") || "Legacy pre-consolidation record"}</p><p className="mt-1 text-xs text-muted break-words">Payment: {text(row, "payment_reference") || "Missing"} · Return: {text(row, "return_evidence_reference") || "Missing"}</p></article>)}</div>
      </Panel>

      <Panel title="Posting Exceptions" kicker="No silent accounting gaps">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {openExceptions.map((row) => <article key={text(row, "id")} className="rounded-xl border border-danger/40 p-4"><div className="flex items-center justify-between gap-2"><span className="text-xs font-semibold uppercase text-danger">{text(row, "severity")}</span><Scale className="size-4 text-danger" /></div><p className="mt-2 text-sm font-semibold break-words">{text(row, "message")}</p><p className="mt-2 font-mono text-xs text-muted break-all">{text(row, "source_type")} · {text(row, "source_id")}</p></article>)}
          {!openExceptions.length ? <Empty>No unresolved finance-posting exceptions.</Empty> : null}
        </div>
      </Panel>

      <div className="rounded-xl border border-border bg-surface p-4 text-xs leading-5 text-muted">
        <span className="font-semibold text-fg">Reliance boundary:</span> these records provide governed management-accounting and reconciliation evidence. GST/TDS filing, statutory books and external certification remain subject to the appointed CA and applicable law.
      </div>
    </main>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="text-xs font-medium text-muted">{label}{children}</label>;
}
function Stat({ label, value }: { label: string; value: string }) {
  return <div className="min-w-0"><dt className="text-[10px] uppercase tracking-wider text-subtle">{label}</dt><dd className="mt-0.5 break-words text-fg">{value}</dd></div>;
}
function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-xl border border-dashed border-border p-5 text-sm text-muted">{children}</div>;
}
