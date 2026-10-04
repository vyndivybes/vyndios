-- VYNDI Risk Engine Package A
-- Enrich the existing canonical risk register without creating a competing authority.
-- All quantitative fields are nullable unless explicitly evidenced; VYNDI must not invent probabilities.

alter table vyndi_risk_register
  add column if not exists domain text not null default 'operational',
  add column if not exists owner text,
  add column if not exists due_on date,
  add column if not exists failure_mode text,
  add column if not exists effect text,
  add column if not exists cause text,
  add column if not exists severity smallint,
  add column if not exists occurrence smallint,
  add column if not exists detection smallint,
  add column if not exists evidence_confidence numeric(5,4),
  add column if not exists dependency_impact smallint,
  add column if not exists affected_objects jsonb not null default '[]'::jsonb,
  add column if not exists evidence_links jsonb not null default '[]'::jsonb,
  add column if not exists provenance_class text not null default 'assumed';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname='vyndi_risk_register_domain_chk'
  ) then
    alter table vyndi_risk_register add constraint vyndi_risk_register_domain_chk
      check (domain in (
        'technical','material','manufacturing','quality','validation','schedule','cost',
        'supply_chain','configuration','compliance','commercial','cybersecurity','ip',
        'operational','evidence'
      ));
  end if;
  if not exists (
    select 1 from pg_constraint where conname='vyndi_risk_register_severity_chk'
  ) then
    alter table vyndi_risk_register add constraint vyndi_risk_register_severity_chk
      check (severity is null or severity between 1 and 10);
  end if;
  if not exists (
    select 1 from pg_constraint where conname='vyndi_risk_register_occurrence_chk'
  ) then
    alter table vyndi_risk_register add constraint vyndi_risk_register_occurrence_chk
      check (occurrence is null or occurrence between 1 and 10);
  end if;
  if not exists (
    select 1 from pg_constraint where conname='vyndi_risk_register_detection_chk'
  ) then
    alter table vyndi_risk_register add constraint vyndi_risk_register_detection_chk
      check (detection is null or detection between 1 and 10);
  end if;
  if not exists (
    select 1 from pg_constraint where conname='vyndi_risk_register_evidence_confidence_chk'
  ) then
    alter table vyndi_risk_register add constraint vyndi_risk_register_evidence_confidence_chk
      check (evidence_confidence is null or (evidence_confidence between 0 and 1));
  end if;
  if not exists (
    select 1 from pg_constraint where conname='vyndi_risk_register_dependency_impact_chk'
  ) then
    alter table vyndi_risk_register add constraint vyndi_risk_register_dependency_impact_chk
      check (dependency_impact is null or dependency_impact between 0 and 100);
  end if;
  if not exists (
    select 1 from pg_constraint where conname='vyndi_risk_register_provenance_class_chk'
  ) then
    alter table vyndi_risk_register add constraint vyndi_risk_register_provenance_class_chk
      check (provenance_class in ('measured','calculated','derived','assumed','predicted','ai_interpreted'));
  end if;
end $$;

update vyndi_risk_register
   set domain = case
     when id like '%CASH%' then 'cost'
     when id like '%CUSTOMS%' then 'compliance'
     when id like '%FOUNDER%' then 'operational'
     else domain
   end
 where domain='operational';

create or replace view vyndi_risk_intelligence as
select
  r.*,
  case r.likelihood when 'Low' then 1 when 'Med' then 2 when 'High' then 3 end
  * case r.impact when 'Low' then 1 when 'Med' then 2 when 'High' then 3 end as exposure_score,
  case
    when r.severity is not null and r.occurrence is not null and r.detection is not null
      then r.severity * r.occurrence * r.detection
    else null
  end as fmea_rpn
from vyndi_risk_register r;

comment on view vyndi_risk_intelligence is
  'Read model for the canonical risk register. Exposure uses governed ordinal likelihood/impact. FMEA RPN is emitted only when explicit S/O/D evidence exists; no probability is inferred.';
