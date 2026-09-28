import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const shell = readFileSync(new URL("../src/components/command-shell-v2.tsx", import.meta.url), "utf8");
const workflow = readFileSync(new URL("../src/lib/operating-workflow.ts", import.meta.url), "utf8");
const manual = readFileSync(new URL("../src/routes/command/user-manual.tsx", import.meta.url), "utf8");
const traceability = readFileSync(new URL("../src/components/traceability-document-centre-v2.tsx", import.meta.url), "utf8");
const theme = readFileSync(new URL("../src/tansam-vyndi-theme.css", import.meta.url), "utf8");
const accountingAlias = readFileSync(new URL("../src/routes/command/accounting_.$legacy.tsx", import.meta.url), "utf8");

test("global Command search is a governed universal entry point without runtime DOM indexing", () => {
  assert.match(shell, /function CommandSearch\(/);
  assert.match(shell, /const SEARCH_ENTRIES/);
  assert.match(shell, /WORKSPACE_NAVIGATION\[workspace\.id\]/);
  assert.match(shell, /isAccessible\(role, entry\.to\)/);
  assert.match(shell, /Search orders, job cards, serials, POs, GRNs, suppliers, SKUs, quality, pages/);
  assert.match(shell, /Search records/);
  assert.match(shell, /Search governed records for/);
  assert.match(shell, /vyndi:traceability-search/);
  assert.match(shell, /new CustomEvent/);
  assert.match(shell, /detail: \{ query: trimmed \}/);
  assert.match(shell, /RBAC-filtered governed records and traceability/);
  assert.match(shell, /Matching pages remain quick navigation shortcuts/);
  assert.match(shell, /<CommandSearch role=\{role\} \/>/);
  assert.doesNotMatch(shell, /Filter search by workspace/);
  assert.doesNotMatch(shell, /Filter search by type/);
  assert.doesNotMatch(shell, /MutationObserver/);
  assert.doesNotMatch(shell, /createTreeWalker/);
  assert.doesNotMatch(shell, /document\.body\.innerText/);
  assert.doesNotMatch(shell, /document\.querySelectorAll/);
});

test("Finance navigation exposes canonical People & Office Actual Spend and legacy human-readable URLs recover", () => {
  assert.match(workflow, /to: "\/command\/accounting\/people-office-payments", label: "People & Office Actual Spend"/);
  assert.match(accountingAlias, /createFileRoute\("\/command\/accounting\/\$legacy"\)/);
  assert.match(accountingAlias, /People & Office Actual Spend/);
  assert.match(accountingAlias, /redirect\(\{ to: "\/command\/accounting\/people-office-payments", replace: true \}\)/);
});

test("free-text Command searches hand off to the existing permission-aware Traceability Centre", () => {
  assert.match(traceability, /window\.addEventListener\("vyndi:traceability-search"/);
  assert.match(traceability, /DIRECT_SEARCH_SENTINEL/);
  assert.match(traceability, /interpretTraceabilityQuery\(trimmed\)/);
  assert.match(traceability, /searchTraceability\(\{ data: \{ query: serverQuery, limit: 60 \} \}\)/);
  assert.match(traceability, /direct partial-ID, SKU, supplier, model and vernacular search/i);
});

test("unified Command search replaces the redundant floating Traceability trigger", () => {
  assert.match(theme, /button\[aria-label="Open Traceability and Print"\]/);
  assert.match(theme, /display:\s*none\s*!important/);
  assert.match(traceability, /Traceability & Print Centre/);
  assert.match(traceability, /window\.addEventListener\("vyndi:traceability-search"/);
});

test("User Manual is a searchable Command reference page without global runtime scanning", () => {
  assert.match(workflow, /label: "Help & Reference"/);
  assert.match(workflow, /to: "\/command\/user-manual", label: "User Manual"/);
  assert.match(manual, /createFileRoute\("\/command\/user-manual"\)/);
  assert.match(manual, /data-user-manual="vyndi-um-001-rev-1-4"/);
  assert.match(manual, /User & Operator Manual/);
  assert.match(manual, /Search the manual/);
  assert.match(manual, /Print dossier/);
  assert.match(manual, /How to Operate VIBPE/);
  assert.doesNotMatch(manual, /MutationObserver/);
  assert.doesNotMatch(manual, /createTreeWalker/);
});

test("User Manual contains actionable procedures for every governed VIBPE stage", () => {
  for (const title of [
    "VIBPE 01 — Operating Workspace",
    "VIBPE 02 — Planning Authority",
    "VIBPE 03 — Governed Optimizer",
    "VIBPE 04 — Outputs & Evidence",
    "VIBPE 05 — Assurance",
    "VIBPE 06 — Release Readiness",
  ]) assert.match(manual, new RegExp(title.replace(/[—]/g, "—")));

  for (const control of [
    "1. Preview interpretation",
    "2. Authorise proposal",
    "3. Apply governed adapter",
    "Approve current capacity standards",
    "Create routing drafts from approved capacity",
    "Approve routing",
    "Build governed advanced-planning packet",
    "Refresh governed advanced-planning packet",
    "Run governed HiGHS optimization",
    "Print governed report",
    "Load complete register",
    "Load capability register",
    "Capture assurance snapshot",
    "Release verdict",
    "Closure gates",
  ]) assert.match(manual, new RegExp(control.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));

  assert.match(manual, /Operating Workspace — understand the current business condition/);
  assert.match(manual, /Workspace → Authority → Optimizer → Outputs → Assurance → Release/);
  assert.match(manual, /Recommendation is not approval|advisory evidence only/);
  assert.match(manual, /Expected result \/ next gate/);
});
