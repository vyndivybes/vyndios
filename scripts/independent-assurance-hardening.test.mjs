import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

const [
  schemaDiagnostic,
  chatgptAssurance,
  businessActor,
  authClient,
  authServer,
  packageJson,
  pageMetadata,
  operatingWorkflow,
  brandingTest,
] = await Promise.all([
  read("src/routes/api/runtime/schema-diagnostic.ts"),
  read("src/routes/api/vibpe/chatgpt-assurance.ts"),
  read("src/lib/business-actor.ts"),
  read("src/lib/auth/client.ts"),
  read("src/lib/auth/server.ts"),
  read("package.json").then(JSON.parse),
  read("src/lib/page-metadata.ts"),
  read("src/lib/operating-workflow.ts"),
  read("scripts/vyndi-branding-system.test.mjs"),
]);

test("runtime schema diagnostic requires an authenticated business actor", () => {
  assert.match(schemaDiagnostic, /requireBusinessActor\("view"\)/);
});

test("ChatGPT assurance bridge uses timing-safe bearer comparison and abuse limiting", () => {
  assert.match(chatgptAssurance, /timingSafeEqual/);
  assert.match(chatgptAssurance, /requestRateLimitDecision/);
  assert.doesNotMatch(chatgptAssurance, /bearerToken\(request\)\s*!==\s*expectedToken/);
});

test("business reads require an individually authenticated assigned role", () => {
  assert.doesNotMatch(businessActor, /legacy-command:/);
  assert.doesNotMatch(businessActor, /getCommandRole/);
  assert.match(businessActor, /getAssignedBusinessIdentity/);
});

test("production auth cannot be disabled by the VITE dev flag", () => {
  assert.match(authClient, /import\.meta\.env\.PROD\s*\|\|/);
  assert.match(authServer, /NODE_ENV/);
  assert.match(authServer, /production/);
});

test("ordinary build does not execute database migrations", () => {
  assert.equal(packageJson.scripts.build, "npm run build:bundle");
  assert.equal(packageJson.scripts["release:migrate"], "node scripts/migration-release-gate.mjs");
  assert.match(packageJson.scripts["db:validate"], /check-migration-prefixes/);
});

test("dead demo/showcase routes are removed from production ownership", async () => {
  await assert.rejects(access(new URL("../src/routes/command/demo-company.tsx", import.meta.url)));
  await assert.rejects(access(new URL("../src/routes/command/platform-walkthrough.tsx", import.meta.url)));
  assert.doesNotMatch(pageMetadata, /\/command\/demo-company|\/command\/platform-walkthrough/);
  assert.doesNotMatch(operatingWorkflow, /\/command\/demo-company|\/command\/platform-walkthrough/);
  assert.doesNotMatch(brandingTest, /demo-company|platform-walkthrough/);
});

test("PWA install page remains because it is an active plugin dependency", async () => {
  await access(new URL("../scripts/install-page.html", import.meta.url));
  const plugin = await read("scripts/grok-pwa-plugin.mjs");
  assert.match(plugin, /install-page\.html/);
});

test("repository has a root operating README", async () => {
  const readme = await read("README.md");
  assert.match(readme, /VYNDI OS/);
  assert.match(readme, /Production-qualified baseline/);
});
