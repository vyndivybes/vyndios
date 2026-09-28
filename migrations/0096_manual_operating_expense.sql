-- Controlled manual operating expenses, third-party-funded expenditure,
-- third-party reimbursements, and external support / expense assistance receipts.
-- Uncertain external support is kept in account 2460 External Support Clearing,
-- never auto-classified as sales or other income.

alter table vyndi_people_office_actual_expenditures
  add column if not exists third_party_payer_name text;

alter table vyndi_people_office_actual_expenditures
  add column if not exists third_party_payer_type text;

alter table vyndi_people_office_actual_expenditures
  add column if not exists third_party_repayment_status text;

alter table vyndi_people_office_actual_expenditures
  drop constraint if exists vyndi_people_office_actual_expenditures_source_type_check;

alter table vyndi_people_office_actual_expenditures
  add constraint vyndi_people_office_actual_expenditures_source_type_check
  check (source_type in ('cost_item','asset','manual_expense'));

alter table vyndi_people_office_actual_expenditures
  drop constraint if exists vyndi_people_office_actual_funding_source_check;

alter table vyndi_people_office_actual_expenditures
  add constraint vyndi_people_office_actual_funding_source_check
  check (funding_source in ('company_bank','founder_personal','third_party'));

alter table vyndi_people_office_actual_expenditures
  drop constraint if exists vyndi_people_office_third_party_details_check;

alter table vyndi_people_office_actual_expenditures
  add constraint vyndi_people_office_third_party_details_check
  check (
    funding_source <> 'third_party'
    or (
      trim(coalesce(third_party_payer_name,'')) <> ''
      and third_party_payer_type in ('employee','director','consultant','friend','family','supplier','other')
      and third_party_repayment_status in ('required','not_required','undecided')
    )
  );

alter table vyndi_people_office_actual_expenditures
  drop constraint if exists vyndi_people_office_manual_expense_accounting_check;

alter table vyndi_people_office_actual_expenditures
  add constraint vyndi_people_office_manual_expense_accounting_check
  check (
    source_type <> 'manual_expense'
    or (
      source_id in (
        'office_facility',
        'digital_services',
        'travel_business_dev',
        'professional_statutory',
        'outsourcing_external',
        'manufacturing_overhead',
        'finance_cost'
      )
      and source_label = case source_id
        when 'office_facility' then 'Office / facility / utilities'
        when 'digital_services' then 'Digital services / domains & hosting'
        when 'travel_business_dev' then 'Travel / business development'
        when 'professional_statutory' then 'Professional / statutory'
        when 'outsourcing_external' then 'Outsourcing / external services'
        when 'manufacturing_overhead' then 'Manufacturing overhead / consumables'
        when 'finance_cost' then 'Finance cost / bank charges'
      end
      and source_category = case source_id
        when 'office_facility' then 'office'
        when 'digital_services' then 'office'
        when 'travel_business_dev' then 'travel'
        when 'professional_statutory' then 'professional_statutory'
        when 'outsourcing_external' then 'outsourcing'
        when 'manufacturing_overhead' then 'manufacturing_overhead'
        when 'finance_cost' then 'finance_cost'
      end
      and debit_account_code = case source_id
        when 'office_facility' then '6200'
        when 'digital_services' then '6200'
        when 'travel_business_dev' then '6250'
        when 'professional_statutory' then '6300'
        when 'outsourcing_external' then '6400'
        when 'manufacturing_overhead' then '5200'
        when 'finance_cost' then '6600'
      end
      and liability_account_code = case
        when funding_source='company_bank' then '2000'
        when funding_source='founder_personal' then '2400'
        when funding_source='third_party' and third_party_repayment_status='required' then '2450'
        when funding_source='third_party' and third_party_repayment_status in ('not_required','undecided') then '2460'
      end
    )
  );

create table if not exists vyndi_third_party_reimbursements (
  id text primary key,
  expenditure_id text not null references vyndi_people_office_actual_expenditures(id) on delete restrict,
  plan_month integer not null check (plan_month between 1 and 36),
  reimbursed_on date not null,
  amount_inr numeric(18,2) not null check (amount_inr > 0),
  evidence_reference text not null unique,
  journal_id text not null unique,
  actual_revision integer not null check (actual_revision > 0),
  new_closing_cash_lakh numeric(18,4) not null,
  created_by text not null,
  created_at timestamptz not null default now()
);

create index if not exists vyndi_third_party_reimbursement_idx
  on vyndi_third_party_reimbursements(expenditure_id,plan_month,reimbursed_on,created_at);

create table if not exists vyndi_external_support_receipts (
  id text primary key,
  received_from text not null,
  sender_type text not null
    check (sender_type in ('employee','director','consultant','friend','family','supplier','other')),
  received_on date not null,
  amount_inr numeric(18,2) not null check (amount_inr > 0),
  received_into text not null
    check (received_into in ('company_bank','founder_personal','vendor_direct')),
  plan_month integer not null check (plan_month between 1 and 36),
  related_expenditure_id text references vyndi_people_office_actual_expenditures(id) on delete restrict,
  purpose text not null,
  repayment_status text not null
    check (repayment_status in ('required','not_required','undecided')),
  evidence_reference text not null unique,
  notes text not null default '',
  accounting_status text not null
    check (accounting_status in ('repayable','pending_classification')),
  liability_account_code text not null
    check (liability_account_code in ('2450','2460')),
  journal_id text unique,
  actual_revision integer check (actual_revision is null or actual_revision > 0),
  new_closing_cash_lakh numeric(18,4),
  created_by text not null,
  created_at timestamptz not null default now(),
  check (
    (repayment_status='required' and liability_account_code='2450')
    or
    (repayment_status in ('not_required','undecided') and liability_account_code='2460')
  ),
  check (
    received_into <> 'company_bank'
    or (journal_id is not null and actual_revision is not null and new_closing_cash_lakh is not null)
  )
);

create index if not exists vyndi_external_support_receipts_idx
  on vyndi_external_support_receipts(received_on desc,repayment_status,received_into,created_at desc);

create or replace view vyndi_people_office_actual_spend_authority as
select e.id,e.source_type,e.source_id,e.source_label,e.source_category,e.plan_month,e.incurred_on,
       e.description,e.amount_inr,e.debit_account_code,e.liability_account_code,e.lifecycle_status,
       e.source_reference,e.notes,e.obligation_journal_id,e.created_by,e.submitted_by,e.submitted_at,
       e.approved_by,e.approved_at,e.created_at,e.updated_at,
       (case
          when e.funding_source='founder_personal' then coalesce(r.amount_reimbursed_inr,0)
          when e.funding_source='third_party' and e.third_party_repayment_status='required' then coalesce(t.amount_reimbursed_inr,0)
          when e.funding_source='third_party' then 0
          else coalesce(p.amount_paid_inr,0)
        end)::numeric(18,2) as amount_paid_inr,
       greatest(
         e.amount_inr-
         case
           when e.funding_source='founder_personal' then coalesce(r.amount_reimbursed_inr,0)
           when e.funding_source='third_party' and e.third_party_repayment_status='required' then coalesce(t.amount_reimbursed_inr,0)
           when e.funding_source='third_party' then 0
           else coalesce(p.amount_paid_inr,0)
         end,
         0
       )::numeric(18,2) as amount_open_inr,
       case
         when e.funding_source='founder_personal' then r.last_reimbursed_on
         when e.funding_source='third_party' then t.last_reimbursed_on
         else p.last_paid_on
       end as last_paid_on,
       case
         when e.funding_source='founder_personal' then r.last_reimbursement_plan_month
         when e.funding_source='third_party' then t.last_reimbursement_plan_month
         else p.last_payment_plan_month
       end as last_payment_plan_month,
       e.funding_source,
       e.governance_marker,
       coalesce(r.amount_reimbursed_inr,0)::numeric(18,2) as amount_reimbursed_inr,
       coalesce(t.amount_reimbursed_inr,0)::numeric(18,2) as third_party_amount_reimbursed_inr,
       e.third_party_payer_name,
       e.third_party_payer_type,
       e.third_party_repayment_status
  from vyndi_people_office_actual_expenditures e
  left join (
    select expenditure_id,sum(amount_inr) as amount_paid_inr,max(paid_on) as last_paid_on,
           max(plan_month) as last_payment_plan_month
      from vyndi_people_office_actual_payments
     group by expenditure_id
  ) p on p.expenditure_id=e.id
  left join (
    select expenditure_id,sum(amount_inr) as amount_reimbursed_inr,max(reimbursed_on) as last_reimbursed_on,
           max(plan_month) as last_reimbursement_plan_month
      from vyndi_founder_reimbursements
     group by expenditure_id
  ) r on r.expenditure_id=e.id
  left join (
    select expenditure_id,sum(amount_inr) as amount_reimbursed_inr,max(reimbursed_on) as last_reimbursed_on,
           max(plan_month) as last_reimbursement_plan_month
      from vyndi_third_party_reimbursements
     group by expenditure_id
  ) t on t.expenditure_id=e.id;
