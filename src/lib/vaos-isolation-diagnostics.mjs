/**
 * Founder-facing A01 diagnostic over signed VYNDI bridge. Read-only aggregates:
 * venture is an INTERNAL stock category, not a verified legal company/tenant.
 * Neither this diagnostic nor its counts establish PO, ATP or source authority.
 */
import {readVentureInventoryShadow} from './vaos-venture-inventory-shadow.mjs';

export const VYNDI_SOURCE_LINEAGE_DIAGNOSTIC_SQL = `
WITH venture_keys AS MATERIALIZED (
  SELECT venture,sku,public.vyndi_canonical_unit(unit) AS unit
    FROM public.epr_inventory_ledger
  UNION
  SELECT venture,sku,public.vyndi_canonical_unit(unit) AS unit
    FROM public.epr_inventory_cost_ledger
), collisions AS MATERIALIZED (
  SELECT sku,unit FROM venture_keys
  GROUP BY sku,unit HAVING count(DISTINCT venture)>1
), jobs AS MATERIALIZED (
  SELECT j.id,(
    SELECT count(DISTINCT NULLIF(btrim(t.venture),''))
    FROM public.epr_travellers t WHERE t.job_card_id=j.id
  ) AS internal_venture_count
  FROM public.epr_production_job_cards j
), reservations AS MATERIALIZED (
  SELECT r.id,
    (j.id IS NOT NULL AND l.id IS NOT NULL AND s.id IS NOT NULL
     AND j.id=r.job_card_id AND l.id=r.job_card_line_id AND s.id=r.sales_order_id
     AND l.job_card_id=j.id AND j.sales_order_id=s.id
     AND j.sales_order_revision=s.revision AND r.sales_order_revision=s.revision
     AND l.sku=r.sku
     AND public.vyndi_canonical_unit(l.unit)=public.vyndi_canonical_unit(r.unit)
    ) IS TRUE AS valid_parent_chain
  FROM public.epr_inventory_reservations r
  LEFT JOIN public.epr_production_job_cards j ON j.id=r.job_card_id
  LEFT JOIN public.epr_production_job_card_lines l ON l.id=r.job_card_line_id
  LEFT JOIN public.vyndi_sales_orders s ON s.id=r.sales_order_id
), purchase_orders AS MATERIALIZED (
  SELECT p.id,
    (p.job_card_id IS NOT NULL AND j.id IS NOT NULL AND s.id IS NOT NULL
     AND p.job_card_id=j.id AND j.sales_order_id=s.id
     AND j.sales_order_revision=s.revision
    ) IS TRUE AS valid_parent_chain
  FROM public.vyndi_purchase_orders p
  LEFT JOIN public.epr_production_job_cards j ON j.id=p.job_card_id
  LEFT JOIN public.vyndi_sales_orders s ON s.id=j.sales_order_id
)
SELECT (SELECT count(*)::integer FROM collisions) AS overlapping_key_groups,
       (SELECT count(*)::integer FROM jobs) AS job_cards_total,
       (SELECT count(*)::integer FROM jobs WHERE internal_venture_count=0)
         AS jobs_without_traveller_venture,
       (SELECT count(*)::integer FROM jobs WHERE internal_venture_count>1)
         AS ambiguous_job_venture_count,
       (SELECT count(*)::integer FROM reservations) AS reservations_total,
       (SELECT count(*)::integer FROM reservations WHERE NOT valid_parent_chain)
         AS reservations_with_broken_lineage,
       (SELECT count(*)::integer FROM purchase_orders) AS purchase_orders_total,
       (SELECT count(*)::integer FROM purchase_orders WHERE NOT valid_parent_chain)
         AS purchase_orders_with_broken_lineage`;

/** @param {unknown} value */
function count(value) {
 if(typeof value!=='number' && !(typeof value==='string' && /^[0-9]+$/.test(value)))
   throw new Error('ISOLATION_AGGREGATE_INVALID');
 const n=Number(value);
 if(!Number.isSafeInteger(n)||n<0)throw new Error('ISOLATION_AGGREGATE_INVALID');
 return n;
}

/** @typedef {{
 * overlapping_key_groups:number|string,job_cards_total:number|string,
 * jobs_without_traveller_venture:number|string,ambiguous_job_venture_count:number|string,
 * reservations_total:number|string,reservations_with_broken_lineage:number|string,
 * purchase_orders_total:number|string,purchase_orders_with_broken_lineage:number|string
 * }} LineageSqlRow */
/** @typedef {import('./db').Sql} LineageSql */
/**
 * Diagnostic only: no tenant selectors, no user-supplied scope, no DB mutation.
 * The two SQL statements do not share a committed snapshot or a revision.
 * @param {{sql?:LineageSql}} options
 */
export async function readVaosIsolationDiagnostics(options={}) {
 if(!options||typeof options!=='object'||Object.keys(options).some(k=>k!=='sql'))
   throw new Error('ISOLATION_SCOPE_FORBIDDEN');
 const {sql}=options;
 if(!sql||typeof sql.query!=='function')throw new Error('ISOLATION_SQL_PORT_REQUIRED');
 const shadow=await readVentureInventoryShadow({sql,limit:100});
 const rows=await sql.query(VYNDI_SOURCE_LINEAGE_DIAGNOSTIC_SQL);
 if(!Array.isArray(rows)||rows.length!==1||!rows[0])
   throw new Error('ISOLATION_AGGREGATE_INVALID');
 const row=rows[0];
 const overlappingKeyGroups=count(row.overlapping_key_groups);
 const jobCardsTotal=count(row.job_cards_total);
 const jobCardsWithoutTravellerVenture=count(row.jobs_without_traveller_venture);
 const ambiguousJobVentureCount=count(row.ambiguous_job_venture_count);
 const reservationsTotal=count(row.reservations_total);
 const reservationsWithBrokenLineage=count(row.reservations_with_broken_lineage);
 const purchaseOrdersTotal=count(row.purchase_orders_total);
 const purchaseOrdersWithBrokenLineage=count(row.purchase_orders_with_broken_lineage);
 if(jobCardsWithoutTravellerVenture+ambiguousJobVentureCount>jobCardsTotal||
   reservationsWithBrokenLineage>reservationsTotal||
   purchaseOrdersWithBrokenLineage>purchaseOrdersTotal)
   throw new Error('ISOLATION_AGGREGATE_INVALID');
 const holds=new Set([
  'LEGAL_TENANT_MEMBERSHIP_UNVERIFIED',
  'BUSINESS_OWNER_ATTRIBUTION_UNVERIFIED',
  'SOURCE_REVISION_AND_ATTESTATION_UNVERIFIED',
  'MULTI_STATEMENT_SNAPSHOT_NOT_ATOMIC',
 ]);
 if(overlappingKeyGroups)holds.add('CROSS_VENTURE_SKU_COLLISION');
 if(shadow.negativeCount)holds.add('NEGATIVE_PHYSICAL_STOCK');
 if(shadow.unpairedCount)holds.add('UNPAIRED_INVENTORY_AND_COST');
 if(shadow.invalidIdentityCount)holds.add('STOCK_IDENTITY_INVALID');
 if(shadow.hasMore)holds.add('INVENTORY_PAGE_INCOMPLETE');
 if(jobCardsWithoutTravellerVenture||ambiguousJobVentureCount)holds.add('JOB_VENTURE_LINEAGE_INCOMPLETE');
 if(reservationsWithBrokenLineage)holds.add('RESERVATION_PARENT_REVISION_UNVERIFIED');
 if(purchaseOrdersWithBrokenLineage)holds.add('PO_PARENT_REVISION_UNVERIFIED');
 return Object.freeze({
  schemaVersion:'VYNDI_A01_ISOLATION_DIAGNOSTIC_V1',
  status:'HOLD',
  readOnly:true,
  sourceCompletenessVerified:false,
  tenantIdentityVerified:false,
  availableToPromiseAuthorized:false,
  businessWritesAuthorized:false,
  productionWriteAuthorized:false,
  sourceRevisionAuthority:'UNVERIFIED_MULTISTATEMENT_AUDIT',
  inventory:Object.freeze({
   ventureCount:shadow.ventureCount,
   sourceCount:shadow.sourceCount,
   overlappingKeyGroups,
   unpairedCount:shadow.unpairedCount,
   negativeCount:shadow.negativeCount,
   invalidIdentityCount:shadow.invalidIdentityCount,
   boundedPageComplete:!shadow.hasMore,
  }),
  lineage:Object.freeze({
   jobCardsTotal,jobCardsWithoutTravellerVenture,ambiguousJobVentureCount,
   reservationsTotal,reservationsWithBrokenLineage,
   purchaseOrdersTotal,purchaseOrdersWithBrokenLineage,
  }),
  holds:Object.freeze([...holds]),
 });
}
