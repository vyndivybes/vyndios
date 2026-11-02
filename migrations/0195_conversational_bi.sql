-- VYNDI schema migration 0195; add-only dashboard definition metadata. Existing business ledgers remain authoritative.
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

-- Production server-side Hyperdrive role needs metadata-only table access.
-- PGlite/local test roles do not necessarily exist: grant only if provisioned.
-- No browser/anon grants and no DELETE/TRUNCATE privileges.
do $
begin
 if exists (select 1 from pg_roles where rolname='hyperdrive-user') then
  execute 'grant usage on schema vyndi_private to "hyperdrive-user"';
  execute 'grant select, insert, update on vyndi_private.bi_dashboards to "hyperdrive-user"';
 end if;
end $;

-- Application DB role is server-only; every call uses requireBusinessActor,
-- owner predicates and current canonical route permissions. No browser grants.
