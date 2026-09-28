-- Manual operating-expense entry authority.
-- Enables evidenced unplanned/manual operating costs without fabricating a People & Office plan item.
-- Initial controlled category: digital services / domains & hosting -> account 6200.

alter table vyndi_people_office_actual_expenditures
  drop constraint if exists vyndi_people_office_actual_expenditures_source_type_check;

alter table vyndi_people_office_actual_expenditures
  add constraint vyndi_people_office_actual_expenditures_source_type_check
  check (source_type in ('cost_item','asset','manual_expense'));

alter table vyndi_people_office_actual_expenditures
  drop constraint if exists vyndi_people_office_manual_expense_accounting_check;

alter table vyndi_people_office_actual_expenditures
  add constraint vyndi_people_office_manual_expense_accounting_check
  check (
    source_type <> 'manual_expense'
    or (
      source_id='digital_services'
      and source_label='Digital services / domains & hosting'
      and source_category='office'
      and debit_account_code='6200'
      and (
        (funding_source='company_bank' and liability_account_code='2000')
        or
        (funding_source='founder_personal' and liability_account_code='2400')
      )
    )
  );

comment on constraint vyndi_people_office_manual_expense_accounting_check
  on vyndi_people_office_actual_expenditures is
  'Manual operating expense is currently restricted to Digital services / domains & hosting mapped to Dr 6200; liability follows company-bank or founder-personal funding.';
