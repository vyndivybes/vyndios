import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import {readVentureInventoryShadow} from '../src/lib/vaos-venture-inventory-shadow.mjs';

test('A01 real SQL shadow preserves venture-separate quantity and cost without tenant authority',async t=>{
  const db=new PGlite(); await db.waitReady; t.after(()=>db.close());
  await db.exec(`
    CREATE FUNCTION public.vyndi_canonical_unit(x text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
      SELECT CASE lower(btrim(x)) WHEN 'each' THEN 'ea' ELSE lower(btrim(x)) END $$;
    CREATE TABLE public.epr_inventory_ledger(
      venture text,sku text,unit text,quantity_delta numeric,created_at timestamptz DEFAULT now());
    CREATE TABLE public.epr_inventory_cost_ledger(
      venture text,sku text,unit text,value_delta_inr numeric);
    INSERT INTO public.epr_inventory_ledger(venture,sku,unit,quantity_delta) VALUES
      ('v1','SAME','each',10),('v1','SAME','ea',5),
      ('v2','SAME','ea',-3),('v1','QUANTITY_ONLY','ea',2);
    INSERT INTO public.epr_inventory_cost_ledger VALUES
      ('v1','SAME','ea',500),('v2','SAME','ea',-90),
      ('v2','COST_ONLY','ea',80);
  `);
  const sql={query:async(query,params)=>(await db.query(query,params)).rows};
  const result=await readVentureInventoryShadow({sql,limit:100});
  assert.equal(result.sourceCount,4);
  assert.equal(result.ventureCount,2);
  assert.equal(result.unpairedCount,2);
  assert.equal(result.negativeCount,1);
  const locate=(v,sku)=>result.records.find(x=>x.venture===v&&x.sku===sku);
  assert.equal(Number(locate('v1','SAME').quantity_balance),15);
  assert.equal(Number(locate('v1','SAME').inventory_value_inr),500);
  assert.equal(Number(locate('v2','SAME').quantity_balance),-3);
  assert.equal(Number(locate('v2','SAME').inventory_value_inr),-90);
  assert.equal(locate('v1','SAME').unit,'ea');
  assert.equal(locate('v1','QUANTITY_ONLY').value_observed,false);
  assert.equal(locate('v2','COST_ONLY').quantity_observed,false);
  assert.equal(result.availableToPromiseAuthorized,false);
  assert.equal(result.tenantIdentityVerified,false);
  assert.equal(result.status,'HOLD');
  const page=await readVentureInventoryShadow({sql,limit:2});
  assert.equal(page.records.length,2);
  assert.equal(page.hasMore,true);
  assert.equal(page.sourceCompletenessVerified,false);
  assert.ok(page.holdReasons.includes('PAGINATION_REVISION_UNVERIFIED'));
  await db.query(`INSERT INTO public.epr_inventory_ledger(venture,sku,unit,quantity_delta)
                  VALUES('', 'UNKNOWN', 'ea', 1)`);
  const tainted=await readVentureInventoryShadow({sql,limit:100});
  assert.equal(tainted.invalidIdentityCount,1);
  assert.ok(tainted.holdReasons.includes('INVALID_SOURCE_IDENTITY'));
});
