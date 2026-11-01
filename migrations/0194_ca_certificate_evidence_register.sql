-- External Chartered Accountant certificate evidence, not system-generated certification.
-- Existing posted books and approvals remain the sole accounting source of truth.
create table if not exists epr_finance_ca_signed_certificates (
  certificate_id text primary key check(length(trim(certificate_id))>=3),
  document_type text not null check(document_type in ('financial_statements','tax_audit','gst_audit','other_certificate')),
  period_from date not null,
  period_to date not null,
  signed_on date not null,
  ca_name text not null check(length(trim(ca_name))>=3),
  ca_membership_number text not null check(ca_membership_number ~ '^[0-9]{6}$'),
  udin text not null unique check(udin ~ '^[0-9]{8}[A-Z0-9]{10}$'),
  signed_document_sha256 text not null check(signed_document_sha256 ~ '^[0-9a-f]{64}$'),
  signed_document_reference text not null check(length(trim(signed_document_reference))>=5),
  status text not null default 'recorded_unverified'
    check(status in ('recorded_unverified','portal_check_recorded','disputed')),
  recorded_by text not null,
  recorded_at timestamptz not null default now(),
  checked_by text,
  checked_at timestamptz,
  observed_membership_number text,
  checker_recorded_outcome text check(checker_recorded_outcome in ('match','not_found','mismatch')),
  portal_check_evidence_reference text,
  constraint ca_certificate_date_order check (period_from<=period_to and signed_on>=period_to),
  constraint ca_certificate_member_consistent check(substr(udin,3,6)=ca_membership_number),
  constraint ca_certificate_independent_checker check(checked_by is null or checked_by<>recorded_by),
  constraint ca_certificate_check_consistency check (
    (status='recorded_unverified' and checked_by is null and checked_at is null and
      observed_membership_number is null and checker_recorded_outcome is null and portal_check_evidence_reference is null)
    or
    (status<>'recorded_unverified' and checked_by is not null and checked_at is not null and
      observed_membership_number is not null and observed_membership_number ~ '^[0-9]{6}
      length(trim(coalesce(portal_check_evidence_reference,'')))>=5 and
      ((status='portal_check_recorded' and checker_recorded_outcome='match' and observed_membership_number=ca_membership_number)
      or (status='disputed' and checker_recorded_outcome in ('not_found','mismatch'))))
  )
);

create table if not exists epr_finance_ca_certificate_events (
  event_id bigint generated always as identity primary key,
  certificate_id text not null references epr_finance_ca_signed_certificates(certificate_id) on delete restrict,
  event_type text not null check(event_type in ('recorded','portal_check_recorded','disputed')),
  actor_user_id text not null,
  evidence_reference text not null,
  recorded_at timestamptz not null default now()
);

-- Protect signed evidence identity from edits. Only checker fields/status can change.
create or replace function prevent_ca_certificate_evidence_mutation()
returns trigger language plpgsql as $$
begin
  if (to_jsonb(new) - array['status','checked_by','checked_at','observed_membership_number','checker_recorded_outcome','portal_check_evidence_reference']) is distinct from
     (to_jsonb(old) - array['status','checked_by','checked_at','observed_membership_number','checker_recorded_outcome','portal_check_evidence_reference']) then
    raise exception 'External CA certificate source and signed-document evidence are immutable';
  end if;
  if old.status<>'recorded_unverified' then
    raise exception 'CA certificate check result is immutable';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_ca_certificate_freeze on epr_finance_ca_signed_certificates;
create trigger trg_ca_certificate_freeze
before update on epr_finance_ca_signed_certificates
for each row execute function prevent_ca_certificate_evidence_mutation();

create or replace function prevent_ca_certificate_event_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'CA certificate events are append-only';
end;
$$;
drop trigger if exists trg_ca_certificate_event_immutable on epr_finance_ca_certificate_events;
create trigger trg_ca_certificate_event_immutable
before update or delete on epr_finance_ca_certificate_events
for each row execute function prevent_ca_certificate_event_mutation();
 and
      checker_recorded_outcome is not null and
      length(trim(coalesce(portal_check_evidence_reference,'')))>=5 and
      ((status='portal_check_recorded' and checker_recorded_outcome='match' and observed_membership_number=ca_membership_number)
      or (status='disputed' and checker_recorded_outcome in ('not_found','mismatch'))))
  )
);

create table if not exists epr_finance_ca_certificate_events (
  event_id bigint generated always as identity primary key,
  certificate_id text not null references epr_finance_ca_signed_certificates(certificate_id) on delete restrict,
  event_type text not null check(event_type in ('recorded','portal_check_recorded','disputed')),
  actor_user_id text not null,
  evidence_reference text not null,
  recorded_at timestamptz not null default now()
);

-- Protect signed evidence identity from edits. Only checker fields/status can change.
create or replace function prevent_ca_certificate_evidence_mutation()
returns trigger language plpgsql as $$
begin
  if (to_jsonb(new) - array['status','checked_by','checked_at','observed_membership_number','checker_recorded_outcome','portal_check_evidence_reference']) is distinct from
     (to_jsonb(old) - array['status','checked_by','checked_at','observed_membership_number','checker_recorded_outcome','portal_check_evidence_reference']) then
    raise exception 'External CA certificate source and signed-document evidence are immutable';
  end if;
  if old.status<>'recorded_unverified' then
    raise exception 'CA certificate check result is immutable';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_ca_certificate_freeze on epr_finance_ca_signed_certificates;
create trigger trg_ca_certificate_freeze
before update on epr_finance_ca_signed_certificates
for each row execute function prevent_ca_certificate_evidence_mutation();

create or replace function prevent_ca_certificate_event_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'CA certificate events are append-only';
end;
$$;
drop trigger if exists trg_ca_certificate_event_immutable on epr_finance_ca_certificate_events;
create trigger trg_ca_certificate_event_immutable
before update or delete on epr_finance_ca_certificate_events
for each row execute function prevent_ca_certificate_event_mutation();
