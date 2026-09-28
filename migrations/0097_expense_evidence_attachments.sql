-- Append-only accounting evidence attachments for Expense & Reimbursement Register.
-- Binary evidence is stored in Neon bytea to avoid introducing an unprovisioned external object store.
-- Uploading evidence never edits the expenditure or accounting journal.

create table if not exists vyndi_expense_evidence_attachments (
  id text primary key,
  expenditure_id text not null references vyndi_people_office_actual_expenditures(id) on delete restrict,
  document_type text not null
    check (document_type in ('invoice','receipt','payment_evidence','statement','other')),
  file_name text not null,
  mime_type text not null
    check (mime_type in ('application/pdf','image/jpeg','image/png')),
  file_size_bytes integer not null
    check (file_size_bytes > 0 and file_size_bytes <= 5242880),
  sha256_hex text not null
    check (sha256_hex ~ '^[0-9a-f]{64}$'),
  content_bytes bytea not null,
  uploaded_by text not null,
  uploaded_role text not null,
  uploaded_at timestamptz not null default now(),
  unique (expenditure_id,sha256_hex)
);

create index if not exists vyndi_expense_evidence_expenditure_idx
  on vyndi_expense_evidence_attachments(expenditure_id,uploaded_at desc,id);

create or replace rule vyndi_expense_evidence_no_update as
on update to vyndi_expense_evidence_attachments
do instead nothing;

create or replace rule vyndi_expense_evidence_no_delete as
on delete to vyndi_expense_evidence_attachments
do instead nothing;
