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
