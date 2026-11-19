/** A01 P0 stop-gap: legacy inventory / ATP and shortage source views aggregate
 * across ventures, so NEVER describe those combined records as isolated
 * business evidence when more than one inventory venture exists.
 *
 * This is NOT a production tenant-selection or authorization primitive. It
 * only fails closed while the per-venture source schema remains unqualified.
 * Keep all existing A01 SOURCE_UNVERIFIED and write-denial flags unchanged.
 */
export const A01_SINGLE_VENTURE_GUARD_CTE = `
venture_guard AS MATERIALIZED (
  SELECT count(*)::integer AS venture_count
  FROM (
    SELECT venture FROM public.epr_inventory_ledger
    UNION
    SELECT venture FROM public.epr_inventory_cost_ledger
    LIMIT 2
  ) distinct_ventures
)
`;

/** Accept only the one-venture case, never coerce unknown SQL payloads. */
export function assertSingleVentureSource(value:unknown):void{
  if(value!==1)throw Error('VYNDI_ONTOLOGY_VENTURE_SCOPE_UNVERIFIED');
}
