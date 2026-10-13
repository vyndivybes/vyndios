import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {dirname,join} from 'node:path';
const root=join(dirname(fileURLToPath(import.meta.url)),'..');
test('procurement bridge uses the same live requirement authority as configured demand',async()=>{
 const source=await readFile(join(root,'src/routes/api/vaos/bridge.ts'),'utf8');
 const block=source.split('if (actionType === "PROCUREMENT.OBSERVE_SHORTAGE") {')[1].split('if (actionType === "INVENTORY.OBSERVE_STOCK")')[0];
 assert.match(block,/from vyndi_live_job_card_requirements/);
 assert.match(block,/required_quantity/);
 assert.match(block,/bom_revision/);
 assert.match(block,/job_card_status in \('released','in_progress'\)/);
 assert.match(block,/sku is not null and shortage_quantity > 0/);
 assert.match(block,/limit \$1/);
 assert.doesNotMatch(block,/from epr_production_job_card_lines/);
});
