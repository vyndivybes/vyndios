/**
 * P0 guard for legacy Master Inventory reads/physical movement writers.
 *
 * Global vyndi_inventory_balance / available_to_promise aggregate solely by
 * SKU and canonical unit. They are NOT venture-isolated; overlapping SKU
 * across ventures makes positive stock/ATP figures unsafe.
 *
 * This is a negative control, NOT a tenant selector or source-certification
 * mechanism. Even one observed venture is not proof of actor/company ownership,
 * source completeness, physical provenance or any business-write authority.
 */
export const INVENTORY_SCOPE_SQL = `
  with observed_ventures as (
    select venture from public.epr_inventory_ledger
    union all
    select venture from public.epr_inventory_cost_ledger
  ),
  distinct_ventures as (
    select venture from observed_ventures group by venture limit 2
  )
  select count(*)::integer as venture_count,
         count(*) filter (where venture is null)::integer as unscoped_venture_count
    from distinct_ventures
`;

const SCOPE_HOLD = 'VYNDI_INVENTORY_VENTURE_SCOPE_HOLD: Legacy stock/ATP combines or cannot attribute inventory ventures. Physical stock actions and stock summaries are unavailable until owner/source lineage is independently reconciled. Internal planning and draft preparation remain available.';

/**
 * @param {import('./db').Sql} sql
 * @returns {Promise<Readonly<{ventureCount:1,sourceAuthorityCertified:false,productionWriteAuthorized:false}>>}
 */
export async function requireSingleVentureInventorySource(sql) {
  const rows=await sql.query(INVENTORY_SCOPE_SQL);
  const count=rows?.[0]?.venture_count;
  const nullCount=rows?.[0]?.unscoped_venture_count;
  if(count!==1||nullCount!==0) throw new Error(SCOPE_HOLD);
  return Object.freeze({
    ventureCount:1,
    sourceAuthorityCertified:false,
    productionWriteAuthorized:false,
  });
}
