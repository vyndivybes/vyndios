/** One snapshot and one request-bound connection for the cold-entry registers. */
export const QUALITY_REGISTER_QUERY = `
select
  coalesce((select jsonb_agg(r) from
    (select * from vyndi_quality_inspections order by recorded_at desc limit 500) r), '[]'::jsonb) as inspections,
  coalesce((select jsonb_agg(r) from
    (select * from vyndi_quality_ncrs order by updated_at desc limit 500) r), '[]'::jsonb) as ncrs,
  coalesce((select jsonb_agg(r) from
    (select * from vyndi_quality_capas order by updated_at desc limit 500) r), '[]'::jsonb) as capas,
  coalesce((select jsonb_agg(r) from
    (select * from vyndi_quality_releases where superseded_at is null order by decided_at desc limit 500) r), '[]'::jsonb) as releases,
  (select count(*)::int from epr_ncr_capa where status not in ('closed','rejected')) as epr_open
`;
