# STORE01-INTAKE-01 — Raw Materials & Spare Parts receiving

Status: **source branch candidate; not deployed or commissioned**.

## Scope
Store 01 alone: supplier goods arrival, delivery challan reference, physical count,
supplier invoice metadata, temperature/out-time reference when applicable, and
operator-prepared quarantined goods receipt. Finished bicycle storage and dispatch
remain Store 02 and are explicitly **out of scope**.

## Existing canonical authorities (do not duplicate)
- `/command/purchase-execution`: `vyndi_purchase_orders`, `vyndi_suppliers`
- `/command/receiving`: `vyndi_goods_receipts`, existing identity capture,
  quarantine and accepted FIFO inventory movement
- `/command/payables`: `vyndi_supplier_invoices`, deterministic
  `post_vyndi_supplier_invoice` three-way PO/accepted-GRN/invoice match,
  authorized invoice approval, governed payment
- `/command/inventory`: `master_inventory_items`, FIFO layers, movements
- `vyndi_scan_evidence_attachments`: append-only scan/document evidence on
  a linked PO or GRN. Scanned supplier invoices are supporting documents,
  **not** posted financial truth until the governed payables transaction.

## Implemented source slice
1. Store 01 preflight panel is embedded in the existing receiving workspace.
2. Operator selects an issued PO and enters physical count and verified supplier
   invoice particulars (original invoice number, invoiced quantity, ex-GST
   amount, challan and invoice evidence references).
3. Pure preflight flags missing evidence, unauthorized PO, over-delivery,
   delivery-vs-invoice discrepancy, taxable amount mismatch, and missing
   cold-chain/out-time evidence where the material requires it.
4. Clean preflight can populate only an **unposted quarantined GRN draft**,
   preserving challan, supplier invoice number and supporting references.
5. An authorized operator separately posts GRN through existing DB authority.
   Quality then accepts/rejects material. Only accepted material enters stock.
6. Accounts Payable records the invoice through the existing canonical
   three-way match. Approval and payment continue under existing RBAC,
   segregation-of-duties and source-evidence controls.

The panel is advisory. No new parallel transaction table, synthetic invoice,
inventory quantity, autonomous payment, or robot motion was added.

## Next boundaries
- Ingestion: source-confirmed PDF/image capture, supplier-email correlation,
  human-reviewed OCR/extraction, duplicate detection and retained source file.
- Inbound receiving session: append-only arrival/count evidence and signed
  integrations via existing H5 `vyndi_integration_inbox` / outbox contracts.
- Material put-away: authorized stock status plus bin identity and scanner
  confirmation, leaving the canonical inventory ledger unchanged.
- VAOS interface: safe idempotent proposals referencing canonical PO/GRN IDs;
  no raw SQL writers; proposals alone cannot post, release, pay or move robots.
- Robotics: simulation and fleet adapter first. Physical unloading/transport
  require safety assessment, validated interlocks, telemetry and operator
  authorization; robot safety never depends on an LLM.

## Acceptance criteria
- Missing challan or invoice reference causes a hold.
- Physical count vs invoice and PO open balance discrepancies cause review.
- Temperature-sensitive material without qualified logging evidence causes hold.
- Clear preflight prepares quarantine, never accepted stock.
- Canonical GRN and Payables screens remain the only transaction owners.
- Default release condition: explicit review of tests/build/smoke against exact
  PR SHA. Do **not** merge/deploy on documentation or source existence alone.

## Pilot demonstration
Select an issued PO with 10 open units at ₹100/unit; count 10 units, verify
supplier invoice quantity 10 and taxable ₹1,000. Record challan, invoice number
and source document reference. Preflight is clear; prepare a quarantined GRN
draft. Change physical count to 9 or taxable value to ₹1,100 and confirm the
preflight holds for review. These are hypothetical values, not real stock.
