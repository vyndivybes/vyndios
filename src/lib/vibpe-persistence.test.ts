import assert from "node:assert/strict";
import { test } from "node:test";
import type { Sql } from "./db.ts";
import {
  loadPersistedVibpeSession,
  persistVibpeAnswerReceipt,
  persistVibpeSession,
} from "./vibpe-persistence.ts";
import { buildVibpeAnswerReceipt } from "./vibpe-reasoning-core.ts";

function fakeSql() {
  const sessionRows = new Map<string, Record<string, unknown>>();
  const receipts: Record<string, unknown>[] = [];
  const sql = (async () => []) as unknown as Sql;
  sql.query = async (text: string, params: unknown[] = []) => {
    if (text.includes("insert into vyndi_vibpe_decision_sessions")) {
      sessionRows.set(String(params[0]), { state_json: params[2] });
      return [];
    }
    if (text.includes("from vyndi_vibpe_decision_sessions")) {
      const row = sessionRows.get(String(params[0]));
      return row ? [row] : [];
    }
    if (text.includes("insert into vyndi_vibpe_answer_receipts")) {
      receipts.push({ answer_id: params[0], receipt_json: params[4] });
      return [];
    }
    return [];
  };
  return { sql, receipts };
}

test("VIBPE decision context persists outside process-local memory", async () => {
  const { sql } = fakeSql();
  await persistVibpeSession(sql, "user-1", "session-1", {
    referencedProducts: ["altitude"],
    lastIntent: "assessment",
    assumptions: ["Toray production system remains open"],
  });
  const restored = await loadPersistedVibpeSession(sql, "user-1", "session-1");
  assert.deepEqual(restored?.referencedProducts, ["altitude"]);
  assert.equal(restored?.lastIntent, "assessment");
  assert.deepEqual(restored?.assumptions, ["Toray production system remains open"]);
});

test("answer receipts are persisted as auditable immutable payloads", async () => {
  const { sql, receipts } = fakeSql();
  const receipt = buildVibpeAnswerReceipt({
    answerId: "ans-42",
    question: "What is binding?",
    intent: "optimisation",
    dataMode: "live",
    evidence: [],
    assumptions: [],
    contradictions: [],
    calculations: [],
    fiveDimensions: {
      mathematical: { status: "verified", basis: "solver receipt" },
      theoretical: { status: "supported", basis: "finite planning model" },
      physical: { status: "insufficient-evidence", basis: "not applicable to business plan" },
      practical: { status: "supported", basis: "governed constraints" },
      scientific: { status: "supported", basis: "deterministic model" },
    },
    confidence: 0.9,
  });
  await persistVibpeAnswerReceipt(sql, "user-1", "session-1", receipt);
  assert.equal(receipts.length, 1);
  assert.equal(receipts[0].answer_id, "ans-42");
});
