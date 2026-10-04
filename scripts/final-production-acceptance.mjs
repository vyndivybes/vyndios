import assert from "node:assert/strict";
import { spawn } from "node:child_process";

const expectedSha = process.env.VYNDI_TEST_EXPECTED_SHA?.trim();
assert.ok(expectedSha, "VYNDI_TEST_EXPECTED_SHA is required for final production acceptance.");

const baseUrl = (process.env.VYNDI_TEST_BASE_URL || "https://vyndios.vayushastr.workers.dev").replace(/\/$/, "");
const parsed = new URL(baseUrl);
assert.equal(parsed.protocol, "https:", "Final production acceptance requires an HTTPS target.");

const env = {
  ...process.env,
  VYNDI_TEST_BASE_URL: baseUrl,
  VYNDI_TEST_EXPECTED_SHA: expectedSha,
  VYNDI_E2E_ALLOW_MUTATION: "0",
};

const gates = [
  ["Golden Enterprise", "scripts/vyndi-golden-enterprise-journey.mjs"],
  ["Exact-SHA production smoke", "scripts/vyndi-production-playwright-smoke.mjs"],
  ["Responsive production UX", "scripts/operator-ux-hardening.mjs"],
];

function runGate(name, script) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script], { env, stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (code === 0) return resolve();
      reject(new Error(`${name} failed (exit=${code ?? "none"}, signal=${signal ?? "none"})`));
    });
  });
}

for (const [name, script] of gates) {
  console.log(`[production-acceptance] START · ${name}`);
  await runGate(name, script);
  console.log(`[production-acceptance] PASS · ${name}`);
}

console.log(`[production-acceptance] PASS · exact SHA ${expectedSha} · ${baseUrl}`);
