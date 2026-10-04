import test from "node:test";
import assert from "node:assert/strict";
import {
  planRuntimeSchemaMigrations,
  destructiveRuntimeMigrationStatements,
} from "./runtime-schema-migrations.ts";

test("Hyperdrive runtime reconciles only pending additive migrations in canonical order",()=>{
  const migrations={
    "/migrations/0114_b.sql":"create table if not exists b(id text primary key);",
    "/migrations/0113_a.sql":"create table if not exists a(id text primary key);",
    "/migrations/0115_c.sql":"create table if not exists c(id text primary key);",
  };
  const plan=planRuntimeSchemaMigrations({
    transportSource:"hyperdrive",
    migrations,
    applied:["0113_a.sql"],
  });
  assert.equal(plan.allowed,true);
  assert.deepEqual(plan.pending.map((row)=>row.name),["0114_b.sql","0115_c.sql"]);
  assert.deepEqual(plan.blocked,[]);
});

test("runtime schema reconciliation is disabled for non-Hyperdrive transports",()=>{
  const plan=planRuntimeSchemaMigrations({
    transportSource:"database-url",
    migrations:{"/migrations/0113_a.sql":"create table if not exists a(id text primary key);"},
    applied:[],
  });
  assert.equal(plan.allowed,false);
  assert.deepEqual(plan.pending,[]);
});

test("destructive pending migrations fail closed at runtime",()=>{
  assert.deepEqual(destructiveRuntimeMigrationStatements("drop table dangerous;"),["DROP TABLE"]);
  const plan=planRuntimeSchemaMigrations({
    transportSource:"hyperdrive",
    migrations:{"/migrations/0117_danger.sql":"drop table dangerous;"},
    applied:[],
  });
  assert.equal(plan.allowed,false);
  assert.equal(plan.pending.length,0);
  assert.deepEqual(plan.blocked,[{name:"0117_danger.sql",classes:["DROP TABLE"]}]);
});

test("current Hyperdrive schema is a no-op",()=>{
  const migrations={"/migrations/0113_a.sql":"create table if not exists a(id text primary key);"};
  const plan=planRuntimeSchemaMigrations({
    transportSource:"hyperdrive",
    migrations,
    applied:["0113_a.sql"],
  });
  assert.equal(plan.allowed,true);
  assert.deepEqual(plan.pending,[]);
  assert.deepEqual(plan.blocked,[]);
});
