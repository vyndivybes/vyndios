-- Definition metadata only. Existing business ledgers remain authoritative.
create schema if not exists vyndi_private;
revoke all on schema vyndi_private from public;
create table if not exists vyndi_private.bi_dashboards(
 id uuid primary key,
 owner_id text not null,
 visibility text not null default 'private' check(visibility in ('private','authorized')),
 definition jsonb not null check(jsonb_typeof(definition)='object' and octet_length(definition::text)<=8192),
 revision integer not null default 1 check(revision>0),
 updated_at timestamptz not null default now()
);
create index if not exists bi_dashboards_owner on vyndi_private.bi_dashboards(owner_id,updated_at desc);
alter table vyndi_private.bi_dashboards enable row level security;
revoke all on vyndi_private.bi_dashboards from public;
-- Application DB role is server-only; every call uses requireBusinessActor,
-- owner predicates and current canonical route permissions. No browser grants.
