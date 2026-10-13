import assert from "node:assert/strict";
import test from "node:test";
import { createRequestReadinessGate } from "./request-readiness.ts";

test("a canceled request's orphaned schema promise cannot strand a later request", async () => {
  const gate = createRequestReadinessGate();
  const canceled = new Request("https://example.com/first");
  const later = new Request("https://example.com/second");
  let attempts = 0;
  void gate(canceled, () => { attempts += 1; return new Promise<void>(() => {}); });
  const recovered = gate(later, async () => { attempts += 1; });
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(attempts, 2, "later request must own a fresh check rather than inherit canceled I/O");
  await recovered;
});

test("same-request callers share a check and only completed success crosses requests", async () => {
  const gate = createRequestReadinessGate();
  const request = new Request("https://example.com");
  let attempts = 0;
  let finish = () => {};
  const check = () => { attempts += 1; return new Promise<void>((resolve) => { finish = resolve; }); };
  const first = gate(request, check);
  const second = gate(request, check);
  await Promise.resolve();
  assert.equal(attempts, 1);
  finish();
  await Promise.all([first, second]);
  await gate(new Request("https://example.com/later"), check);
  assert.equal(attempts, 1, "completed readiness is immutable data, safe to reuse");
});

test("failed schema checks stay fail-closed and are not cached as ready", async () => {
  const gate = createRequestReadinessGate();
  const request = new Request("https://example.com");
  const error = new Error("SCHEMA_LAG");
  await assert.rejects(gate(request, async () => { throw error; }), (caught) => caught === error);
  let checked = false;
  await gate(request, async () => { checked = true; });
  assert.equal(checked, true);
});
