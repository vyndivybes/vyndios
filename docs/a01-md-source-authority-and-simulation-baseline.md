# A01 Managing Director source-of-record decision and simulation baseline

**Recorded:** 20 November 2026 (Asia/Kolkata). **Decision owner:** Vāyú Shastr Pvt Ltd Managing Director.
**Issue evidence:** GitHub VYNDI #153 and VAOS #312, founder declaration recorded in conversation.

## Governance decisions
- One declared legal owner: **Vāyú Shastr Pvt Ltd**.
- **VYNDI OS is an internal product/platform of Vāyú Shastr Pvt Ltd**, not a separate legal company.
- VYNDI OS is approved as the **business source-of-record** for engineering/BOM, production/MES, purchasing, raw materials, finished goods, sales/CRM and its governed finance ledgers. VAOS/JARVIS is an orchestrator, analytic consumer and gated execution coordinator; it does not replace the business ledger.
- The Managing Director asserts **all existing historical VYNDI OS transactions were created for simulation/testing**, not actual stock, customers, suppliers, purchase obligations or turnover. Preserve their history as test evidence.
- Internal `venture` identifiers remain **category labels**, not authenticated legal company or principal IDs.
- This declaration is **business policy approval**, not independent identity-provider verification or cryptographic proof of source contents.

## Baseline-only snapshot
The eight first-priority audited tables contained **119 rows** at independent live readback (sales orders 5, purchase orders 48, production job cards 4, lines 56, reservations 1, inventory quantity moves 2, inventory cost moves 2, travellers 1).

The signed diagnostic now compares these counts to the bounded snapshot. **Even matching counts do not prove record identity**, so neither test-record classification nor future live-record provenance is considered individually verified. A mismatch adds `SIMULATION_DECLARATION_COHORT_DRIFT`.

Do **not** delete, rewrite, backdate or backfill these records automatically; avoid falsely treating historic simulation POs or negative stock as real financial and physical exceptions. Real business reports must separately quarantine them by verified record ID and provenance, not only timestamp or aggregate count.

## Required technical closure, still HOLD
1. Create an independently checked, immutable **record-ID simulation classification register** in an access-controlled schema; prove all 119 audited rows were captured and extend the reconciliation to other historical datasets. Preserve audit trail and append-only dispositions.
2. Establish a source-of-record execution boundary for **future actual records**: authenticated company ID, maker/checker approvals, source revisions, expiry and per-source test vs real classification. New records may NOT inherit legacy simulation status by date or count.
3. Qualify least-privilege runtime DB role, row-level restrictions, and bind Managing Director authorization to a verified existing identity. Do not assume a chat declaration is proof of current authentication.
4. Certify live source-to-VAOS data extracts with stable business revisions, complete pagination and independently checked data.
5. Keep inventory ATP, PO approval/execution and physical stock/finance mutations blocked until independent commissioning.

**Current status:** policy **MD_APPROVED**, existing data **SIMULATION_ONLY_DECLARED**, source-content authority **SOURCE_UNVERIFIED**, live business writes **NOT_AUTHORIZED**.
