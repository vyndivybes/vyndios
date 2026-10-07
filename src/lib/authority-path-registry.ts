export type AuthorityDomain =
  | "commercial"
  | "inventory"
  | "quality"
  | "peopleOffice"
  | "funding"
  | "recovery";

export type AuthorityPath = {
  primaryRoute: string;
  writerModule: string;
  systemOfRecord: string;
  compatibilityRoutes?: readonly string[];
  specialistRoutes?: readonly string[];
};

export const CANONICAL_AUTHORITY_PATHS: Record<AuthorityDomain, AuthorityPath> = {
  commercial: {
    primaryRoute: "/command/sales",
    writerModule: "@/lib/sales-order-authority",
    systemOfRecord: "vyndi_sales_orders + vyndi_sales_order_revisions",
    specialistRoutes: ["/command/sales-ledger"],
  },
  inventory: {
    primaryRoute: "/command/inventory",
    writerModule: "@/lib/master-inventory",
    systemOfRecord: "master_inventory_items + epr_inventory_ledger + epr_inventory_fifo_layers",
    compatibilityRoutes: ["/command/inventory-legacy", "/inventory"],
    specialistRoutes: [
      "/command/inventory-master",
      "/command/bom-inventory-mapping",
      "/command/inventory-openings",
      "/command/inventory-stocktake",
      "/command/inventory-truth",
      "/command/inventory-control-audit",
    ],
  },
  quality: {
    primaryRoute: "/command/quality",
    writerModule: "@/lib/quality-authority",
    systemOfRecord: "vyndi_quality_* with canonical EPR release gate",
  },
  peopleOffice: {
    primaryRoute: "/command/people-office",
    writerModule: "@/lib/people-office-authority",
    systemOfRecord: "vyndi_people_records + specialist append-only People ledgers",
  },
  funding: {
    primaryRoute: "/command/funding",
    writerModule: "@/lib/cash-funding-authority",
    systemOfRecord: "vyndi_cash_funding_receipts + vyndi_funding_* lifecycle ledgers",
  },
  recovery: {
    primaryRoute: "/command/recovery",
    writerModule: "@/lib/recovery-control",
    systemOfRecord: "vyndi_recovery_requests + append-only recovery evidence/events",
  },
};

export function authorityPathFor(domain: AuthorityDomain) {
  return CANONICAL_AUTHORITY_PATHS[domain];
}
