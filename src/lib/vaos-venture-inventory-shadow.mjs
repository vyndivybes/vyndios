/**
 * A01 read-only accounting shadow. This module is NOT wired into the signed
 * VAOS bridge: no authenticated tenant principal or source-record tenant
 * lineage has been commissioned. No stock/ATP/PO/shortage authorization.
 *
 * Legacy vyndi_inventory_balance joins SKU+unit across different ventures.
 * This independent query joins BOTH ledgers by venture+SKU+canonical unit.
 * Cost-only and quantity-only rows are retained as audit exceptions.
 * An MVCC token is not a committed business revision or CDC.
 */
export const VYNDI_VENTURE_INVENTORY_SHADOW_SQL = `
WITH quantity AS MATERIALIZED (
  SELECT l.venture,l.sku,public.vyndi_canonical_unit(l.unit) AS unit,
    sum(l.quantity_delta) AS quantity_balance,
    min(l.created_at) AS first_movement_at,
    max(l.created_at) AS last_movement_at
  FROM public.epr_inventory_ledger l
  GROUP BY l.venture,l.sku,public.vyndi_canonical_unit(l.unit)
), valuation AS MATERIALIZED (
  SELECT c.venture,c.sku,public.vyndi_canonical_unit(c.unit) AS unit,
    sum(c.value_delta_inr) AS inventory_value_inr
  FROM public.epr_inventory_cost_ledger c
  GROUP BY c.venture,c.sku,public.vyndi_canonical_unit(c.unit)
), isolated AS MATERIALIZED (
  SELECT coalesce(q.venture,v.venture) AS venture,
    coalesce(q.sku,v.sku) AS sku,
    coalesce(q.unit,v.unit) AS unit,
    q.quantity_balance,v.inventory_value_inr,
    (q.venture IS NOT NULL) AS quantity_observed,
    (v.venture IS NOT NULL) AS value_observed,
    q.first_movement_at,q.last_movement_at
  FROM quantity q FULL OUTER JOIN valuation v
    ON q.venture=v.venture AND q.sku=v.sku AND q.unit=v.unit
), page AS (
  SELECT * FROM isolated ORDER BY venture,sku,unit LIMIT $1
)
SELECT (SELECT count(*)::integer FROM isolated) AS source_count,
  (SELECT count(DISTINCT venture)::integer FROM isolated) AS venture_count,
  (SELECT count(*)::integer FROM isolated
    WHERE NOT quantity_observed OR NOT value_observed) AS unpaired_count,
  (SELECT count(*)::integer FROM isolated
    WHERE quantity_balance < 0) AS negative_count,
  (SELECT count(*)::integer FROM isolated
    WHERE venture IS NULL OR btrim(venture) = ''
       OR sku IS NULL OR btrim(sku) = ''
       OR unit IS NULL OR btrim(unit) = '') AS invalid_identity_count,
  (SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY p.venture,p.sku,p.unit),'[]'::jsonb)
    FROM page p) AS records,
  pg_current_snapshot()::text AS source_mvcc_snapshot,
  transaction_timestamp() AS extracted_at`;

/** @param {unknown} value */
function safeCount(value) {
  const n=Number(value);
  if (!Number.isSafeInteger(n) || n<0) throw new Error('SHADOW_SOURCE_COUNT_INVALID');
  return n;
}

/** @typedef {{source_count:number,venture_count:number,unpaired_count:number,
 * unpaired_count:number,negative_count:number,invalid_identity_count:number,
 * records:Array<Record<string,unknown>>}} ShadowSqlRow */
/** @typedef {{query:(sql:string,params:number[])=>Promise<ShadowSqlRow[]>}} ShadowSql */
/**
 * Internal evidence only; a caller-supplied venture is NEVER tenant authority.
 * @param {{sql?:ShadowSql,limit?:number,venture?:string,tenantId?:string,principal?:string}} options
 */
export async function readVentureInventoryShadow(options={}) {
  if (Object.hasOwn(options,'venture') || Object.hasOwn(options,'tenantId') || Object.hasOwn(options,'principal')) {
    throw new Error('SHADOW_TENANT_SCOPE_FORBIDDEN');
  }
  const {sql,limit=50}=options;
  if (!Number.isInteger(limit) || limit<1 || limit>100) throw new Error('SHADOW_PAGE_LIMIT_INVALID');
  if (!sql || typeof sql.query!=='function') throw new Error('SHADOW_SQL_PORT_REQUIRED');
  const rows=await sql.query(VYNDI_VENTURE_INVENTORY_SHADOW_SQL,[limit]);
  if (!Array.isArray(rows) || rows.length!==1 || !rows[0]) throw new Error('SHADOW_SOURCE_INVALID');
  const row=rows[0];
  const sourceCount=safeCount(row.source_count);
  const ventureCount=safeCount(row.venture_count);
  const unpairedCount=safeCount(row.unpaired_count);
  const negativeCount=safeCount(row.negative_count);
  const invalidIdentityCount=safeCount(row.invalid_identity_count);
  if (!Array.isArray(row.records) || row.records.length>limit || row.records.length>sourceCount ||
      (sourceCount>0 && row.records.length===0)) throw new Error('SHADOW_SOURCE_INVALID');
  const holdReasons=['CROSS_VENTURE_TENANT_MAPPING_UNVERIFIED'];
  if (!sourceCount || !ventureCount) holdReasons.push('EMPTY_OR_UNKNOWN_VENTURE_SOURCE');
  if (unpairedCount) holdReasons.push('UNPAIRED_STOCK_LEDGER');
  if (negativeCount) holdReasons.push('NEGATIVE_PHYSICAL_STOCK');
  if (invalidIdentityCount) holdReasons.push('INVALID_SOURCE_IDENTITY');
  if (sourceCount>row.records.length) holdReasons.push('PAGINATION_REVISION_UNVERIFIED');
  return Object.freeze({
    status:'HOLD',readOnly:true,businessWritesAuthorized:false,
    availableToPromiseAuthorized:false,tenantIdentityVerified:false,
    sourceCompletenessVerified:false,sourceRevisionAuthority:'UNVERIFIED_SQL_SNAPSHOT_ONLY',
    sourceCount,ventureCount,unpairedCount,negativeCount,invalidIdentityCount,
    hasMore:sourceCount>row.records.length,holdReasons:Object.freeze(holdReasons),
    records:row.records,
  });
}
