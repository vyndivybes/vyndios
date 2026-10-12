import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../src/lib/finance/statutory-authority.ts", import.meta.url), "utf8");
const match = source.match(/async function periodBlockers\(periodValue: string\) \{([\s\S]*?)\n\}\n\nexport const getStatutoryFinanceControl/);
assert.ok(match, "Actual server-side periodBlockers must be found");
const runtimeBody = match[1].replaceAll("sql.query<Record<string, unknown>>", "sql.query");
const execute = new Function("getSql", `return async function periodBlockers(periodValue) {${runtimeBody}\n}`);

const healthy = {
  unmatched_bank:0, gst_evidence:0, unverified_input_itc:0,
  pending_supplier_itc:0, invoice_tax:0, irn:0, payroll:0,
  posting:0, assets:0, tb_difference:0,
  approved_bank_reconciliations:1, posted_stocktakes:1, open_stocktakes:0,
};
const cases = [
  ["unmatched bank line","unmatched_bank",1],
  ["GST evidence missing","gst_evidence",1],
  ["unverified ITC","unverified_input_itc",1],
  ["pending supplier ITC","pending_supplier_itc",1],
  ["incomplete invoice tax profile","invoice_tax",1],
  ["missing required IRN","irn",1],
  ["payroll evidence","payroll",1],
  ["posting exception","posting",1],
  ["fixed asset source evidence","assets",1],
  ["trial balance difference","tb_difference",0.02],
  ["no approved bank reconciliation","approved_bank_reconciliations",0],
  ["no posted stocktake","posted_stocktakes",0],
  ["open stocktake","open_stocktakes",1],
];
async function evaluate(row) {
  const fn = execute(async () => ({ query: async () => row === undefined ? [] : [row] }));
  return fn("2026-09");
}
test("complete valid period has no hard-close blockers", async () => {
  assert.equal((await evaluate({...healthy})).blockerCount,0);
});
for (const [name, key, value] of cases) {
  test(`hard close rejects ${name}`, async () => {
    const report = await evaluate({ ...healthy, [key]:value });
    assert.equal(report.blockerCount,1);
  });
}
test("missing or corrupt database evidence fails closed", async () => {
  for (const row of [undefined, null, {...healthy, gst_evidence:null},
    {...healthy, tb_difference:"NaN"}, {...healthy, payroll:-1}, {...healthy, irn:1.5}]) {
    await assert.rejects(() => evaluate(row), /unavailable|invalid|incomplete/i);
  }
  const partial = {...healthy};
  delete partial.open_stocktakes;
  await assert.rejects(() => evaluate(partial), /unavailable|invalid|incomplete/i);
});
test("missing tax-profile or ITC-control status cannot pass SQL predicate", () => {
  assert.match(source, /itc_control_status\s+is\s+null|coalesce\(itc_control_status\s*,\s*'pending'\)/i);
  assert.match(source, /tax_profile_status\s+is\s+distinct\s+from\s+'complete'/i);
});
