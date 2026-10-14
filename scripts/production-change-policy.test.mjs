import test from "node:test";
import assert from "node:assert/strict";
import { assertSafeProductionSupersession, assertControlledEcnBom } from "../src/lib/production-change-policy.ts";

const clear = {jobCardStatus:"released",issuedLines:0,consumedReservations:0,progressedTravellers:0,progressedGates:0,progressedEvidence:0,committedPurchaseOrders:0};

test("approved untouched build may enter controlled supersession", () => assert.doesNotThrow(() => assertSafeProductionSupersession(clear)));
test("WIP and completed builds fail closed", () => {
 for (const jobCardStatus of ["in_progress","complete","cancelled"])
  assert.throws(() => assertSafeProductionSupersession({...clear,jobCardStatus}),/WIP/);
});
test("issued FIFO stock and consumed reservations forbid replacement", () => {
 assert.throws(() => assertSafeProductionSupersession({...clear,issuedLines:1}),/issued Job Card/);
 assert.throws(() => assertSafeProductionSupersession({...clear,consumedReservations:1}),/consumed inventory/);
});
test("post-release traveller or gate prevents losing serial/genealogy", () => {
 assert.throws(() => assertSafeProductionSupersession({...clear,progressedTravellers:1}),/serial travellers/);
 assert.throws(() => assertSafeProductionSupersession({...clear,progressedEvidence:1}),/Quality\/EPR/);
});
test("committed supplier orders cannot be silently cancelled", () => assert.throws(() => assertSafeProductionSupersession({...clear,committedPurchaseOrders:1}),/purchase orders/));
test("unchanged BOM needs no new BOM release but does require a governed ECN at service level", () => {
 assert.doesNotThrow(() => assertControlledEcnBom("BOM-R1","BOM-R1",null));
});
test("changed BOM must be explicitly named by released ECN", () => {
 assert.throws(() => assertControlledEcnBom("BOM-R1","BOM-R2",null),/explicitly targeting/);
 assert.doesNotThrow(() => assertControlledEcnBom("BOM-R1","BOM-R2","BOM-R2"));
 assert.throws(() => assertControlledEcnBom("BOM-R1","BOM-R2","BOM-R3"),/does not match/);
});
