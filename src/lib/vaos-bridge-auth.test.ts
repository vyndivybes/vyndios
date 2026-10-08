import test from "node:test";
import assert from "node:assert/strict";
import {
  canonicalVaosBridgeSignatureInput,
  verifyVaosBridgeSignature,
  VAOS_BRIDGE_KEY_ID,
} from "./vaos-bridge-auth.ts";

test("canonical VAOS bridge signature input is stable", () => {
  assert.equal(
    canonicalVaosBridgeSignatureInput({
      timestamp: "1760000000000",
      nonce: "nonce-test-1234567890",
      bodySha256: "a".repeat(64),
    }),
    `1760000000000\nnonce-test-1234567890\n${"a".repeat(64)}`,
  );
});

test("qualified P-256 signature verifies and rejects tampering", async () => {
  const base = {
    timestamp: "1760000000000",
    nonce: "nonce-test-1234567890",
    bodySha256: "a".repeat(64),
    signature: "NQRDW84vVH_fgwkABIIzcSvXsHsv71FgnHhJgJCN3nl6cwWj3QcOh7WEERcb5Fg9X2q8oreTeOt44TDoynP-xw",
    keyId: VAOS_BRIDGE_KEY_ID,
    now: new Date(1760000000000),
  };
  assert.deepEqual(await verifyVaosBridgeSignature(base), { ok: true });
  assert.equal(
    (await verifyVaosBridgeSignature({ ...base, bodySha256: "b".repeat(64) })).ok,
    false,
  );
});

test("stale signed requests fail before bridge execution", async () => {
  const result = await verifyVaosBridgeSignature({
    timestamp: "1760000000000",
    nonce: "nonce-test-1234567890",
    bodySha256: "a".repeat(64),
    signature: "NQRDW84vVH_fgwkABIIzcSvXsHsv71FgnHhJgJCN3nl6cwWj3QcOh7WEERcb5Fg9X2q8oreTeOt44TDoynP-xw",
    keyId: VAOS_BRIDGE_KEY_ID,
    now: new Date(1760001000000),
  });
  assert.deepEqual(result, { ok: false, error: "timestamp_out_of_window" });
});
