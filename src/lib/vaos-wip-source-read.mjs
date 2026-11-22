/**
 * Signed VAOS production-WIP read safety contract.
 *
 * A cancelled historical job may still own a live traveller or consumed stock.
 * Those records are unresolved simulation/physical provenance, not qualified
 * active WIP. Use ONE SQL snapshot to detect both exceptions and read eligible
 * parent jobs. Refuse the entire observation until independent disposition.
 */
export const VAOS_WIP_ATOMIC_SOURCE_SQL = `
WITH eligible AS MATERIALIZED (
 SELECT to_jsonb(j) AS record
 FROM public.epr_production_job_cards j
 WHERE j.status IN ('released','in_progress')
 ORDER BY j.created_at DESC
 LIMIT $1
)
SELECT
 COALESCE((SELECT jsonb_agg(e.record) FROM eligible e),'[]'::jsonb) AS records,
 EXISTS (
  SELECT 1 FROM public.epr_production_job_cards c
  JOIN public.epr_travellers t ON t.job_card_id=c.id
  WHERE c.status='cancelled' AND t.status IN ('released','in_build','completed')
 ) AS active_cancelled_traveller,
 EXISTS (
  SELECT 1 FROM public.epr_production_job_cards c
  JOIN public.epr_inventory_reservations r ON r.job_card_id=c.id
  WHERE c.status='cancelled' AND r.status='consumed'
 ) AS consumed_cancelled_reservation
`;

export function assertVaosWipSource(row){
 if(!row || typeof row!=='object'
  ||!Array.isArray(row.records)
  ||typeof row.active_cancelled_traveller!=='boolean'
  ||typeof row.consumed_cancelled_reservation!=='boolean')
  throw Error('VYNDI_WIP_SOURCE_INVALID');
 if(row.active_cancelled_traveller || row.consumed_cancelled_reservation)
  throw Error('VYNDI_WIP_CANCELLED_LINEAGE_UNRECONCILED');
 return {records:row.records};
}
