import { readdir } from "node:fs/promises";
import { resolve } from "node:path";

const migrationsDir = resolve("migrations");

const LEGACY_DUPLICATE_PREFIXES = new Map(Object.entries({
  "007": ["007_epr_final_control_layer.sql", "007_inventory_msl_fifo.sql"],
  "008": ["008_epr_5m_control.sql", "008_epr_genealogy_control.sql", "008_epr_opening_balance_mapping_gate.sql", "008_epr_opening_mapping_revalidation.sql"],
  "009": ["009_epr_genealogy_forward_links.sql", "009_procurement_planning.sql"],
  "010": ["010_epr_genealogy_live_triggers.sql", "010_production_job_cards.sql"],
  "0019": ["0019_founder_evidence.sql", "0019_master_data.sql"],
  "0036": ["0036_fix_plan_revision_ambiguity.sql", "0036_procurement_cost_authority.sql"],
  "0037": ["0037_a_prepare_purchase_order_view_compat.sql", "0037_procurement_price_inr_guard.sql", "0037_production_batch_auto_procurement.sql"],
  "0047": ["0047_vibpe_assurance_backend.sql", "0047_vibpe_vayu_shastr_drive_source.sql"],
  "0059": ["0059_advanced_planning_packets.sql", "0059_master_inventory_catalogue_seed.sql"],
  "0062": ["0062_finance_accounting_backbone.sql", "0062_people_office_workbook_reconciliation.sql"],
  "0063": ["0063_issued_material_fulfillment.sql", "0063_live_finance_posting.sql"],
  "0064": ["0064_persisted_routing_authority.sql", "0064_r_prepare_statutory_summary_views.sql", "0064_statutory_finance_hardening.sql"],
  "0065": ["0065_a_prepare_itc_summary_views.sql", "0065_input_gst_itc_control.sql", "0065_routing_lifecycle_guard.sql"],
  "0066": ["0066_cash_funding_receipts.sql", "0066_output_gst_evidence_completion.sql", "0066_supplier_lane_authority.sql"],
  "0072": ["0072_advanced_planning_authority_workbench.sql", "0072_verified_management_actuals.sql"],
  "0073": ["0073_startup_cash_floor_authority.sql", "0073_vibpe_governed_workflow_ui_assurance.sql"],
  "0086": ["0086_access_governance.sql", "0086_actual_job_cost_cogs_chain.sql"],
  "0087": ["0087_stocktake_statutory_controls.sql", "0087_tooling_cost_recovery_authority.sql"],
}));

const entries = await readdir(migrationsDir, { withFileTypes: true });
const files = entries
  .filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
  .map((entry) => entry.name)
  .sort();

const byPrefix = new Map();
for (const file of files) {
  const match = file.match(/^(\d+)_/);
  if (!match) throw new Error(`Migration filename must begin with a numeric prefix: ${file}`);
  const list = byPrefix.get(match[1]) ?? [];
  list.push(file);
  byPrefix.set(match[1], list);
}

const violations = [];
for (const [prefix, names] of byPrefix) {
  if (names.length < 2) continue;
  const allowed = LEGACY_DUPLICATE_PREFIXES.get(prefix);
  if (!allowed || JSON.stringify([...names].sort()) !== JSON.stringify([...allowed].sort())) {
    violations.push(`${prefix}: ${names.join(", ")}`);
  }
}

for (const [prefix, allowed] of LEGACY_DUPLICATE_PREFIXES) {
  const actual = byPrefix.get(prefix) ?? [];
  if (actual.length < 2) {
    throw new Error(`Legacy migration-prefix baseline changed for ${prefix}; reconcile policy before continuing.`);
  }
  for (const file of allowed) {
    if (!actual.includes(file)) {
      throw new Error(`Legacy migration-prefix baseline is missing ${file}.`);
    }
  }
}

if (violations.length) {
  throw new Error(
    "New duplicate migration prefixes are forbidden. Use the next unused numeric prefix.\n" +
      violations.map((item) => ` - ${item}`).join("\n"),
  );
}

console.log(`[migration-prefix] PASS · ${files.length} migrations · legacy duplicates frozen · new duplicates forbidden`);
