-- 0192: Management division attribution. No legal-entity creation, no ledger reposting.
-- Existing business records remain UNATTRIBUTED until an independently approved
-- evidence-backed classification exists. No automatic backfill or guessed mapping.
create table if not exists vyndi_group_management_units (
  id text primary key check (id in ('corporate','carbon','aluminium','software','vybes','merchandise')),
  display_name text not null,
  unit_type text not null default 'management_unit' check (unit_type='management_unit'),
  created_at timestamptz not null default now()
);

insert into vyndi_group_management_units(id,display_name) values
 ('corporate','Vāyú Shastr Corporate'),
 ('carbon','Carbon Bicycle Division'),
 ('aluminium','Aluminium Bicycle Division'),
 ('software','VYNDI OS / VAOS Software'),
 ('vybes','Vybes Community'),
 ('merchandise','Merchandise & Terrain Medals')
on conflict (id) do nothing;

create table if not exists vyndi_group_attribution_requests (
 id text primary key,
 source_kind text not null check (source_kind in (
  'sales_order','job_card','purchase_order','sales_invoice',
  'supplier_invoice','crm_customer','people_record'
 )),
 source_id text not null check (length(btrim(source_id)) between 1 and 120),
 division_id text not null references vyndi_group_management_units(id) on delete restrict,
 cost_center text not null default 'GENERAL' check (cost_center ~ '^[A-Z0-9_-]{2,60}$'),
 evidence_ref text not null check (length(btrim(evidence_ref)) between 5 and 500),
 status text not null default 'proposed' check (status in ('proposed','approved','rejected')),
 submitted_by text not null,
 submitted_role text not null,
 submitted_at timestamptz not null default now(),
 decided_by text,
 decided_role text,
 decision_evidence_ref text,
 decided_at timestamptz,
 check (
  (status='proposed' and decided_by is null and decided_at is null and decision_evidence_ref is null)
  or (status in ('approved','rejected') and decided_by is not null
      and decided_at is not null and length(btrim(decision_evidence_ref)) >= 5)
 ),
 check (decided_by is null or decided_by <> submitted_by)
);

-- Only one live approved attribution per source: prevents two departments
-- summing the same invoice, sales order, workforce record or job card.
create unique index if not exists vyndi_group_one_approved_source
 on vyndi_group_attribution_requests(source_kind,source_id)
 where status='approved';

create index if not exists vyndi_group_attribution_pending_idx
 on vyndi_group_attribution_requests(status,submitted_at desc);

-- An approved/rejected decision is immutable. Other columns of a proposed
-- request cannot be edited during approval. Historical evidence is retained.
create or replace function protect_vyndi_group_attribution_decision()
returns trigger language plpgsql as $$
begin
 if TG_OP='DELETE' then raise exception 'Group attribution evidence cannot be deleted'; end if;
 if OLD.status in ('approved','rejected') then
  raise exception 'Final group attribution evidence is immutable';
 end if;
 if OLD.id <> NEW.id or OLD.source_kind <> NEW.source_kind or OLD.source_id <> NEW.source_id
   or OLD.division_id <> NEW.division_id or OLD.cost_center <> NEW.cost_center
   or OLD.evidence_ref <> NEW.evidence_ref or OLD.submitted_by <> NEW.submitted_by
   or OLD.submitted_role <> NEW.submitted_role or OLD.submitted_at <> NEW.submitted_at then
  raise exception 'Proposed attribution cannot be modified; submit a new request';
 end if;
 if NEW.status not in ('approved','rejected') then
  raise exception 'Only final attribution decisions are permitted';
 end if;
 return NEW;
end $$;
create trigger vyndi_group_attribution_immutable
before update or delete on vyndi_group_attribution_requests
for each row execute function protect_vyndi_group_attribution_decision();

create or replace view vyndi_group_approved_attributions as
 select source_kind,source_id,division_id,cost_center,
  id as decision_id,evidence_ref,decision_evidence_ref,decided_at
 from vyndi_group_attribution_requests
 where status='approved';

-- This view is management classification only: never statutory consolidation.
-- It intentionally has no financial totals, eliminations or estimated values.
