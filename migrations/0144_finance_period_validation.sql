-- Forward-only correction for Finance YYYY-MM period validation.
--
-- 0084 and 0087 used doubled backslashes inside SQL regex strings. With
-- standard-conforming strings that makes the regex match a literal backslash
-- sequence instead of a numeric YYYY-MM period. Keep the historical migrations
-- immutable and replace the affected authorities here with unambiguous [0-9]
-- character classes.
--
-- Constraints are added NOT VALID so any pre-existing legacy rows do not block
-- deployment; PostgreSQL still enforces them for all new/updated rows.

alter table epr_finance_payroll_controls
  drop constraint if exists epr_finance_payroll_period_format_check;
alter table epr_finance_payroll_controls
  add constraint epr_finance_payroll_period_format_check
  check (period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$') not valid;

alter table vyndi_tooling_depreciation_runs
  drop constraint if exists vyndi_tooling_depreciation_runs_period_check;
alter table vyndi_tooling_depreciation_runs
  drop constraint if exists vyndi_tooling_depreciation_period_format_check;
alter table vyndi_tooling_depreciation_runs
  add constraint vyndi_tooling_depreciation_period_format_check
  check (period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$') not valid;

create or replace function save_vyndi_linked_payroll_control(
  p_payroll_id text,
  p_source_expenditure_id text,
  p_period text,
  p_gross_pay_inr numeric,
  p_deductions_inr numeric,
  p_employer_cost_inr numeric,
  p_statutory_payable_inr numeric,
  p_payment_reference text,
  p_return_evidence_reference text,
  p_actor_user_id text,
  p_actor_role text
) returns text
language plpgsql
as $$
declare
  v_existing epr_finance_payroll_controls%rowtype;
begin
  if trim(coalesce(p_payroll_id,''))='' then raise exception 'Payroll id is required.'; end if;
  if trim(coalesce(p_source_expenditure_id,''))='' then
    raise exception 'Governed payroll expenditure id is required.';
  end if;
  if p_period !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then
    raise exception 'Payroll period must use YYYY-MM.';
  end if;
  if coalesce(p_gross_pay_inr,0)<0 or coalesce(p_deductions_inr,0)<0
     or coalesce(p_employer_cost_inr,0)<0 or coalesce(p_statutory_payable_inr,0)<0 then
    raise exception 'Payroll control amounts cannot be negative.';
  end if;

  select * into v_existing
    from epr_finance_payroll_controls
   where payroll_id=upper(trim(p_payroll_id))
   for update;

  if found and v_existing.source_expenditure_id is not null
     and v_existing.source_expenditure_id<>trim(p_source_expenditure_id) then
    raise exception 'Payroll control is already linked to another governed expenditure.';
  end if;

  insert into epr_finance_payroll_controls(
    payroll_id,source_expenditure_id,period,gross_pay_inr,deductions_inr,employer_cost_inr,
    statutory_payable_inr,payment_reference,return_evidence_reference,approved_by,approved_at)
  values(
    upper(trim(p_payroll_id)),trim(p_source_expenditure_id),p_period,round(p_gross_pay_inr,2),
    round(p_deductions_inr,2),round(p_employer_cost_inr,2),round(p_statutory_payable_inr,2),
    nullif(trim(coalesce(p_payment_reference,'')),''),
    nullif(trim(coalesce(p_return_evidence_reference,'')),''),
    p_actor_user_id,now())
  on conflict (payroll_id) do update set
    source_expenditure_id=excluded.source_expenditure_id,
    period=excluded.period,
    gross_pay_inr=excluded.gross_pay_inr,
    deductions_inr=excluded.deductions_inr,
    employer_cost_inr=excluded.employer_cost_inr,
    statutory_payable_inr=excluded.statutory_payable_inr,
    payment_reference=excluded.payment_reference,
    return_evidence_reference=excluded.return_evidence_reference,
    approved_by=excluded.approved_by,
    approved_at=now();

  return upper(trim(p_payroll_id));
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
  if p_period !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then
    raise exception 'Tooling depreciation period must be YYYY-MM.';
  end if;
  if trim(coalesce(p_source_reference,''))='' then
    raise exception 'Tooling depreciation evidence/reference is required.';
  end if;

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

comment on function save_vyndi_linked_payroll_control(text,text,text,numeric,numeric,numeric,numeric,text,text,text,text) is
  'Writes payroll compliance evidence using an unambiguous governed YYYY-MM period validator.';
comment on function post_vyndi_tooling_depreciation(text,text,text,text,text) is
  'Posts governed tooling depreciation using an unambiguous YYYY-MM period validator.';
