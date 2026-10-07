import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("MES-SCAN-01 mounts one scanner input layer across the protected Command shell", () => {
  const route = read("src/routes/command/route.tsx");
  const component = read("src/components/universal-scan-centre.tsx");
  assert.match(route, /universal-scan-centre/);
  assert.match(route, /LazyUniversalScanCentre/);
  assert.match(component, /window\.addEventListener\("keydown"/);
  assert.match(component, /WEDGE_GAP_MS/);
  assert.match(component, /BarcodeDetector/);
  assert.match(component, /getUserMedia/);
  assert.match(component, /capture="environment"/);
  assert.match(component, /\/api\/scan\/evidence/);
});

test("scanner resolver reads existing canonical authorities and does not create transaction truth", () => {
  const authority = read("src/lib/universal-scan-authority.ts");
  assert.match(authority, /vyndi_sales_orders/);
  assert.match(authority, /epr_production_job_cards/);
  assert.match(authority, /epr_travellers/);
  assert.match(authority, /master_inventory_items/);
  assert.match(authority, /vyndi_quality_ncrs/);
  assert.match(authority, /vyndi_maintenance_work_orders/);
  assert.doesNotMatch(authority, /insert\s+into/i);
  assert.doesNotMatch(authority, /update\s+/i);
});

test("document scan evidence is authenticated, same-origin, MIME-verified, deduplicated and audited", () => {
  const api = read("src/routes/api/scan/evidence.ts");
  const migration = read("migrations/0145_universal_scan_evidence.sql");
  assert.match(api, /requireBusinessActor\("edit"\)/);
  assert.match(api, /sameOrigin\(request\)/);
  assert.match(api, /detectedMime/);
  assert.match(api, /crypto\.subtle\.digest\("SHA-256"/);
  assert.match(api, /duplicate_evidence/);
  assert.match(api, /SCAN_EVIDENCE_ATTACHED/);
  assert.match(api, /canAccessRoute/);
  assert.match(migration, /vyndi_scan_evidence_attachments/);
  assert.match(migration, /append-only/);
  assert.match(migration, /before update or delete/i);
  assert.match(migration, /file_size_bytes > 0 and file_size_bytes <= 5242880/);
});
