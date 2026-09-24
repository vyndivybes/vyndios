import assert from "node:assert/strict";
import test from "node:test";
import { migrationEnvironmentDecision } from "./migration-environment.mjs";

const decide = (env) => migrationEnvironmentDecision(env);

test("Cloudflare Workers main build may migrate", () => {
  assert.equal(decide({ WORKERS_CI: "1", WORKERS_CI_BRANCH: "main" }).allowed, true);
});

test("Cloudflare Workers preview branch cannot migrate", () => {
  assert.equal(decide({ WORKERS_CI: "1", WORKERS_CI_BRANCH: "feature/test" }).allowed, false);
});


test("Cloudflare Pages main may migrate and preview branch may not", () => {
  assert.equal(decide({ CF_PAGES: "1", CF_PAGES_BRANCH: "main" }).allowed, true);
  assert.equal(decide({ CF_PAGES: "1", CF_PAGES_BRANCH: "preview" }).allowed, false);
});

test("unknown/local context fails closed", () => {
  assert.equal(decide({}).allowed, false);
  assert.match(decide({}).reason, /VYNDI_ALLOW_DB_MIGRATIONS=1/);
});

test("explicit migration override is authoritative for deliberate operations", () => {
  assert.equal(decide({ VYNDI_ALLOW_DB_MIGRATIONS: "true" }).allowed, true);
  assert.equal(
    decide({ VYNDI_ALLOW_DB_MIGRATIONS: "false", WORKERS_CI: "1", WORKERS_CI_BRANCH: "main" }).allowed,
    false,
  );
});
