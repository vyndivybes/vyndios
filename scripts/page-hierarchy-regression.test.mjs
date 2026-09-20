import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const finance = read("src/routes/command/financial-cockpit.tsx");
const accounting = read("src/routes/command/accounting.tsx");
const governance = read("src/routes/command/governance.tsx");
const commercial = read("src/routes/command/sales.tsx");
const users = read("src/routes/command/users.tsx");

test("individual workspace pages avoid duplicate top-level navigation", () => {
  assert.match(finance, /Finance Overview/);
  assert.doesNotMatch(finance, /Edit assumptions →/);
  assert.match(finance, /Related analysis & operating drivers/);

  assert.match(accounting, /Use Finance → Accounting & Statements/);
  assert.doesNotMatch(accounting, />Payables<\/Link>/);
  assert.doesNotMatch(accounting, />Receivables<\/Link>/);
  assert.doesNotMatch(accounting, />CA Audit<\/Link>/);

  assert.match(governance, /Evidence owners & related assurance surfaces/);
  assert.match(governance, /<details/);

  assert.match(commercial, /Related downstream controls/);
  assert.doesNotMatch(commercial, /<Panel title="Connected controls"/);
});

test("admin access page uses the canonical VYNDI visual language", () => {
  assert.match(users, /Admin · access & security · H4 IAM \/ SoD/);
  assert.match(users, /font-display text-4xl text-accent/);
  assert.match(users, /border-border/);
  assert.match(users, /bg-surface\/35/);
  assert.doesNotMatch(users, /text-slate-/);
  assert.doesNotMatch(users, /bg-white/);
  assert.doesNotMatch(users, /text-orange-/);
});


test("integrated planning and finance labels stay consistent across user-facing pages", () => {
  const workflow = read("src/lib/operating-workflow.ts");
  const cockpit = read("src/routes/command/financial-cockpit.tsx");
  const sales = read("src/routes/command/sales.tsx");
  const scenarios = read("src/routes/command/scenarios.tsx");
  const manual = read("src/routes/command/user-manual.tsx");
  const procurement = read("src/routes/command/procurement-planning.tsx");
  const metadata = read("src/lib/page-metadata.ts");

  assert.match(workflow, /Integrated Operating Plan/);
  assert.match(workflow, /Budget vs Forecast vs Actual/);
  assert.doesNotMatch(workflow, /Financial Planning/);
  assert.doesNotMatch(workflow, /Finance Analysis/);

  assert.match(cockpit, /getOperatingPlanState/);
  assert.match(cockpit, /approvedPlan\.finance/);
  assert.match(cockpit, /approvedPlan\.accounting/);
  assert.doesNotMatch(cockpit, /useVeloxis/);
  assert.match(cockpit, /Budget vs Forecast vs Actual/);

  assert.match(sales, /Integrated Operating Plan/);
  assert.doesNotMatch(sales, />Financial Planning</);

  assert.match(scenarios, /Integrated Operating Plan/);
  assert.match(scenarios, /Budget vs Forecast vs Actual/);
  assert.doesNotMatch(scenarios, /Approved assumptions/);

  assert.match(manual, /Integrated Operating Plan/);
  assert.match(manual, /Consolidated Overview/);

  assert.match(procurement, /Approved-plan procurement/);
  assert.match(procurement, /approvedPlanRevision/);

  assert.match(metadata, /Forecast Parameters/);
  assert.match(metadata, /Consolidated Finance Overview/);
});
