export type AuthorityDomain = "gst" | "customs" | "trade" | "accounting" | "carbon-materials" | "road-components";

export type AuthoritySource = {
  id: string;
  domain: AuthorityDomain;
  name: string;
  authorityClass: "government" | "manufacturer" | "standards";
  url: string;
  purpose: string;
  mutable: boolean;
  ingestionPolicy: "live-reference" | "curated-snapshot";
};

export const VIBPE_AUTHORITY_REGISTRY: AuthoritySource[] = [
  {
    id: "cbic-gst",
    domain: "gst",
    name: "CBIC GST",
    authorityClass: "government",
    url: "https://cbic-gst.gov.in/",
    purpose: "GST Acts, rules, notifications, input-tax-credit and compliance references",
    mutable: true,
    ingestionPolicy: "curated-snapshot",
  },
  {
    id: "icegate",
    domain: "customs",
    name: "ICEGATE / Indian Customs",
    authorityClass: "government",
    url: "https://www.icegate.gov.in/",
    purpose: "Customs tariff, import/export trade guide, duty and compliance reference",
    mutable: true,
    ingestionPolicy: "live-reference",
  },
  {
    id: "dgft",
    domain: "trade",
    name: "Directorate General of Foreign Trade",
    authorityClass: "government",
    url: "https://www.dgft.gov.in/",
    purpose: "Foreign Trade Policy, IEC and import/export policy controls",
    mutable: true,
    ingestionPolicy: "curated-snapshot",
  },
  {
    id: "toray-cma",
    domain: "carbon-materials",
    name: "Toray Composite Materials America",
    authorityClass: "manufacturer",
    url: "https://www.toraycma.com/resources/data-sheets/",
    purpose: "Carbon-fibre and prepreg manufacturer technical data for material selection",
    mutable: true,
    ingestionPolicy: "curated-snapshot",
  },
  {
    id: "toray-tac-datasheets",
    domain: "carbon-materials",
    name: "Toray Advanced Composites Datasheets",
    authorityClass: "manufacturer",
    url: "https://www.toraytac.com/resources/datasheets",
    purpose: "Manufacturer datasheets for commercial prepreg systems, reinforcement forms, resin systems, physical properties and supplier material-selection evidence",
    mutable: true,
    ingestionPolicy: "curated-snapshot",
  },
  {
    id: "toray-tac-calculators",
    domain: "carbon-materials",
    name: "Toray Advanced Composites Calculators",
    authorityClass: "manufacturer",
    url: "https://www.toraytac.com/resources/Calculators",
    purpose: "Supplier engineering calculators for cured-ply thickness, tooling dimensional compensation, tooling material quantity and RAVEN process modelling",
    mutable: true,
    ingestionPolicy: "live-reference",
  },
  {
    id: "shimano-productinfo",
    domain: "road-components",
    name: "Shimano Product Information",
    authorityClass: "manufacturer",
    url: "https://productinfo.shimano.com/",
    purpose: "Current road component technical specifications and compatibility evidence",
    mutable: true,
    ingestionPolicy: "curated-snapshot",
  },
];

export function authorityFor(domain: AuthorityDomain) {
  return VIBPE_AUTHORITY_REGISTRY.filter((source) => source.domain === domain);
}

export const AUTHORITY_POLICY = {
  governedInternalWins: true,
  externalMayOverwriteApprovedMasterData: false,
  requireEffectiveDateForTaxAndTrade: true,
  requireSourceReferenceForExternalClaims: true,
  requireHumanApprovalBeforeMasterDataPromotion: true,
} as const;
