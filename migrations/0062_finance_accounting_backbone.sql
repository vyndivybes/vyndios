-- VYNDI finance/accounting backbone.
-- Management planning remains upstream; these tables provide governed actuals/evidence.

create table if not exists epr_finance_journals (
  id text primary key,
  entry_date date not null,
  source_type text not null,
  source_id text not null,
  description text not null default '',
  status text not null default 'draft' check (status in ('draft','posted','reversed')),
  posted_at timestamptz,
  reversed_entry_id text references epr_finance_journals(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source_type, source_id, status)
);

create table if not exists epr_finance_journal_lines (
  id bigserial primary key,
  journal_id text not null references epr_finance_journals(id) on delete cascade,
  line_no integer not null,
  account_code text not null,
  debit_inr numeric(18,2) not null default 0 check (debit_inr >= 0),
  credit_inr numeric(18,2) not null default 0 check (credit_inr >= 0),
  memo text not null default '',
  created_at timestamptz not null default now(),
  unique (journal_id, line_no),
  check ((debit_inr > 0 and credit_inr = 0) or (credit_inr > 0 and debit_inr = 0))
);

create index if not exists epr_finance_journal_lines_account_idx
  on epr_finance_journal_lines (account_code, journal_id);
create index if not exists epr_finance_journals_source_idx
  on epr_finance_journals (source_type, source_id);
create index if not exists epr_finance_journals_date_idx
  on epr_finance_journals (entry_date, status);

create table if not exists epr_job_cost_snapshots (
  id text primary key,
  job_card_id text not null,
  model text not null,
  planned_quantity numeric(18,4) not null default 0,
  completed_quantity numeric(18,4) not null default 0,
  material_actual_inr numeric(18,2) not null default 0,
  material_standard_inr numeric(18,2) not null default 0,
  material_variance_inr numeric(18,2) not null default 0,
  direct_labour_inr numeric(18,2) not null default 0,
  outsourcing_inr numeric(18,2) not null default 0,
  manufacturing_consumables_inr numeric(18,2) not null default 0,
  manufacturing_depreciation_inr numeric(18,2) not null default 0,
  support_depreciation_inr numeric(18,2) not null default 0,
  overhead_inr numeric(18,2) not null default 0,
  scrap_inr numeric(18,2) not null default 0,
  rework_inr numeric(18,2) not null default 0,
  total_actual_cost_inr numeric(18,2) not null default 0,
  unit_actual_cost_inr numeric(18,2) not null default 0,
  finished_goods_value_inr numeric(18,2) not null default 0,
  wip_value_inr numeric(18,2) not null default 0,
  source_action_id text,
  captured_at timestamptz not null default now(),
  unique (job_card_id, captured_at)
);
create index if not exists epr_job_cost_job_card_idx on epr_job_cost_snapshots (job_card_id, captured_at desc);

create table if not exists epr_finance_gst_ledger (
  id text primary key,
  period text not null,
  direction text not null check (direction in ('input','output')),
  source_type text not null,
  source_id text not null,
  taxable_value_inr numeric(18,2) not null default 0,
  gst_inr numeric(18,2) not null default 0,
  eligible_itc boolean,
  evidence_reference text,
  created_at timestamptz not null default now(),
  unique (source_type, source_id, direction)
);
create index if not exists epr_finance_gst_period_idx on epr_finance_gst_ledger (period, direction);

create table if not exists epr_finance_bank_statement_lines (
  id text primary key,
  bank_account_ref text not null,
  statement_date date not null,
  amount_inr numeric(18,2) not null,
  reference text,
  matched_journal_id text references epr_finance_journals(id),
  matched_at timestamptz,
  imported_at timestamptz not null default now()
);
create index if not exists epr_finance_bank_unmatched_idx
  on epr_finance_bank_statement_lines (bank_account_ref, statement_date)
  where matched_journal_id is null;

create table if not exists epr_finance_fixed_assets (
  asset_id text primary key,
  description text not null,
  capitalization_date date not null,
  acquisition_cost_inr numeric(18,2) not null default 0 check (acquisition_cost_inr >= 0),
  useful_life_months integer not null check (useful_life_months > 0),
  accumulated_depreciation_inr numeric(18,2) not null default 0 check (accumulated_depreciation_inr >= 0),
  location text,
  custodian text,
  source_reference text,
  status text not null default 'active' check (status in ('active','idle','disposed')),
  disposal_date date,
  disposal_reference text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists epr_finance_payroll_controls (
  payroll_id text primary key,
  period text not null,
  gross_pay_inr numeric(18,2) not null default 0,
  deductions_inr numeric(18,2) not null default 0,
  employer_cost_inr numeric(18,2) not null default 0,
  statutory_payable_inr numeric(18,2) not null default 0,
  payment_reference text,
  return_evidence_reference text,
  approved_by text,
  approved_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists epr_finance_payroll_period_idx on epr_finance_payroll_controls (period);

-- Posted accounting records are append/reverse records. Application code must not silently
-- rewrite a posted journal; corrections are represented by a linked reversal journal.
