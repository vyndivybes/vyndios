/**
 * Read-only pre-use bookkeeping controls. This is not a CA audit opinion.
 * First-use checks deliberately do NOT require a bank reconciliation,
 * posted monthly stocktake, hard-close, or previously generated CA pack.
 */
export const DAY1_TECHNICAL_QUERY = `
with required_audit_tables(table_name) as (
  values
  ('epr_finance_journals'),('epr_finance_journal_lines'),
  ('epr_finance_bank_statement_lines'),('epr_finance_gst_ledger'),
  ('epr_finance_fixed_assets'),('epr_finance_payroll_controls'),
  ('epr_finance_period_closures'),('epr_finance_ca_evidence_packs'),
  ('epr_finance_bank_reconciliation_sessions'),('epr_inventory_stocktakes'),
  ('vyndi_supplier_invoices'),('vyndi_invoices')
), required_journal_guards(table_name,trigger_name) as (
  values
  ('epr_finance_journals','trg_vyndi_protect_posted_journal'),
  ('epr_finance_journal_lines','trg_vyndi_protect_posted_journal_line'),
  ('epr_finance_journals','trg_vyndi_finance_period_lock')
)
select
 (select count(*)::int from epr_finance_journals j where j.status='posted'
    and (trim(coalesce(j.source_type,''))='' or trim(coalesce(j.source_id,''))='')) as posted_missing_source,
 (select count(*)::int from epr_finance_journals j where j.status='posted'
    and not exists (select 1 from epr_finance_journal_lines l where l.journal_id=j.id)) as posted_missing_lines,
 (select count(*)::int from (
    select j.id from epr_finance_journals j
    join epr_finance_journal_lines l on l.journal_id=j.id
    where j.status='posted'
    group by j.id having abs(sum(l.debit_inr-l.credit_inr))>0.01
  ) unbalanced) as posted_unbalanced,
 (select count(*)::int from epr_finance_posting_exceptions where resolved=false) as posting_exceptions,
 (select count(*)::int from required_audit_tables) as required_audit_tables,
 (select count(*)::int from required_audit_tables r where exists(
     select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
     join pg_trigger t on t.tgrelid=c.oid
     where n.nspname='public' and c.relname=r.table_name
       and t.tgname='trg_vyndi_books_row_audit' and t.tgenabled in ('O','A')
   )) as active_audit_tables,
 (select count(*)::int from required_journal_guards) as required_journal_guards,
 (select count(*)::int from required_journal_guards r where exists(
     select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
     join pg_trigger t on t.tgrelid=c.oid
     where n.nspname='public' and c.relname=r.table_name
       and t.tgname=r.trigger_name and t.tgenabled in ('O','A')
   )) as active_journal_guards
`;

const keys = [
  "posted_missing_source", "posted_missing_lines", "posted_unbalanced",
  "posting_exceptions", "required_audit_tables", "active_audit_tables",
  "required_journal_guards", "active_journal_guards",
] as const;
type Key = typeof keys[number];
type CounterRow = Record<Key, number>;
export type Day1TechnicalHealth = {
  state: "TECHNICAL_CONTROLS_PASS" | "TECHNICAL_CONTROLS_FAIL";
  passed: string[];
  failed: string[];
  observed: Partial<CounterRow> | null;
  scope: "read_only_integrity_not_statutory_acceptance";
};

export function assessDay1TechnicalHealth(row: unknown): Day1TechnicalHealth {
  const result: Day1TechnicalHealth = {
    state:"TECHNICAL_CONTROLS_FAIL", passed:[], failed:[], observed:null,
    scope:"read_only_integrity_not_statutory_acceptance",
  };
  if (!row || typeof row !== "object") {
    result.failed.push("Database control evidence unavailable");
    return result;
  }
  const source = row as Record<string, unknown>;
  const parsed: Partial<CounterRow> = {};
  for (const key of keys) {
    const raw = source[key];
    const value = Number(raw);
    if (raw === null || raw === undefined || raw === "" ||
        !Number.isSafeInteger(value) || value < 0) {
      result.failed.push(`Missing or invalid control metric: ${key}`);
      return result;
    }
    parsed[key] = value;
  }
  result.observed = parsed;
  const checks = [
    ["Posted source traceability", parsed.posted_missing_source === 0],
    ["Balanced and complete journals", parsed.posted_unbalanced === 0 && parsed.posted_missing_lines === 0],
    ["No unresolved posting exceptions", parsed.posting_exceptions === 0],
    ["Non-disabled critical finance edit audit triggers",
      parsed.required_audit_tables === 12 && parsed.active_audit_tables === parsed.required_audit_tables],
    ["Posted journal immutability and period-lock triggers",
      parsed.required_journal_guards === 3 && parsed.active_journal_guards === parsed.required_journal_guards],
  ] as const;
  for (const [name, ok] of checks) (ok ? result.passed : result.failed).push(name);
  result.state = result.failed.length ? "TECHNICAL_CONTROLS_FAIL" : "TECHNICAL_CONTROLS_PASS";
  return result;
}
