import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { QUALITY_REGISTER_QUERY } from "../src/lib/quality-register-query.ts";

test("Quality registers return complete empty arrays from one SQL statement", async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`
    create table vyndi_quality_inspections(id text, recorded_at timestamptz);
    create table vyndi_quality_ncrs(id text, updated_at timestamptz);
    create table vyndi_quality_capas(id text, updated_at timestamptz);
    create table vyndi_quality_releases(id text, decided_at timestamptz, superseded_at timestamptz);
    create table epr_ncr_capa(id text, status text);
  `);
  const read = async () => (await db.query(QUALITY_REGISTER_QUERY)).rows[0];
  assert.deepEqual(await read(), { inspections: [], ncrs: [], capas: [], releases: [], epr_open: 0 });
  await db.exec(`
    insert into vyndi_quality_inspections select n::text, '2026-01-01'::timestamptz+n*interval '1 second' from generate_series(1,501) n;
    insert into vyndi_quality_ncrs values ('ncr-1','2026-01-01');
    insert into vyndi_quality_capas values ('capa-1','2026-01-01');
    insert into vyndi_quality_releases values ('current','2026-01-02',null), ('superseded','2026-01-03','2026-01-04');
    insert into epr_ncr_capa values ('open','open'),('contained','contained'),('closed','closed'),('rejected','rejected');
  `);
  const registers = await read();
  assert.equal(registers.inspections.length, 500);
  assert.equal(registers.inspections[0].id, '501');
  assert.equal(registers.inspections.at(-1).id, '2');
  assert.equal(registers.ncrs[0].id, 'ncr-1');
  assert.equal(registers.capas[0].id, 'capa-1');
  assert.deepEqual(registers.releases.map(r => r.id), ['current']);
  assert.equal(registers.epr_open, 2);
});
