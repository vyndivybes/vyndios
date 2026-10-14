import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const sales = read("src/routes/command/sales.tsx");
const shell = read("src/components/command-shell-v2.tsx");
const styles = read("src/styles.css");

test("sales opens with compact order rows and explicit revision controls", () => {
  assert.match(sales, /vyndi-register-table/);
  assert.match(sales, /data-record-row/);
  assert.match(sales, /editingOrderId === order\.id/);
  assert.match(sales, /aria-expanded=\{editingOrderId === order\.id\}/);
  assert.doesNotMatch(sales, /<summary[^>]*>Revise order \/ configuration<\/summary>/);
});

test("order revisions occupy their own full-width row", () => {
  assert.match(sales, /data-editor-row/);
  assert.match(sales, /<td colSpan=\{8\}/);
  assert.match(sales, /Save & synchronize revision/);
  assert.match(sales, /Unsaved revision/);
});

test("Command-wide table readability rules are scoped and responsive", () => {
  assert.match(shell, /vyndi-command-tables/);
  assert.match(styles, /\.vyndi-command-tables table thead th/);
  assert.match(styles, /\.vyndi-register-table tr\[data-record-row\] td::before/);
  assert.match(styles, /content: attr\(data-label\)/);
  assert.match(styles, /max-width: 767px/);
});
