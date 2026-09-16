-- Prepare derived statutory views for the additional unverified-ITC column.
-- These are read models only; base accounting/tax records are not dropped.
drop view if exists epr_finance_control_summary;
drop view if exists epr_finance_ca_readiness;
drop view if exists epr_finance_gst_period_summary;
