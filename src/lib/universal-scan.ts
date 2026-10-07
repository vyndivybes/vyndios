export const UNIVERSAL_SCAN_KINDS = [
  "sales_order",
  "job_card",
  "traveller",
  "purchase_order",
  "grn",
  "inventory_item",
  "quality_ncr",
  "quality_capa",
  "equipment",
  "maintenance_work_order",
] as const;

export type UniversalScanKind = (typeof UNIVERSAL_SCAN_KINDS)[number] | "unknown";
export type UniversalScanTargetType = Exclude<UniversalScanKind, "unknown">;

export type ParsedUniversalScan = {
  raw: string;
  recognized: boolean;
  kind: UniversalScanKind;
  identifier: string;
  signature: string | null;
};

const TYPE_ALIASES: Record<string, UniversalScanTargetType> = {
  ORDER: "sales_order",
  SALES: "sales_order",
  SO: "sales_order",
  JOB: "job_card",
  JBC: "job_card",
  JOB_CARD: "job_card",
  TRV: "traveller",
  TRAVELLER: "traveller",
  TRAVELER: "traveller",
  SERIAL: "traveller",
  PO: "purchase_order",
  PURCHASE_ORDER: "purchase_order",
  GRN: "grn",
  RECEIPT: "grn",
  SKU: "inventory_item",
  ITEM: "inventory_item",
  NCR: "quality_ncr",
  CAPA: "quality_capa",
  ASSET: "equipment",
  EQUIPMENT: "equipment",
  MWO: "maintenance_work_order",
  WORK_ORDER: "maintenance_work_order",
};

const RAW_PREFIXES: ReadonlyArray<[RegExp, UniversalScanTargetType]> = [
  [/^JBC-/i, "job_card"],
  [/^TRV-/i, "traveller"],
  [/^PO-/i, "purchase_order"],
  [/^GRN-/i, "grn"],
  [/^NCR-/i, "quality_ncr"],
  [/^CAPA-/i, "quality_capa"],
  [/^MWO-/i, "maintenance_work_order"],
  [/^SO-/i, "sales_order"],
];

export const UNIVERSAL_SCAN_KIND_LABELS: Record<UniversalScanTargetType, string> = {
  sales_order: "Commercial order",
  job_card: "Production Job Card",
  traveller: "Traveller / serial",
  purchase_order: "Purchase Order",
  grn: "Goods Receipt / GRN",
  inventory_item: "Inventory item / SKU",
  quality_ncr: "Quality NCR",
  quality_capa: "Quality CAPA",
  equipment: "Equipment / asset",
  maintenance_work_order: "Maintenance Work Order",
};

export const UNIVERSAL_SCAN_ROUTES: Record<UniversalScanTargetType, string> = {
  sales_order: "/command/sales",
  job_card: "/command/production",
  traveller: "/command/production",
  purchase_order: "/command/purchase-execution",
  grn: "/command/receiving",
  inventory_item: "/command/inventory",
  quality_ncr: "/command/quality",
  quality_capa: "/command/quality",
  equipment: "/command/manufacturing",
  maintenance_work_order: "/command/manufacturing",
};

function clean(value: unknown) {
  return String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim()
    .slice(0, 500);
}

export function parseUniversalScanPayload(input: unknown): ParsedUniversalScan {
  const raw = clean(input);
  if (!raw) return { raw: "", recognized: false, kind: "unknown", identifier: "", signature: null };

  const explicit = raw.match(/^VYNDI:([^:]+):([^:]+)(?::(.+))?$/i);
  if (explicit) {
    const alias = explicit[1]?.trim().toUpperCase().replace(/[ -]+/g, "_") ?? "";
    const kind = TYPE_ALIASES[alias];
    const identifier = clean(explicit[2]);
    if (kind && identifier) {
      return {
        raw,
        recognized: true,
        kind,
        identifier,
        signature: clean(explicit[3]) || null,
      };
    }
  }

  for (const [pattern, kind] of RAW_PREFIXES) {
    if (pattern.test(raw)) return { raw, recognized: true, kind, identifier: raw, signature: null };
  }

  return { raw, recognized: false, kind: "unknown", identifier: raw, signature: null };
}

export function scanRouteForKind(kind: UniversalScanKind): string | null {
  return kind === "unknown" ? null : UNIVERSAL_SCAN_ROUTES[kind];
}

export function scanKindLabel(kind: UniversalScanKind): string {
  return kind === "unknown" ? "Unclassified scan" : UNIVERSAL_SCAN_KIND_LABELS[kind];
}

export function evidenceTargetTypeForKind(kind: UniversalScanKind): UniversalScanTargetType | null {
  return kind === "unknown" ? null : kind;
}
