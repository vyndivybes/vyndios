-- MES-SCAN-01 — universal scanner evidence capture.
-- This is an append-only evidence store. It does not replace or mutate any
-- canonical order, production, inventory, quality, maintenance or finance truth.

create table if not exists vyndi_scan_evidence_attachments (
  id text primary key,
  target_type text not null check (target_type in (
    'sales_order','job_card','traveller','purchase_order','grn',
    'inventory_item','quality_ncr','quality_capa','equipment','maintenance_work_order'
  )),
  target_id text not null,
  document_type text not null check (document_type in (
    'certificate','inspection_report','invoice','receipt','delivery_document','photo','other'
  )),
  source_kind text not null check (source_kind in ('document_scan','camera_capture','file_upload')),
  file_name text not null,
  mime_type text not null check (mime_type in ('application/pdf','image/jpeg','image/png')),
  file_size_bytes integer not null check (file_size_bytes > 0 and file_size_bytes <= 5242880),
  sha256_hex text not null check (sha256_hex ~ '^[0-9a-f]{64}$'),
  content_bytes bytea not null,
  captured_by text not null,
  captured_role text not null,
  captured_at timestamptz not null default now(),
  unique (target_type,target_id,sha256_hex)
);

create index if not exists vyndi_scan_evidence_target_idx
  on vyndi_scan_evidence_attachments(target_type,target_id,captured_at desc,id);

create or replace function vyndi_scan_evidence_append_only()
returns trigger
language plpgsql
as $$
begin
  raise exception 'vyndi_scan_evidence_attachments is append-only';
end;
$$;

drop trigger if exists trg_vyndi_scan_evidence_append_only on vyndi_scan_evidence_attachments;
create trigger trg_vyndi_scan_evidence_append_only
before update or delete on vyndi_scan_evidence_attachments
for each row execute function vyndi_scan_evidence_append_only();

comment on table vyndi_scan_evidence_attachments is
  'Append-only MES-SCAN-01 evidence captured by document scanner, camera or file upload and linked to an existing canonical business record. The attachment is evidence only and never transaction authority.';
