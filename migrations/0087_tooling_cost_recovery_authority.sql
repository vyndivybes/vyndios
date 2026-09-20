-- VYNDI Tooling Cost & Recovery Authority.
-- Accounting depreciation and commercial recovery are intentionally separate.

-- Extend the canonical asset source ledger so manufacturing tooling is capitalized as a fixed asset,
-- rather than being misclassified as office expense.
alter table vyndi_people_office_assets drop constraint if exists vyndi_people_office_assets_asset_class_check;
alter table vyndi_people_office_assets add constraint vyndi_people_office_assets_asset_class_check
  check (asset_class in ('office_admin','office_consumable','manufacturing_tooling'));

create or replace function create_vyndi_people_office_actual_expenditure(
  p_id text,
  p_source_type text,
  p_source_id text,
  p_plan_month integer,
  p_incurred_on date,
  p_description text,
  p_amount_inr numeric,
  p_source_reference text,
  p_notes text,
  p_actor_user_id text,
  p_actor_role text
) returns text
language plpgsql
as $$
declare
  v_label text;
  v_category text;
  v_debit text;
  v_liability text;
begin
  if trim(coalesce(p_source_reference,''))='' then raise exception 'Actual expenditure evidence/source reference is required.'; end if;
  if trim(coalesce(p_description,''))='' then raise exception 'Actual expenditure description is required.'; end if;
  if coalesce(p_amount_inr,0)<=0 then raise exception 'Actual expenditure amount must be positive.'; end if;
  if p_plan_month not between 1 and 36 then raise exception 'Actual expenditure accrual plan month must be between 1 and 36.'; end if;

  if p_source_type='cost_item' then
    select name,cost_group into v_label,v_category
      from vyndi_people_office_cost_items
     where id=p_source_id and lifecycle_status='approved';
    if not found then raise exception 'Actual cost requires an approved People & Office cost item.'; end if;
    v_debit:=case v_category
      when 'payroll' then '6100'
      when 'office' then '6200'
      when 'statutory' then '6300'
      when 'outsourcing' then '6400'
      else null end;
    v_liability:=case when v_category in ('payroll','statutory') then '2200' else '2000' end;
  elsif p_source_type='asset' then
    select name,asset_class into v_label,v_category
      from vyndi_people_office_assets
     where id=p_source_id and lifecycle_status='approved';
    if not found then raise exception 'Actual asset spend requires an approved People & Office asset item.'; end if;
    v_debit:=case
      when v_category in ('office_admin','manufacturing_tooling') then '1500'
      when v_category='office_consumable' then '6200'
      else null end;
    v_liability:='2000';
  else
    raise exception 'Unsupported People & Office source type %.',p_source_type;
  end if;

  if v_debit is null then raise exception 'No controlled accounting map exists for source %.',p_source_id; end if;

  insert into vyndi_people_office_actual_expenditures(
    id,source_type,source_id,source_label,source_category,plan_month,incurred_on,description,
    amount_inr,debit_account_code,liability_account_code,lifecycle_status,source_reference,notes,created_by)
  values(
    p_id,p_source_type,p_source_id,v_label,v_category,p_plan_month,p_incurred_on,trim(p_description),
    round(p_amount_inr,2),v_debit,v_liability,'draft',trim(p_source_reference),coalesce(p_notes,''),p_actor_user_id);

  insert into vyndi_audit_events(
    id,entity_type,entity_id,action,actor_user_id,actor_role,source_reference,payload_json)
  values(
    'AUD-'||p_id||'-DRAFT','people_office_actual_expenditure',p_id,'draft_created',p_actor_user_id,p_actor_role,
    p_source_reference,jsonb_build_object('sourceType',p_source_type,'sourceId',p_source_id,'accrualPlanMonth',p_plan_month,
      'amountInr',round(p_amount_inr,2),'debitAccount',v_debit,'liabilityAccount',v_liability));
  return p_id;
end;
$$;

create or replace view vyndi_people_office_finance_feed as
with months as (select generate_series(1,36)::int as plan_month),
monthly_opex as (
  select m.plan_month,
         coalesce(sum(
           case when c.lifecycle_status='approved' and m.plan_month between c.start_month and c.end_month
                then c.quantity*c.monthly_unit_cost_lakh else 0 end
           + case when c.lifecycle_status='approved' and c.one_time_month=m.plan_month
                then c.one_time_cost_lakh else 0 end
         ),0)::numeric(18,4) as opex_lakh
  from months m cross join vyndi_people_office_cost_items c
  group by m.plan_month
),
asset_months as (
  select m.plan_month,
         coalesce(sum(case when a.lifecycle_status='approved'
                            and a.asset_class in ('office_admin','manufacturing_tooling')
                            and a.purchase_month=m.plan_month
                           then a.cost_lakh else 0 end),0)::numeric(18,4) as capex_lakh,
         coalesce(sum(case when a.lifecycle_status='approved'
                            and a.asset_class in ('office_admin','manufacturing_tooling')
                            and m.plan_month>=a.purchase_month and m.plan_month<a.purchase_month+a.useful_life_months
                           then (a.cost_lakh/a.useful_life_months)*(a.allocation_pct/100) else 0 end),0)::numeric(18,4) as depreciation_lakh,
         coalesce(sum(case when a.lifecycle_status='approved'
                            and a.asset_class='office_consumable'
                            and m.plan_month>=a.purchase_month
                           then a.monthly_cost_lakh*(a.allocation_pct/100) else 0 end),0)::numeric(18,4) as consumables_lakh
  from months m cross join vyndi_people_office_assets a
  group by m.plan_month
)
select m.plan_month,
       coalesce(o.opex_lakh,0)+coalesce(a.consumables_lakh,0) as operating_expense_lakh,
       coalesce(a.capex_lakh,0) as office_capex_lakh,
       coalesce(a.depreciation_lakh,0) as office_depreciation_lakh
from months m
left join monthly_opex o using (plan_month)
left join asset_months a using (plan_month)
order by m.plan_month;

create table if not exists vyndi_tooling_cost_profiles (
  id text primary key,
  asset_id text not null unique references epr_finance_fixed_assets(asset_id) on delete restrict,
  tool_type text not null check (tool_type in (
    'frame_mould','fork_mould','seatpost_mould','bladder_eps_mandrel',
    'trim_drill_fixture','bonding_fixture','curing_fixture','inspection_gauge','other_tooling'
  )),
  product_id text,
  variant_id text,
  frame_size text,
  process text,
  residual_value_inr numeric(18,2) not null default 0 check (residual_value_inr>=0),
  commercial_recovery_basis_inr numeric(18,2) not null check (commercial_recovery_basis_inr>0),
  target_recovery_quantity numeric(18,4) not null check (target_recovery_quantity>0),
  source_reference text not null,
  status text not null default 'draft' check (status in ('draft','approved','retired')),
  created_by text not null,
  created_at timestamptz not null default now(),
  approved_by text,
  approved_at timestamptz,
  retired_at timestamptz,
  check (
    product_id is not null or variant_id is not null or frame_size is not null
  )
);

create table if not exists vyndi_tooling_depreciation_runs (
  id text primary key,
  profile_id text not null references vyndi_tooling_cost_profiles(id) on delete restrict,
  asset_id text not null references epr_finance_fixed_assets(asset_id) on delete restrict,
  period text not null check (period ~ '^\\d{4}-(0[1-9]|1[0-2])$'),
  depreciation_inr numeric(18,2) not null check (depreciation_inr>0),
  journal_id text not null references epr_finance_journals(id) on delete restrict,
  allocation_status text not null default 'drafts_created' check (allocation_status in ('drafts_created','partially_approved','fully_approved','no_eligible_jobs')),
  source_reference text not null,
  posted_by text not null,
  posted_at timestamptz not null default now(),
  unique(profile_id,period)
);

create index if not exists vyndi_tooling_profile_scope_idx
  on vyndi_tooling_cost_profiles(status,product_id,variant_id,frame_size);
create index if not exists vyndi_tooling_depreciation_period_idx
  on vyndi_tooling_depreciation_runs(period,profile_id);

create or replace function approve_vyndi_tooling_cost_profile(
  p_id text,p_actor_user_id text,p_actor_role text
) returns text
language plpgsql
as $$
declare
  v_profile vyndi_tooling_cost_profiles%rowtype;
  v_asset epr_finance_fixed_assets%rowtype;
begin
  perform pg_advisory_xact_lock(hashtext('tooling-profile|'||p_id)::bigint);
  select * into v_profile from vyndi_tooling_cost_profiles where id=p_id for update;
  if not found then raise exception 'Tooling cost profile not found.'; end if;
  if v_profile.status='approved' then return v_profile.id; end if;
  if v_profile.status<>'draft' then raise exception 'Only draft tooling profiles can be approved.'; end if;

  select * into v_asset from epr_finance_fixed_assets where asset_id=v_profile.asset_id;
  if not found then raise exception 'Tooling profile requires a governed fixed asset.'; end if;
  if v_asset.status<>'active' then raise exception 'Tooling asset must be active.'; end if;
  if v_asset.acquisition_cost_inr<=0 then raise exception 'Tooling asset has no governed acquisition cost.'; end if;
  if v_profile.residual_value_inr>=v_asset.acquisition_cost_inr then
    raise exception 'Residual value must be below tooling acquisition cost.';
  end if;
  if v_profile.commercial_recovery_basis_inr>v_asset.acquisition_cost_inr+0.01 then
    raise exception 'Commercial recovery basis cannot exceed governed tooling acquisition cost.';
  end if;

  update vyndi_tooling_cost_profiles
     set status='approved',approved_by=p_actor_user_id,approved_at=now()
   where id=p_id;

  insert into vyndi_audit_events(
    id,entity_type,entity_id,action,actor_user_id,actor_role,source_reference,payload_json
  ) values (
    'AUD-TOOL-'||p_id||'-APPROVE','tooling_cost_profile',p_id,'approved',
    p_actor_user_id,p_actor_role,v_profile.source_reference,
    jsonb_build_object(
      'assetId',v_profile.asset_id,'toolType',v_profile.tool_type,'productId',v_profile.product_id,
      'variantId',v_profile.variant_id,'frameSize',v_profile.frame_size,'process',v_profile.process,
      'commercialRecoveryBasisInr',v_profile.commercial_recovery_basis_inr,
      'targetRecoveryQuantity',v_profile.target_recovery_quantity
    )
  ) on conflict do nothing;

  return p_id;
end;
$$;

create or replace function post_vyndi_tooling_depreciation(
  p_profile_id text,
  p_period text,
  p_source_reference text,
  p_actor_user_id text,
  p_actor_role text
) returns table(run_id text,journal_id text,depreciation_inr numeric,draft_allocations integer)
language plpgsql
as $$
declare
  v_profile vyndi_tooling_cost_profiles%rowtype;
  v_asset epr_finance_fixed_assets%rowtype;
  v_period_start date;
  v_period_end date;
  v_depreciable numeric;
  v_monthly numeric;
  v_remaining numeric;
  v_dep numeric;
  v_journal text;
  v_run text;
  v_total_units numeric:=0;
  v_created integer:=0;
  v_job record;
  v_amount numeric;
  v_allocated numeric:=0;
  v_line_no integer;
begin
  if p_period !~ '^\\d{4}-(0[1-9]|1[0-2])$' then raise exception 'Tooling depreciation period must be YYYY-MM.'; end if;
  if trim(coalesce(p_source_reference,''))='' then raise exception 'Tooling depreciation evidence/reference is required.'; end if;

  perform pg_advisory_xact_lock(hashtext('tooling-dep|'||p_profile_id||'|'||p_period)::bigint);
  if exists(select 1 from vyndi_tooling_depreciation_runs where profile_id=p_profile_id and period=p_period) then
    return query
      select r.id,r.journal_id,r.depreciation_inr,
             (select count(*)::int from epr_job_conversion_cost_allocations a where a.source_journal_id=r.journal_id)
        from vyndi_tooling_depreciation_runs r
       where r.profile_id=p_profile_id and r.period=p_period;
    return;
  end if;

  select * into v_profile from vyndi_tooling_cost_profiles where id=p_profile_id and status='approved';
  if not found then raise exception 'Approved tooling cost profile not found.'; end if;
  select * into v_asset from epr_finance_fixed_assets where asset_id=v_profile.asset_id and status='active';
  if not found then raise exception 'Active governed tooling asset not found.'; end if;

  v_period_start:=to_date(p_period||'-01','YYYY-MM-DD');
  v_period_end:=(v_period_start+interval '1 month - 1 day')::date;
  if v_period_end<v_asset.capitalization_date then raise exception 'Cannot depreciate tooling before capitalization date.'; end if;

  v_depreciable:=greatest(v_asset.acquisition_cost_inr-v_profile.residual_value_inr,0);
  v_monthly:=round(v_depreciable/greatest(v_asset.useful_life_months,1),2);
  v_remaining:=greatest(v_depreciable-coalesce(v_asset.accumulated_depreciation_inr,0),0);
  v_dep:=least(v_monthly,v_remaining);
  if v_dep<=0 then raise exception 'Tooling asset is fully depreciated to its governed residual value.'; end if;

  v_run:='TOOLDEP-'||p_profile_id||'-'||replace(p_period,'-','');
  v_journal:='FIN-TOOLDEP-'||p_profile_id||'-'||replace(p_period,'-','');

  perform post_vyndi_finance_journal(
    v_journal,v_period_end,'tooling_depreciation',v_run,
    'Tooling depreciation '||v_profile.id||' · '||p_period,
    jsonb_build_array(
      jsonb_build_object('accountCode','6500','debitInr',v_dep,'memo','Manufacturing tooling depreciation'),
      jsonb_build_object('accountCode','1590','creditInr',v_dep,'memo','Accumulated depreciation · tooling')
    )
  );

  update epr_finance_fixed_assets
     set accumulated_depreciation_inr=least(v_depreciable,coalesce(accumulated_depreciation_inr,0)+v_dep),
         updated_at=now()
   where asset_id=v_asset.asset_id;

  select l.line_no into v_line_no
    from epr_finance_journal_lines l
   where l.journal_id=v_journal and l.account_code='6500' and l.debit_inr>0
   order by l.line_no limit 1;

  select coalesce(sum(j.units),0) into v_total_units
    from epr_production_job_cards j
   where j.status in ('released','in_progress')
     and (v_profile.product_id is null or j.product_id=v_profile.product_id)
     and (v_profile.variant_id is null or j.variant_id=v_profile.variant_id)
     and (v_profile.frame_size is null or coalesce(j.configuration->>'frameSize',j.configuration->>'size','')=v_profile.frame_size);

  if v_total_units>0 then
    for v_job in
      select j.id,j.units,
             row_number() over(order by j.id) as allocation_no,
             count(*) over() as allocation_count
        from epr_production_job_cards j
       where j.status in ('released','in_progress')
         and (v_profile.product_id is null or j.product_id=v_profile.product_id)
         and (v_profile.variant_id is null or j.variant_id=v_profile.variant_id)
         and (v_profile.frame_size is null or coalesce(j.configuration->>'frameSize',j.configuration->>'size','')=v_profile.frame_size)
       order by j.id
    loop
      v_amount:=case
        when v_job.allocation_no=v_job.allocation_count then round(v_dep-v_allocated,2)
        else round(v_dep*(v_job.units/v_total_units),2)
      end;
      if v_amount>0 then
        insert into epr_job_conversion_cost_allocations(
          id,job_card_id,category,amount_inr,source_journal_id,source_line_no,source_reference,created_by
        ) values(
          'JCOST-'||v_run||'-'||v_job.id,
          v_job.id,'manufacturing_depreciation',v_amount,v_journal,v_line_no,
          p_source_reference||' · automatic tooling depreciation allocation',p_actor_user_id
        ) on conflict do nothing;
        v_allocated:=v_allocated+v_amount;
        v_created:=v_created+1;
      end if;
    end loop;
  end if;

  insert into vyndi_tooling_depreciation_runs(
    id,profile_id,asset_id,period,depreciation_inr,journal_id,allocation_status,source_reference,posted_by
  ) values(
    v_run,v_profile.id,v_profile.asset_id,p_period,v_dep,v_journal,
    case when v_created>0 then 'drafts_created' else 'no_eligible_jobs' end,
    p_source_reference,p_actor_user_id
  );

  insert into vyndi_audit_events(
    id,entity_type,entity_id,action,actor_user_id,actor_role,source_reference,payload_json
  ) values (
    'AUD-'||v_run,'tooling_depreciation',v_run,'posted',
    p_actor_user_id,p_actor_role,p_source_reference,
    jsonb_build_object(
      'profileId',v_profile.id,'assetId',v_profile.asset_id,'period',p_period,
      'depreciationInr',v_dep,'journalId',v_journal,'draftAllocations',v_created
    )
  ) on conflict do nothing;

  return query select v_run,v_journal,v_dep,v_created;
end;
$$;



create or replace function refresh_vyndi_tooling_depreciation_allocation_status(p_journal_id text)
returns void
language plpgsql
as $$
declare
  v_run_id text;
  v_total integer:=0;
  v_approved integer:=0;
  v_open integer:=0;
begin
  select id into v_run_id
    from vyndi_tooling_depreciation_runs
   where journal_id=p_journal_id;
  if not found then return; end if;

  select count(*)::int,
         count(*) filter(where status='approved')::int,
         count(*) filter(where status='draft')::int
    into v_total,v_approved,v_open
    from epr_job_conversion_cost_allocations
   where source_journal_id=p_journal_id
     and category='manufacturing_depreciation';

  update vyndi_tooling_depreciation_runs
     set allocation_status=case
       when v_total=0 then 'no_eligible_jobs'
       when v_open=0 and v_approved=v_total then 'fully_approved'
       when v_approved>0 then 'partially_approved'
       else 'drafts_created'
     end
   where id=v_run_id;
end;
$$;

create or replace function trg_refresh_vyndi_tooling_allocation_status()
returns trigger
language plpgsql
as $$
begin
  if new.category='manufacturing_depreciation' then
    perform refresh_vyndi_tooling_depreciation_allocation_status(new.source_journal_id);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_vyndi_tooling_allocation_status on epr_job_conversion_cost_allocations;
create trigger trg_vyndi_tooling_allocation_status
after insert or update of status on epr_job_conversion_cost_allocations
for each row execute function trg_refresh_vyndi_tooling_allocation_status();

create or replace view vyndi_tooling_recovery_status as
with dispatched as (
  select
    p.id as profile_id,
    coalesce(sum(s.units) filter(where j.id is not null),0)::numeric(18,4) as eligible_dispatched_units
  from vyndi_tooling_cost_profiles p
  left join vyndi_shipments s on s.status='posted'
  left join epr_production_job_cards j on j.id=s.job_card_id
    and (p.product_id is null or j.product_id=p.product_id)
    and (p.variant_id is null or j.variant_id=p.variant_id)
    and (p.frame_size is null or coalesce(j.configuration->>'frameSize',j.configuration->>'size','')=p.frame_size)
  where p.status='approved'
  group by p.id
)
select
  p.id as profile_id,
  p.asset_id,
  p.tool_type,
  p.product_id,
  p.variant_id,
  p.frame_size,
  p.process,
  a.description,
  a.acquisition_cost_inr,
  a.useful_life_months,
  a.accumulated_depreciation_inr,
  p.residual_value_inr,
  p.commercial_recovery_basis_inr,
  p.target_recovery_quantity,
  round(p.commercial_recovery_basis_inr/p.target_recovery_quantity,2) as target_recovery_per_unit_inr,
  coalesce(d.eligible_dispatched_units,0) as eligible_dispatched_units,
  least(
    p.commercial_recovery_basis_inr,
    round(coalesce(d.eligible_dispatched_units,0)*(p.commercial_recovery_basis_inr/p.target_recovery_quantity),2)
  ) as commercial_recovery_progress_inr,
  greatest(
    p.commercial_recovery_basis_inr-
    least(
      p.commercial_recovery_basis_inr,
      round(coalesce(d.eligible_dispatched_units,0)*(p.commercial_recovery_basis_inr/p.target_recovery_quantity),2)
    ),0
  ) as commercial_recovery_remaining_inr,
  round(
    least(coalesce(d.eligible_dispatched_units,0)/p.target_recovery_quantity,1)*100,2
  ) as recovery_progress_pct
from vyndi_tooling_cost_profiles p
join epr_finance_fixed_assets a on a.asset_id=p.asset_id
left join dispatched d on d.profile_id=p.id
where p.status='approved';

comment on table vyndi_tooling_cost_profiles is
  'Governed mapping of an existing fixed tooling asset to product/variant/size/process plus commercial recovery target. Commercial recovery does not post accounting journals.';
comment on table vyndi_tooling_depreciation_runs is
  'Monthly straight-line accounting depreciation for approved tooling profiles. Debit 6500 / credit 1590, with draft Job Card WIP allocations created for eligible open production.';
comment on view vyndi_tooling_recovery_status is
  'Management-only tooling capital recovery progress based on eligible dispatched units. It is separate from accounting depreciation and COGS.';
