-- Prepare derived finance summary view for an expanded statutory column shape.
-- PostgreSQL CREATE OR REPLACE VIEW cannot insert/rename columns in the middle of
-- an existing view definition, so replace the derived view explicitly.
drop view if exists epr_finance_control_summary;
