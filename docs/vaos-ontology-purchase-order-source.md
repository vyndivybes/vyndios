# P0.1 signed read: open purchase orders

`PROCUREMENT.OBSERVE_OPEN_POS` is a new explicit **read-only** bridge action, employee context `procurement`, source authority `listOpenPurchaseOrders`. It queries `vyndi_purchase_orders` for draft, pending approval, approved, issued, and partially received POs. Received and cancelled records are excluded from the open set.

The read returns the bounded page and total source-row count from a **single statement** with deterministic ordering. The VYNDI signed bridge verifies the existing P-256 signature and durable nonce before querying. Its content-digest receipt is not a CDC transaction ID or an independently verified source revision. A `complete:true` page is only a complete **scoped** page. If count exceeds 100, the VAOS entrypoint must HOLD (pagination must not be inferred complete).

PO rows include canonical order ID, line SKU, unit, quantity, supplier ID, source reference, job card, record revision and update timestamp for downstream reconciliation. No purchase-order write, approval, supplier payment or autonomous action is commissioned.

Validation: `node --experimental-strip-types --test scripts/vaos-ontology-source-receipt.test.mjs scripts/vaos-read-bridge-contract.test.mjs`.
