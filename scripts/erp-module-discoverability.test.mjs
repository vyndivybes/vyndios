import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const navigation = read("src/lib/operating-workflow.ts");
const shell = read("src/components/command-shell-v2.tsx");
const commercial = read("src/routes/command/sales.tsx");
const statements = read("src/routes/command/accounting-statements.tsx");
const people = read("src/routes/command/people-office.tsx");
const production = read("src/routes/command/production.tsx");

test("canonical ERP destinations have recognizable labels but no duplicate workspaces", () => {
  assert.match(navigation, /to: SALES_HOME, label: "CRM · Demand & Orders"/);
  assert.match(navigation, /to: "\/command\/production", label: "MES · Production \/ Build"/);
  assert.match(navigation, /to: PEOPLE_HOME, label: "HR · People & Office"/);
  assert.match(navigation, /to: "\/command\/accounting-statements", label: "Financial Statements · Tally \/ CA Reconciliation"/);
  assert.match(commercial, /createFileRoute\("\/command\/sales"\)/);
  assert.match(statements, /createFileRoute\("\/command\/accounting-statements"\)/);
  assert.match(people, /createFileRoute\("\/command\/people-office"\)/);
  assert.match(production, /createFileRoute\("\/command\/production"\)/);
});

test("global search resolves ERP names through canonical routes without bypassing RBAC", () => {
  for (const [route, keyword] of [
    ["/command/sales", "CRM"],
    ["/command/people-office", "HRMS"],
    ["/command/production", "MES"],
    ["/command/accounting-statements", "TallyPrime"],
  ]) {
    assert.ok(shell.includes(`"${route}": "`), `missing alias for ${route}`);
    assert.ok(shell.includes(keyword), `missing search keyword ${keyword}`);
  }
  assert.match(shell, /ERP_PAGE_SEARCH_ALIASES\[entry\.to\]/);
  assert.match(shell, /isAccessible\(role, entry\.to\)/);
  assert.match(shell, /new Map<string, SearchEntry>/);
  for (const noncanonical of ["/command/crm", "/command/hrms", "/command/mes", "/command/tally"]) {
    assert.ok(!navigation.includes(`"${noncanonical}"`), `unexpected duplicate route ${noncanonical}`);
  }
});
