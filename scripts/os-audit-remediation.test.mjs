import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("public product detail routes do not depend on protected Command inventory", () => {
  const route = read("src/routes/range.$tier.tsx");
  const home = read("src/routes/index.tsx");
  assert.doesNotMatch(route, /getAuthoritativeInventory/);
  assert.match(route, /PUBLIC_TIER_TO_ID/);
  for (const name of ["longitude", "latitude", "altitude"]) assert.match(route, new RegExp(name));
  assert.match(home, /t\.name\.replace\("VYNDI ", ""\)\.toLowerCase\(\)/);
});

test("EPR traveller authority is server resolved and permissions follow edit/approve semantics", () => {
  const execution = read("src/lib/epr/execution.ts");
  const traceability = read("src/lib/epr/traceability.ts");
  const live = read("src/routes/command/epr-live.tsx");
  const metadata = read("src/lib/page-metadata.ts");
  assert.match(execution, /vyndi_bom_revision_current_state/);
  assert.match(execution, /CURRENT_CARBON_EPR_PILOT_AUTHORITY/);
  assert.doesNotMatch(execution, /engineeringRevision:\s*z\.string/);
  assert.doesNotMatch(execution, /bomRevision:\s*z\.string/);
  assert.match(execution, /requireBusinessActor\("edit"\)/);
  assert.match(execution, /canAccessRoute\(actor\.role, EPR_ROUTE\)/);
  assert.match(execution, /data\.status === "passed"[\s\S]*"approve"/);
  assert.match(execution, /canAccessRoute\(actorRecord\.role, EPR_ROUTE\)/);
  assert.match(execution, /authorityResolvedServerSide:\s*true/);
  assert.doesNotMatch(live, /VEDM-301-5\.3\.8|VINDY-LONGITUDE-PILOT/);
  assert.match(live, /BOM revision and engineering authority are resolved server-side/);
  assert.match(live, /canEdit/);
  assert.match(live, /canApprove/);
  assert.doesNotMatch(traceability, /Admin Command access is required for EPR views/);
  assert.match(traceability, /requireBusinessActor\("edit"\)/);
  assert.match(traceability, /canAccessRoute\(actor\.role, EPR_ROUTE\)/);
  assert.match(traceability, /canAccessRoute\(role, EPR_ROUTE\)/);
  assert.match(metadata, /"\/command\/epr-live"[\s\S]*"operate"[\s\S]*"Operate"/);
});

test("Finance, GTM, identity and VIBPE reuse canonical authorities", () => {
  const finance = read("src/routes/command/master-finance.tsx");
  const bom = read("src/lib/data/bom.ts");
  const knowledge = read("src/lib/data/knowledge.ts");
  const copilot = read("src/components/ibpe-copilot.tsx");
  const migration = read("migrations/0091_vyndi_brand_identity_reconciliation.sql");
  assert.match(finance, /\/command\/financial-cockpit/);
  assert.doesNotMatch(finance, /to: "\/command\/finance-control"/);
  assert.match(bom, /import \{ TIERS \} from "\.\/company"/);
  assert.match(bom, /ASP_BY_TIER\.core \* MIX\.core/);
  assert.doesNotMatch(bom, /129900 \* MIX\.core|264900 \* MIX\.apex/);
  assert.match(knowledge, /VYNDI Longitude \/ Latitude \/ Altitude bicycle range/);
  assert.match(copilot, /workspaceForRoute/);
  assert.match(copilot, /Supply & Operations/);
  assert.doesNotMatch(copilot, /Supply & Production/);
  assert.match(migration, /regexp_replace\(display_name,'\^VINDY ','VYNDI '\)/);
});

test("VIBPE exposes structured, openable knowledge evidence", () => {
  const server = read("src/lib/ibpe-copilot.ts");
  const ui = read("src/components/ibpe-copilot.tsx");
  assert.match(server, /knowledgeEvidence\?: VibpeKnowledgeEvidence\[\]/);
  assert.match(server, /knowledgeEvidence: surfacedKnowledgeEvidence/);
  assert.match(ui, /Open source/);
  assert.match(ui, /evidence\.externalUrl/);
  assert.match(ui, /knowledgeEvidence: response\.knowledgeEvidence/);
});
