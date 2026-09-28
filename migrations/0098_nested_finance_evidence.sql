-- Cloudflare preview gate: transaction-nested finance evidence.
-- Extend append-only finance evidence to external support and nest evidence by transaction.
-- Existing expenditure evidence remains intact.

alter table vyndi_expense_evidence_attachments
  add column if not exists external_support_receipt_id text
    references vyndi_external_support_receipts(id) on delete restrict;

alter table vyndi_expense_evidence_attachments
  alter column expenditure_id drop not null;

alter table vyndi_expense_evidence_attachments
  drop constraint if exists vyndi_expense_evidence_attachments_expenditure_id_sha256_hex_key;

alter table vyndi_expense_evidence_attachments
  drop constraint if exists vyndi_expense_evidence_attachment_expenditure_id_sha256_hex_key;

alter table vyndi_expense_evidence_attachments
  drop constraint if exists vyndi_finance_evidence_exactly_one_target;

alter table vyndi_expense_evidence_attachments
  add constraint vyndi_finance_evidence_exactly_one_target
  check (
    (case when expenditure_id is not null then 1 else 0 end)
    +
    (case when external_support_receipt_id is not null then 1 else 0 end)
    = 1
  );

create unique index if not exists vyndi_expense_evidence_expenditure_sha256_uidx
  on vyndi_expense_evidence_attachments(expenditure_id,sha256_hex)
  where expenditure_id is not null;

create unique index if not exists vyndi_expense_evidence_support_sha256_uidx
  on vyndi_expense_evidence_attachments(external_support_receipt_id,sha256_hex)
  where external_support_receipt_id is not null;

create index if not exists vyndi_expense_evidence_support_idx
  on vyndi_expense_evidence_attachments(external_support_receipt_id,uploaded_at desc,id)
  where external_support_receipt_id is not null;
