export type EvidenceClassification="AUTHORITATIVE"|"DERIVED"|"SNAPSHOT"|"EVENT"|"EVIDENCE"|"AUDIT";
export type EnterpriseEvidenceDomain={domain:string;classification:EvidenceClassification;canonicalStores:string[]};

export const enterpriseEvidenceRegistry:EnterpriseEvidenceDomain[]=[
 {domain:"commercial",classification:"AUTHORITATIVE",canonicalStores:["vyndi_sales_orders","vyndi_shipments","vyndi_invoices","vyndi_collections"]},
 {domain:"procurement",classification:"AUTHORITATIVE",canonicalStores:["vyndi_purchase_orders","vyndi_goods_receipts","vyndi_supplier_invoices"]},
 {domain:"inventory",classification:"AUTHORITATIVE",canonicalStores:["vyndi_inventory_lots","vyndi_inventory_movements"]},
 {domain:"production",classification:"AUTHORITATIVE",canonicalStores:["epr_production_job_cards","epr_travellers"]},
 {domain:"quality",classification:"AUTHORITATIVE",canonicalStores:["vyndi_quality_inspections","vyndi_quality_ncrs","vyndi_quality_capas","vyndi_quality_releases"]},
 {domain:"engineering",classification:"EVIDENCE",canonicalStores:["vyndi_engineering_evidence_receipts","vyndi_engineering_release_decisions","vyndi_engineering_thread_snapshots"]},
 {domain:"finance",classification:"AUTHORITATIVE",canonicalStores:["vyndi_finance_journals","vyndi_finance_journal_lines","vyndi_financial_statement_snapshots"]},
 {domain:"ibpe",classification:"SNAPSHOT",canonicalStores:["vyndi_ibpe_runs","vyndi_ibpe_report_snapshots","vyndi_ibpe_decisions","vyndi_advanced_planning_packets"]},
 {domain:"risk",classification:"AUTHORITATIVE",canonicalStores:["vyndi_risks"]},
 {domain:"maintenance",classification:"AUTHORITATIVE",canonicalStores:["vyndi_maintenance_work_orders","vyndi_maintenance_parts"]},
 {domain:"people-office",classification:"AUTHORITATIVE",canonicalStores:["vyndi_people_records","vyndi_people_office_cost_items","vyndi_people_office_assets"]},
 {domain:"supplier",classification:"AUTHORITATIVE",canonicalStores:["vyndi_suppliers","vyndi_supplier_lane_revisions"]},
 {domain:"vibe",classification:"EVIDENCE",canonicalStores:["vyndi_vibpe_answer_receipts","vyndi_vibpe_answer_quality_events","vyndi_vibe_decisions","vyndi_vibe_outcomes","vyndi_vibe_historical_replays","vyndi_vibe_comparator_observations","vyndi_vibe_certification_runs"]},
 {domain:"scan-evidence",classification:"EVIDENCE",canonicalStores:["vyndi_scan_evidence_attachments"]},
];
export const enterpriseEvidenceBoundary="Registry references owning canonical stores; it creates no duplicate operational transaction truth.";
