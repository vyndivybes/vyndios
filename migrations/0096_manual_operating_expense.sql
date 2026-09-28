-- Manual operating-expense entry authority.
-- Enables evidenced unplanned/manual operating costs without fabricating a People & Office plan item.
-- Initial controlled category: digital services / domains & hosting -> account 6200.

alter table vyndi_people_office_actual_expenditures
  drop constraint if exists vyndi_people_office_actual_expenditures_source_type_check;

alter table vyndi_people_office_actual_expenditures
  add constraint vyndi_people_office_actual_expenditures_source_type_check
  check (source_type in ('cost_item','asset','manual_expense'));

create or replace function create_vyndi_people_office_actual_expenditure_v3(
  p_id text,
  p_source_type text,
  p_source_id text,
  p_plan_month integer,
  p_incurred_on date,
  p_description text,
  p_amount_inr numeric,
  p_source_reference text,
  p_notes text,
  p_funding_source text,
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
  v_result text;
begin
  if p_source_type <> 'manual_expense' then
    return create_vyndi_people_office_actual_expenditure_v2(
      p_id,p_source_type,p_source_id,p_plan_month,p_incurred_on,p_description,
      p_amount_inr,p_source_reference,p_notes,p_funding_source,p_actor_user_id,p_actor_role
    );
  end if;

  if p_funding_source not in ('company_bank','founder_personal') then
    raise exception 'Unsupported funding source %.',p_funding_source;
  end if;
  if trim(coalesce(p_source_reference,''))='' then
    raise exception 'Manual operating expense evidence/source reference is required.';
  end if;
  if trim(coalesce(p_description,''))='' then
    raise exception 'Manual operating expense description is required.';
  end if;
  if coalesce(p_amount_inr,0)<=0 then
    raise exception 'Manual operating expense amount must be positive.';
  end if;
  if p_plan_month not between 1 and 36 then
    raise exception 'Manual operating expense accrual plan month must be between 1 and 36.';
  end if;

  case p_source_id
    when 'digital_services' then
      v_label := 'Digital services / domains & hosting';
      v_category := 'office';
      v_debit := '6200';
    else
      raise exception 'Unsupported manual operating expense category %.',p_source_id;
  end case;

  v_liability := case when p_funding_source='founder_personal' then '2400' else '2000' end;

  insert into vyndi_people_office_actual_expenditures(
    id,source_type,source_id,source_label,source_category,plan_month,incurred_on,description,
    amount_inr,debit_account_code,liability_account_code,lifecycle_status,source_reference,notes,
    funding_source,created_by)
  values(
    p_id,'manual_expense',p_source_id,v_label,v_category,p_plan_month,p_incurred_on,trim(p_description),
    round(p_amount_inr,2),v_debit,v_liability,'draft',trim(p_source_reference),coalesce(p_notes,''),
    p_funding_source,p_actor_user_id
  );

  insert into vyndi_audit_events(
    id,entity_type,entity_id,action,actor_user_id,actor_role,source_reference,payload_json)
  values(
    'AUD-'||p_id||'-DRAFT','people_office_actual_expenditure',p_id,'manual_expense_draft_created',
    p_actor_user_id,p_actor_role,p_source_reference,
    jsonb_build_object(
      'sourceType','manual_expense',
      'sourceId',p_source_id,
      'sourceLabel',v_label,
      'accrualPlanMonth',p_plan_month,
      'amountInr',round(p_amount_inr,2),
      'debitAccount',v_debit,
      'liabilityAccount',v_liability,
      'fundingSource',p_funding_source,
      'companyCashMoved',false
    )
  );

  return p_id;
end;
$$;

create or replace function approve_vyndi_people_office_actual_expenditure_v3(
  p_id text,
  p_actor_user_id text,
  p_actor_role text,
  p_sole_operator_self_approval boolean
) returns text
language plpgsql
as $$
declare
  v_row vyndi_people_office_actual_expenditures%rowtype;
begin
  select * into v_row
    from vyndi_people_office_actual_expenditures
   where id=p_id;

  if not found then
    raise exception 'Expense & Reimbursement Register expenditure not found.';
  end if;

  if v_row.source_type='manual_expense' then
    if v_row.source_id<>'digital_services'
       or v_row.source_label<>'Digital services / domains & hosting'
       or v_row.source_category<>'office'
       or v_row.debit_account_code<>'6200' then
      raise exception 'Manual operating expense accounting classification is not controlled.';
    end if;
  end if;

  return approve_vyndi_people_office_actual_expenditure_v2(
    p_id,p_actor_user_id,p_actor_role,p_sole_operator_self_approval
  );
end;
$$;

comment on function create_vyndi_people_office_actual_expenditure_v3(
  text,text,text,integer,date,text,numeric,text,text,text,text,text
) is
  'Creates controlled actual expenditure drafts. manual_expense/digital_services posts to account 6200 on approval and requires evidence.';

comment on function approve_vyndi_people_office_actual_expenditure_v3(
  text,text,text,boolean
) is
  'Revalidates controlled manual-expense classification before delegating to governed approval/accrual.';
