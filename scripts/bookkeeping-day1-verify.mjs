import { readFileSync } from "node:fs";
import { evaluateBookkeepingDay1 } from "../src/lib/finance/bookkeeping-day1-acceptance.ts";

// Read-only evidence evaluation. Never creates journals, approves records, or closes periods.
const baselineSha = process.env.DAY1_DEPLOY_SHA ?? "";
let evidence = [];
const source = process.env.DAY1_EVIDENCE_JSON;
if (source) {
  try {
    const parsed = JSON.parse(readFileSync(source, "utf8"));
    if (!Array.isArray(parsed)) throw new Error("Evidence input must be an array.");
    evidence = parsed;
  } catch (error) {
    console.error("DAY1_EVIDENCE_INVALID:", error.message);
    process.exitCode = 2;
  }
}
if (process.exitCode !== 2) {
  const result = evaluateBookkeepingDay1(baselineSha, evidence);
  console.log(JSON.stringify({
    ...result,
    completedPeriodRequired: false,
    evidenceMeaning: "Evidence pointers require independent inspection; manifest flags are not statutory proof.",
  }, null, 2));
  if (result.state !== "QUALIFIED_FOR_DAY1_BOOKKEEPING") process.exitCode = 1;
}
