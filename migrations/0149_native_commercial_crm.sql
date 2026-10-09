-- Native Commercial CRM; canonical sales commitments remain in vyndi_sales_orders.
-- Additive only. Apply by the governed release:migrate path after backup approval.
create table if not exists vyndi_crm_customers (
  id text primary key check (length(id) between 5 and 100),
  revision integer not null default 1 check (revision > 0),
  kind text not null check (kind in ('person','company')),
  name text not null check (length(btrim(name)) between 2 and 200),
  primary_contact text not null default '',
  email text not null default '',
  phone text not null default '',
  city text not null default '',
  segment text not null check (segment in ('retail','dealer','distributor','partner')),
  lifecycle text not null default 'prospect' check (lifecycle in ('prospect','active','inactive')),
  created_by text not null,
  updated_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists vyndi_crm_customers_name_idx on vyndi_crm_customers (lower(name));
create index if not exists vyndi_crm_customers_lifecycle_idx on vyndi_crm_customers (lifecycle,updated_at desc);

-- Existing order status and order amount remain authoritative; there is no CRM shadow opportunity.
create table if not exists vyndi_crm_order_links (
  sales_order_id text primary key references vyndi_sales_orders(id) on delete restrict,
  customer_id text not null references vyndi_crm_customers(id) on delete restrict,
  linked_by text not null,
  linked_at timestamptz not null default now()
);
create index if not exists vyndi_crm_order_links_customer_idx on vyndi_crm_order_links (customer_id,linked_at desc);

-- Engagement and follow-ups are CRM-owned; they never post revenue or change order state.
create table if not exists vyndi_crm_activities (
  id text primary key check (length(id) between 5 and 100),
  customer_id text not null references vyndi_crm_customers(id) on delete restrict,
  kind text not null check (kind in ('note','call','email','meeting','followup')),
  summary text not null check (length(btrim(summary)) between 2 and 2000),
  due_on date,
  completed_at timestamptz,
  created_by text not null,
  created_at timestamptz not null default now(),
  completed_by text,
  constraint vyndi_crm_due_only_followup check (due_on is null or kind = 'followup'),
  constraint vyndi_crm_complete_only_followup check (completed_at is null or kind = 'followup')
);
create index if not exists vyndi_crm_activities_customer_idx on vyndi_crm_activities (customer_id,created_at desc);
create index if not exists vyndi_crm_followup_open_idx on vyndi_crm_activities (due_on) where kind='followup' and completed_at is null;
