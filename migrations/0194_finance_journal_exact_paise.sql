-- Canonical posting admission only. Does not rewrite historical journals or grant approval.
create or replace function post_vyndi_finance_journal(
  p_id text,p_entry_date date,p_source_type text,p_source_id text,p_description text,p_lines jsonb
) returns text language plpgsql as $$
declare
  v_debit numeric:=0; v_credit numeric:=0; v_line jsonb; v_no integer:=0;
  v_d numeric; v_c numeric; v_existing epr_finance_journals%rowtype;
  v_normalized jsonb:='[]'::jsonb; v_existing_lines jsonb;
begin
  if trim(coalesce(p_id,''))='' or trim(coalesce(p_source_type,''))='' or trim(coalesce(p_source_id,''))='' or p_entry_date is null then
    raise exception 'Finance journal ID, date and source references are required.';
  end if;
  if p_lines is null or jsonb_typeof(p_lines)<>'array' then raise exception 'Finance journal requires at least two lines.'; end if;
  if jsonb_array_length(p_lines)<2 then raise exception 'Finance journal requires at least two lines.'; end if;
  for v_line in select value from jsonb_array_elements(p_lines) loop
    if jsonb_typeof(v_line)<>'object' or jsonb_typeof(v_line->'accountCode') is distinct from 'string'
      or trim(coalesce(v_line->>'accountCode',''))='' then raise exception 'Finance journal account is required.'; end if;
    if coalesce(jsonb_typeof(v_line->'debitInr'),'null') not in ('number','null')
      or coalesce(jsonb_typeof(v_line->'creditInr'),'null') not in ('number','null') then raise exception 'Invalid finance journal amount.'; end if;
    v_d:=coalesce((v_line->>'debitInr')::numeric,0);
    v_c:=coalesce((v_line->>'creditInr')::numeric,0);
    if v_d<0 or v_c<0 or v_d<>round(v_d,2) or v_c<>round(v_c,2)
      or v_d*100>9007199254740991 or v_c*100>9007199254740991 then raise exception 'Invalid finance journal amount; safe nonnegative paise required.'; end if;
    if (v_d>0 and v_c>0) or (v_d=0 and v_c=0) then raise exception 'Finance journal line must contain exactly one debit or credit amount.'; end if;
    v_debit:=v_debit+v_d; v_credit:=v_credit+v_c;
    v_normalized:=v_normalized||jsonb_build_array(jsonb_build_object('accountCode',trim(v_line->>'accountCode'),
      'debitInr',v_d,'creditInr',v_c,'memo',coalesce(v_line->>'memo','')));
  end loop;
  if v_debit*100>9007199254740991 or v_credit*100>9007199254740991 then raise exception 'Invalid finance journal total amount; unsafe paise.'; end if;
  if v_debit<>v_credit then raise exception 'Finance journal is not balanced: debit %, credit %.',v_debit,v_credit; end if;
  perform pg_advisory_xact_lock(hashtext('finance-journal|'||p_source_type||'|'||p_source_id)::bigint);
  select * into v_existing from epr_finance_journals
    where source_type=p_source_type and source_id=p_source_id and status='posted' limit 1;
  if found then
    select jsonb_agg(jsonb_build_object('accountCode',account_code,'debitInr',debit_inr,'creditInr',credit_inr,'memo',memo) order by line_no)
      into v_existing_lines from epr_finance_journal_lines where journal_id=v_existing.id;
    if v_existing.entry_date<>p_entry_date or v_existing.description<>coalesce(p_description,'') or v_existing_lines is distinct from v_normalized then
      raise exception 'Finance journal source already exists with different content.';
    end if;
    return v_existing.id;
  end if;
  insert into epr_finance_journals(id,entry_date,source_type,source_id,description,status,posted_at)
    values(p_id,p_entry_date,p_source_type,p_source_id,coalesce(p_description,''),'posted',now());
  for v_line in select value from jsonb_array_elements(v_normalized) loop
    v_no:=v_no+1;
    insert into epr_finance_journal_lines(journal_id,line_no,account_code,debit_inr,credit_inr,memo)
      values(p_id,v_no,v_line->>'accountCode',(v_line->>'debitInr')::numeric,(v_line->>'creditInr')::numeric,v_line->>'memo');
  end loop;
  return p_id;
end;
$$;
