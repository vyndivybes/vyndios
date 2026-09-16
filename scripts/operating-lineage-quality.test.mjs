import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const lineage = readFileSync(new URL("../src/lib/operating-lineage.ts", import.meta.url), "utf8");

test("canonical operating lineage projects persisted Quality evidence before downstream dispatch", () => {
  assert.match(lineage, /qualityInspectionCount:\s*number/);
  assert.match(lineage, /qualityReleaseCount:\s*number/);
  assert.match(lineage, /qualityReleaseStatuses:\s*string/);
  assert.match(lineage, /openNcrCount:\s*number/);
  assert.match(lineage, /openCapaCount:\s*number/);

  assert.match(lineage, /from vyndi_quality_inspections i/);
  assert.match(lineage, /from vyndi_quality_releases r/);
  assert.match(lineage, /from vyndi_quality_ncrs n/);
  assert.match(lineage, /left join vyndi_quality_capas cp on cp\.ncr_id=n\.id/);
  assert.match(lineage, /r\.superseded_at is null/);
  assert.match(lineage, /quality_inspection_evidence_refs/);
  assert.match(lineage, /quality_release_evidence_refs/);

  const qualityJoin = lineage.indexOf("from vyndi_quality_inspections i");
  const shipmentJoin = lineage.indexOf("from vyndi_shipments s");
  assert.ok(qualityJoin >= 0 && shipmentJoin > qualityJoin, "Quality projection must precede downstream shipment projection");

  assert.doesNotMatch(lineage, /Quality is intentionally not joined here/);
  assert.doesNotMatch(lineage, /does\s+not\s+persist order\/job-card-linked inspection evidence/i);
  assert.doesNotMatch(lineage, /insert into/i);
  assert.doesNotMatch(lineage, /delete from/i);
  assert.doesNotMatch(lineage, /update\s+(?:vyndi_|epr_)/i);
});
