import assert from "node:assert/strict";
import test from "node:test";
import {
  DAY1_BOOKKEEPING_REQUIREMENTS,
  evaluateBookkeepingDay1,
  type Day1Evidence,
} from "./bookkeeping-day1-acceptance.ts";

const sha = "a".repeat(40);
const evidence = (gate: Day1Evidence["gate"]): Day1Evidence => ({
  gate, outcome: "pass", evidenceRef: `assurance://day1/${gate}`,
  verifier: "independent-test-or-control-owner",
  verifiedAt: "2026-10-12T00:00:00.000Z",
  baselineSha: sha,
});

test("new company with no completed months is evaluated independently of period close", () => {
  const proofs = DAY1_BOOKKEEPING_REQUIREMENTS.map(({ id }) => evidence(id));
  const decision = evaluateBookkeepingDay1(sha, proofs);
  assert.equal(decision.state, "QUALIFIED_FOR_DAY1_BOOKKEEPING");
  assert.equal(decision.outstanding.length, 0);
  assert.ok(!DAY1_BOOKKEEPING_REQUIREMENTS.some(({id}) => /CLOSED_PERIOD|BANK_SESSION|POSTED_STOCKTAKE|CA_PACK/.test(id)));
});

test("an unqualified control cannot be overridden by other passed controls", () => {
  const proofs = DAY1_BOOKKEEPING_REQUIREMENTS.map(({id})=>evidence(id))
    .filter(p=>p.gate!=="NON_DISABLEABLE_TRANSACTION_AUDIT_TRAIL");
  const result=evaluateBookkeepingDay1(sha,proofs);
  assert.equal(result.state,"NOT_YET_QUALIFIED");
  assert.ok(result.outstanding.some(x=>x.id==="NON_DISABLEABLE_TRANSACTION_AUDIT_TRAIL"));
});

test("India backup verification is a distinct pre-use requirement", () => {
  const proofs=DAY1_BOOKKEEPING_REQUIREMENTS.map(({id})=>evidence(id))
    .filter(p=>p.gate!=="DAILY_INDIA_BOOKS_BACKUP");
  assert.equal(evaluateBookkeepingDay1(sha,proofs).state,"NOT_YET_QUALIFIED");
});

test("a record with stale SHA, missing proof, invalid date or missing verifier does not qualify", () => {
  const all=DAY1_BOOKKEEPING_REQUIREMENTS.map(({id})=>evidence(id));
  const bad:Day1Evidence[]=[
    {...all[0],baselineSha:"b".repeat(40)},
    {...all[0],evidenceRef:""},
    {...all[0],verifier:""},
    {...all[0],verifiedAt:"not-a-date"},
    {...all[0],outcome:"fail"},
  ];
  for(const first of bad){
    const result=evaluateBookkeepingDay1(sha,[first,...all.slice(1)]);
    assert.equal(result.state,"NOT_YET_QUALIFIED");
    assert.ok(result.outstanding.includes(DAY1_BOOKKEEPING_REQUIREMENTS[0].id));
  }
});

test("duplicate or unexpected records cannot disguise an absent required proof", () => {
  const all=DAY1_BOOKKEEPING_REQUIREMENTS.map(({id})=>evidence(id));
  const duplicate=[all[0],...all];
  assert.equal(evaluateBookkeepingDay1(sha,duplicate).state,"NOT_YET_QUALIFIED");
  const withoutOne=all.slice(1);
  const other={...all[0],gate:"CA_PERIOD_CLOSE" as Day1Evidence["gate"]};
  assert.equal(evaluateBookkeepingDay1(sha,[...withoutOne,other]).state,"NOT_YET_QUALIFIED");
});
