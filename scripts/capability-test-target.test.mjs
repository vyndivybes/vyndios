import assert from "node:assert/strict";
import test from "node:test";
import { validateCapabilityTarget } from "./capability-test-target.mjs";

const target = {
  databaseUrl: "postgresql://stage9_owner:example@ep-spring-hat-b49hupiw-pooler.c-6.us-east-2.aws.neon.tech/vyndios_capability_test?sslmode=require",
  workerName: "vyndios-capability-test",
  confirmation: "SYNTHETIC-CAPABILITY-TEST-ONLY",
};
test("accepts only the dedicated isolated capability database and Worker", () => {
  assert.equal(validateCapabilityTarget(target).database, "vyndios_capability_test");
});
test("rejects production, existing rehearsal, unencrypted, ambiguous and missing targets", () => {
  for (const patch of [
    {workerName:"vyndios"}, {workerName:"vyndios-stage9-isolated"},
    {confirmation:""}, {databaseUrl:""},
    {databaseUrl:target.databaseUrl.replace("vy ndios".replace(" ",""),"vyndios")},
    {databaseUrl:target.databaseUrl.replace("/vyndios_capability_test","/stage9")},
    {databaseUrl:target.databaseUrl.replace("/vyndios_capability_test","/neondb")},
    {databaseUrl:target.databaseUrl.replace("ep-spring-hat-b49hupiw-pooler","production")},
    {databaseUrl:target.databaseUrl.replace("sslmode=require","sslmode=disable")},
    {databaseUrl:target.databaseUrl+"&host=production"},
    {databaseUrl:target.databaseUrl+"&dbname=neondb"},
  ].filter(p => p.databaseUrl !== target.databaseUrl)) {
    assert.throws(() => validateCapabilityTarget({...target,...patch}), /Capability test target rejected/);
  }
});
