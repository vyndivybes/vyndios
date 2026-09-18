# VYNDI V1 H5 Governed External Integrations — Rev 1

**Production parent:** `4c95097fc87b11141d589606610f4c9da2a4fcf3`  
**Branch:** `feat/h5-governed-integrations`  
**Scope:** accounting, supplier, logistics and commerce integration contracts.

## Objective

H5 creates one governed boundary between VYNDI and external systems without giving any provider a second route to rewrite inventory, finance, procurement, sales, production, engineering or other canonical business truth.

The architecture is:

**canonical authority → outbox → provider**  
**provider → verified inbox → owning canonical authority**

Inbox/outbox records are transport and evidence. They are not a new ERP ledger.

## Contract governance

Every integration is versioned by domain, provider and schema. A contract records direction, authority owner, configuration evidence, signature policy, retry ceiling and a reference to an external secret binding.

Credentials, bearer tokens, webhook secrets and API keys are **not stored in the database contract**.

A new contract starts as `draft`. The preparing Admin cannot approve the same contract. Approval therefore follows the H4 individually authenticated maker/checker model. Once approved, the contract identity/configuration is immutable; a material schema/config change requires a new versioned contract.

## Inbound controls

Inbound events require:

- an approved inbound/bidirectional contract;
- provider event identity;
- schema-specific event type;
- immutable JSON envelope and fingerprint;
- signature-verification result supplied by the provider adapter;
- evidence reference;
- idempotency on `contract + external_event_id`.

When signature verification is required but not proven, the envelope is **quarantined**. Re-sending the same event and payload is recorded as a duplicate and does not create another inbox row. Reusing the same external event ID with different payload is recorded as an **idempotency conflict**.

An inbound envelope becomes `processed` only after an adapter links it to the canonical entity handled by the owning VYNDI authority. H5 does not contain SQL that posts stock, journals, purchase orders or other canonical transactions directly.

## Outbound controls

Outbound events require:

- an approved outbound/bidirectional contract;
- stable idempotency key;
- event type and canonical aggregate identity;
- immutable payload and fingerprint.

The outbox applies bounded delivery retries. Failed events move to `dead_letter` when the contract retry ceiling is reached.

Every delivery attempt is append-only evidence with attempt number, replay cycle, result, HTTP status, response reference and error class.

## Dead-letter replay

Replay is an irreversible operational intervention and follows maker/checker:

1. Admin requests replay with reason/evidence.
2. A different Admin approves.
3. The outbox returns to pending with a new replay cycle.
4. Historical attempts remain immutable.
5. Successful delivery marks the approved replay request executed.

No one-click silent retry can erase prior failure evidence.

## Four governed domains

- **Accounting:** exchange with statutory/accounting tooling while VYNDI finance authority remains canonical for VYNDI records.
- **Supplier:** supplier/RFQ/order/status evidence while procurement/supplier authorities remain canonical.
- **Logistics:** shipment/tracking/fulfilment evidence while dispatch and shipment authorities remain canonical.
- **Commerce:** order/customer/channel evidence while VYNDI sales/order authorities remain canonical.

Provider-specific adapters are implemented against this contract; provider-specific credentials remain platform secret bindings.

## Acceptance criteria

H5 can be called repository-green only when the exact PR head proves:

- fresh migration including `0088_h5_governed_integrations.sql`;
- maker/checker contract approval;
- approved contract immutability;
- inbound signature quarantine;
- inbound duplicate suppression and conflict detection;
- outbound idempotency;
- bounded retries and dead-letter state;
- maker/checker replay and preserved historical attempts;
- append-only integration audit evidence;
- no direct integration SQL writer into canonical inventory/finance/procurement truth;
- aggregate CI, prior hardening gates, typecheck and CodeQL remain green.

After merge, exact-SHA Cloudflare deployment and production smoke remain required for final production certification.
