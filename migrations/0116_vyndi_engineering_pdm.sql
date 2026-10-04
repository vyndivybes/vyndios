-- VYNDI Package Q — Engineering PDM / Controlled Document Authority
-- Controls document identity, revision, checksum, lifecycle, where-used and released configuration manifests.
-- Binary files remain in their canonical storage location; VYNDI governs metadata, checksum and relationships.

create table if not exists vyndi_engineering_documents (
  id text primary key,
  document_number text not null unique,
  title text not null,
  document_type text not null check (document_type in ('cad_step','drawing','fea','cfd','material_spec','laminate','test_plan','test_report','ndt','tooling','manufacturing','specification','other')),
  domain text not null,
  owner text not null,
  source_ref text not null,
  created_by text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists vyndi_engineering_document_revisions (
  id text primary key,
  document_id text not null references vyndi_engineering_documents(id) on delete restrict,
  revision_code text not null,
  status text not null default 'draft' check (status in ('draft','pending_approval','approved','released','superseded','rejected')),
  content_sha256 text not null check (content_sha256 ~ '^[0-9a-f]{64}$'),
  file_name text not null,
  media_type text not null,
  file_size_bytes bigint not null check (file_size_bytes>0),
  source_uri text not null,
  source_ref text not null,
  created_by text not null,
  submitted_by text,
  approved_by text,
  released_by text,
  supersedes_revision_id text references vyndi_engineering_document_revisions(id) on delete restrict,
  superseded_by_revision_id text references vyndi_engineering_document_revisions(id) on delete restrict,
  release_note text,
  created_at timestamptz not null default now(),
  approved_at timestamptz,
  released_at timestamptz,
  superseded_at timestamptz,
  unique(document_id,revision_code)
);
create unique index if not exists vyndi_engineering_document_one_released_uq
  on vyndi_engineering_document_revisions(document_id) where status='released';
create index if not exists vyndi_engineering_document_revision_status_idx
  on vyndi_engineering_document_revisions(status,document_id,created_at desc);

create table if not exists vyndi_engineering_document_links (
  id text primary key,
  revision_id text not null references vyndi_engineering_document_revisions(id) on delete restrict,
  target_type text not null check (target_type in ('engineering_baseline','eco','ecn','bom_revision','vedm_authority_node')),
  target_id text not null,
  relation text not null check (relation in ('CONTROLS','EVIDENCES','VALIDATES','DERIVES_FROM','REQUIRES')),
  authority_source_commit text,
  source_ref text not null,
  created_by text not null,
  created_at timestamptz not null default now(),
  unique(revision_id,target_type,target_id,relation)
);
create index if not exists vyndi_engineering_document_link_target_idx
  on vyndi_engineering_document_links(target_type,target_id,relation,created_at desc);

create table if not exists vyndi_engineering_configuration_manifests (
  id text primary key,
  baseline_id text not null references vyndi_engineering_baselines(id) on delete restrict,
  bom_release_id text references vyndi_bom_revision_releases(id) on delete restrict,
  configuration_fingerprint text not null check (configuration_fingerprint ~ '^[0-9a-f]{64}$'),
  document_count integer not null check (document_count>0),
  manifest_json jsonb not null,
  finalized boolean not null default false,
  source_ref text not null,
  captured_by text not null,
  captured_role text not null,
  created_at timestamptz not null default now()
);
create unique index if not exists vyndi_engineering_configuration_manifest_scope_uq
  on vyndi_engineering_configuration_manifests(baseline_id,coalesce(bom_release_id,''));

create table if not exists vyndi_engineering_configuration_manifest_documents (
  manifest_id text not null references vyndi_engineering_configuration_manifests(id) on delete restrict,
  document_id text not null references vyndi_engineering_documents(id) on delete restrict,
  revision_id text not null references vyndi_engineering_document_revisions(id) on delete restrict,
  content_sha256 text not null check (content_sha256 ~ '^[0-9a-f]{64}$'),
  primary key(manifest_id,document_id)
);

comment on table vyndi_engineering_documents is 'Controlled engineering document master. No binary payload is duplicated here; the authoritative file remains at source_uri.';
comment on table vyndi_engineering_document_revisions is 'Controlled PDM revision metadata with exact SHA-256 identity and governed lifecycle.';
comment on table vyndi_engineering_document_links is 'Explicit where-used relationships from a controlled revision to baseline/ECO/ECN/BOM/VEDM authority.';
comment on table vyndi_engineering_configuration_manifests is 'Immutable released configuration manifest of exact controlled revisions and checksums.';

create or replace function vyndi_guard_engineering_document_revision_mutation()
returns trigger
language plpgsql
as $$
begin
  if tg_op='DELETE' and old.status in ('released','superseded') then
    raise exception 'Released or superseded engineering document revision is immutable.';
  end if;
  if tg_op='UPDATE' and old.status='superseded' then
    raise exception 'Superseded engineering document revision is immutable.';
  end if;
  if tg_op='UPDATE' and old.status='released' then
    if new.status<>'superseded'
       or new.superseded_by_revision_id is null
       or new.document_id<>old.document_id
       or new.revision_code<>old.revision_code
       or new.content_sha256<>old.content_sha256
       or new.file_name<>old.file_name
       or new.media_type<>old.media_type
       or new.file_size_bytes<>old.file_size_bytes
       or new.source_uri<>old.source_uri
       or new.source_ref<>old.source_ref
       or new.created_by<>old.created_by
    then
      raise exception 'Released engineering document revision may only transition atomically to superseded without content mutation.';
    end if;
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists trg_vyndi_engineering_document_revision_mutation on vyndi_engineering_document_revisions;
create trigger trg_vyndi_engineering_document_revision_mutation
before update or delete on vyndi_engineering_document_revisions
for each row execute function vyndi_guard_engineering_document_revision_mutation();

create or replace function vyndi_guard_engineering_document_link_mutation()
returns trigger
language plpgsql
as $$
declare
  v_revision_id text;
  v_status text;
begin
  v_revision_id:=case when tg_op='DELETE' then old.revision_id else new.revision_id end;
  select status into v_status from vyndi_engineering_document_revisions where id=v_revision_id;
  if v_status is distinct from 'draft' then
    raise exception 'Engineering document where-used links are editable only while revision is draft.';
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists trg_vyndi_engineering_document_link_mutation on vyndi_engineering_document_links;
create trigger trg_vyndi_engineering_document_link_mutation
before insert or update or delete on vyndi_engineering_document_links
for each row execute function vyndi_guard_engineering_document_link_mutation();

create or replace function vyndi_reject_released_document_mutation()
returns trigger
language plpgsql
as $$
begin
  if tg_table_name='vyndi_engineering_configuration_manifests' then
    if tg_op='UPDATE'
       and old.finalized=false
       and new.finalized=true
       and new.id=old.id
       and new.baseline_id=old.baseline_id
       and new.bom_release_id is not distinct from old.bom_release_id
       and new.configuration_fingerprint=old.configuration_fingerprint
       and new.document_count=old.document_count
       and new.manifest_json=old.manifest_json
       and new.source_ref=old.source_ref
       and new.captured_by=old.captured_by
       and new.captured_role=old.captured_role
    then
      return new;
    end if;
  end if;
  raise exception 'Released engineering configuration manifest is immutable.';
end;
$$;

create or replace function vyndi_guard_manifest_document_insert()
returns trigger
language plpgsql
as $$
declare
  v_finalized boolean;
begin
  select finalized into v_finalized from vyndi_engineering_configuration_manifests where id=new.manifest_id;
  if coalesce(v_finalized,true) then
    raise exception 'Released engineering configuration manifest is finalized; document set cannot be changed.';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_vyndi_engineering_configuration_manifest_immutable on vyndi_engineering_configuration_manifests;
create trigger trg_vyndi_engineering_configuration_manifest_immutable
before update or delete on vyndi_engineering_configuration_manifests
for each row execute function vyndi_reject_released_document_mutation();

drop trigger if exists trg_vyndi_engineering_configuration_manifest_document_insert on vyndi_engineering_configuration_manifest_documents;
create trigger trg_vyndi_engineering_configuration_manifest_document_insert
before insert on vyndi_engineering_configuration_manifest_documents
for each row execute function vyndi_guard_manifest_document_insert();

drop trigger if exists trg_vyndi_engineering_configuration_manifest_documents_immutable on vyndi_engineering_configuration_manifest_documents;
create trigger trg_vyndi_engineering_configuration_manifest_documents_immutable
before update or delete on vyndi_engineering_configuration_manifest_documents
for each row execute function vyndi_reject_released_document_mutation();

create or replace function release_vyndi_engineering_document_revision(
  p_revision_id text,
  p_release_note text,
  p_source_reference text,
  p_actor_user_id text,
  p_actor_role text
) returns text
language plpgsql
as $$
declare
  r record;
  prior record;
  v_link_count integer;
  v_bad_target integer;
begin
  if trim(coalesce(p_source_reference,''))='' then raise exception 'Document release evidence reference is required.'; end if;
  if trim(coalesce(p_release_note,''))='' then raise exception 'Document release note is required.'; end if;
  perform pg_advisory_xact_lock(hashtext('engineering-document|'||p_revision_id)::bigint);

  select * into r from vyndi_engineering_document_revisions where id=p_revision_id for update;
  if not found then raise exception 'Engineering document revision not found.'; end if;
  if r.status<>'approved' then raise exception 'Engineering document revision must be approved before release.'; end if;
  if r.created_by=p_actor_user_id then raise exception 'SOD_MAKER_CHECKER: document creator cannot release the same revision.'; end if;

  select count(*)::int into v_link_count from vyndi_engineering_document_links where revision_id=p_revision_id;
  if v_link_count=0 then raise exception 'Engineering document release requires at least one governed where-used link.'; end if;

  select count(*)::int into v_bad_target
    from vyndi_engineering_document_links l
   where l.revision_id=p_revision_id
     and (
       (l.target_type='engineering_baseline' and not exists(select 1 from vyndi_engineering_baselines b where b.id=l.target_id))
       or (l.target_type='eco' and not exists(select 1 from vyndi_engineering_change_orders o where o.id=l.target_id))
       or (l.target_type='ecn' and not exists(select 1 from vyndi_engineering_change_notices n where n.id=l.target_id))
       or (l.target_type='bom_revision' and not exists(select 1 from vyndi_bom_revision_releases br where br.id=l.target_id))
       or (l.target_type='vedm_authority_node' and coalesce(l.authority_source_commit,'')<>'b874cde910ce462724b63bac6b7e7f79e7d68785')
     );
  if v_bad_target>0 then raise exception 'Engineering document release blocked: one or more where-used targets are not canonical/current authority.'; end if;

  if exists(
    select 1
      from vyndi_engineering_document_links l
     where l.revision_id=p_revision_id
       and l.relation='CONTROLS'
       and (
         (l.target_type='engineering_baseline' and exists(select 1 from vyndi_engineering_configuration_manifests m where m.baseline_id=l.target_id))
         or (l.target_type='bom_revision' and exists(select 1 from vyndi_engineering_configuration_manifests m where m.bom_release_id=l.target_id))
         or (l.target_type='ecn' and exists(select 1 from vyndi_engineering_change_notices n join vyndi_engineering_configuration_manifests m on m.baseline_id=n.target_baseline_id where n.id=l.target_id))
       )
  ) then
    raise exception 'Controlled configuration is already frozen by a released manifest; create a new Engineering baseline/change instead of mutating the released configuration.';
  end if;

  select * into prior
    from vyndi_engineering_document_revisions
   where document_id=r.document_id and status='released' and id<>r.id
   limit 1
   for update;

  if found then
    update vyndi_engineering_document_revisions
       set status='superseded',superseded_by_revision_id=r.id,superseded_at=now()
     where id=prior.id;
    update vyndi_engineering_document_revisions
       set supersedes_revision_id=prior.id,status='released',released_by=p_actor_user_id,released_at=now(),release_note=trim(p_release_note)
     where id=r.id;
  else
    update vyndi_engineering_document_revisions
       set status='released',released_by=p_actor_user_id,released_at=now(),release_note=trim(p_release_note)
     where id=r.id;
  end if;

  insert into vyndi_audit_events(id,entity_type,entity_id,action,actor_user_id,actor_role,source_reference,payload_json)
  values(
    'AUD-PDM-REL-'||r.id,'engineering_document_revision',r.id,'ENGINEERING_DOCUMENT_RELEASED',
    p_actor_user_id,p_actor_role,trim(p_source_reference),
    jsonb_build_object('documentId',r.document_id,'revisionCode',r.revision_code,'contentSha256',r.content_sha256,'supersedesRevisionId',case when prior.id is null then null else prior.id end)
  );

  return r.id;
end;
$$;


create or replace function capture_vyndi_engineering_configuration_manifest(
  p_id text,
  p_baseline_id text,
  p_bom_release_id text,
  p_configuration_fingerprint text,
  p_manifest_json jsonb,
  p_source_reference text,
  p_actor_user_id text,
  p_actor_role text,
  p_documents jsonb
) returns text
language plpgsql
as $$
declare
  b record;
  br record;
  v_count integer;
  v_expected integer;
  v_inserted integer;
begin
  if trim(coalesce(p_source_reference,''))='' then raise exception 'Configuration manifest evidence reference is required.'; end if;
  if coalesce(p_configuration_fingerprint,'') !~ '^[0-9a-f]{64}$' then raise exception 'Configuration manifest fingerprint must be SHA-256 hex.'; end if;
  if jsonb_typeof(p_documents)<>'array' or jsonb_array_length(p_documents)=0 then raise exception 'Configuration manifest requires at least one controlled document revision.'; end if;

  perform pg_advisory_xact_lock(hashtext('engineering-manifest|'||p_baseline_id||'|'||coalesce(p_bom_release_id,''))::bigint);

  select * into b from vyndi_engineering_baselines where id=p_baseline_id;
  if not found or b.status<>'released' then raise exception 'Configuration manifest requires a released Engineering baseline.'; end if;

  if b.bom_revision is not null and p_bom_release_id is null then
    raise exception 'Released Engineering baseline carries a BOM revision; exact BOM release identity is required for the manifest.';
  end if;
  if b.bom_revision is null and p_bom_release_id is not null then
    raise exception 'Engineering baseline has no BOM revision; BOM release must not be attached to the manifest.';
  end if;
  if p_bom_release_id is not null then
    select * into br from vyndi_bom_revision_releases where id=p_bom_release_id;
    if not found or br.bom_revision<>b.bom_revision then
      raise exception 'Selected BOM release does not match the Engineering baseline BOM revision.';
    end if;
  end if;

  if exists(
    select 1 from vyndi_engineering_configuration_manifests
     where baseline_id=p_baseline_id and bom_release_id is not distinct from p_bom_release_id
  ) then raise exception 'Released configuration manifest already exists for this baseline/BOM scope.'; end if;

  select count(*)::int into v_count
    from jsonb_to_recordset(p_documents) as d(document_id text,revision_id text,content_sha256 text)
    join vyndi_engineering_document_revisions r on r.id=d.revision_id and r.document_id=d.document_id
   where r.status='released'
     and r.content_sha256=d.content_sha256
     and exists(
       select 1
         from vyndi_engineering_document_links l
        where l.revision_id=r.id
          and l.relation='CONTROLS'
          and (
            (l.target_type='engineering_baseline' and l.target_id=p_baseline_id)
            or (l.target_type='bom_revision' and p_bom_release_id is not null and l.target_id=p_bom_release_id)
            or (
              l.target_type='ecn'
              and exists(
                select 1 from vyndi_engineering_change_notices n
                 where n.id=l.target_id and n.target_baseline_id=p_baseline_id
              )
            )
          )
     );
  if v_count<>jsonb_array_length(p_documents) then
    raise exception 'Manifest contains a document revision that is not released or not a controlling link for this released configuration.';
  end if;

  select count(distinct r.document_id)::int into v_expected
    from vyndi_engineering_document_revisions r
    join vyndi_engineering_document_links l on l.revision_id=r.id and l.relation='CONTROLS'
   where r.status='released'
     and (
       (l.target_type='engineering_baseline' and l.target_id=p_baseline_id)
       or (l.target_type='bom_revision' and p_bom_release_id is not null and l.target_id=p_bom_release_id)
       or (
         l.target_type='ecn'
         and exists(
           select 1 from vyndi_engineering_change_notices n
            where n.id=l.target_id and n.target_baseline_id=p_baseline_id
         )
       )
     );
  if v_expected<>jsonb_array_length(p_documents) then
    raise exception 'Configuration manifest is incomplete: every released controlling document for the baseline/BOM scope must be included.';
  end if;

  if coalesce(p_manifest_json->>'baselineId','')<>p_baseline_id
     or coalesce(p_manifest_json->>'configurationFingerprint','')<>p_configuration_fingerprint
     or jsonb_array_length(coalesce(p_manifest_json->'documents','[]'::jsonb))<>jsonb_array_length(p_documents)
  then
    raise exception 'Configuration manifest JSON does not match the governed manifest identity/document set.';
  end if;

  insert into vyndi_engineering_configuration_manifests(
    id,baseline_id,bom_release_id,configuration_fingerprint,document_count,manifest_json,finalized,source_ref,captured_by,captured_role
  ) values(
    p_id,p_baseline_id,p_bom_release_id,p_configuration_fingerprint,jsonb_array_length(p_documents),p_manifest_json,false,
    trim(p_source_reference),p_actor_user_id,p_actor_role
  );

  insert into vyndi_engineering_configuration_manifest_documents(manifest_id,document_id,revision_id,content_sha256)
  select p_id,d.document_id,d.revision_id,d.content_sha256
    from jsonb_to_recordset(p_documents) as d(document_id text,revision_id text,content_sha256 text);
  get diagnostics v_inserted=row_count;
  if v_inserted<>jsonb_array_length(p_documents) then raise exception 'Configuration manifest document count mismatch.'; end if;

  update vyndi_engineering_configuration_manifests set finalized=true where id=p_id;

  insert into vyndi_audit_events(id,entity_type,entity_id,action,actor_user_id,actor_role,source_reference,payload_json)
  values(
    'AUD-PDM-MANIFEST-'||p_id,'engineering_configuration_manifest',p_id,'ENGINEERING_CONFIGURATION_MANIFEST_RELEASED',
    p_actor_user_id,p_actor_role,trim(p_source_reference),
    jsonb_build_object('baselineId',p_baseline_id,'bomReleaseId',p_bom_release_id,'configurationFingerprint',p_configuration_fingerprint,'documentCount',v_inserted)
  );

  return p_id;
end;
$$;
