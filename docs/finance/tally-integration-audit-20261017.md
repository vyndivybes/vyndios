# Tally integration audit — 17 October 2026

Scope: PR #81, the receivable/payable reporting path, posting admission, reversal authority and their relevant controls. This is a repository and isolated-runtime audit, not a statutory audit or certification of full TallyPrime parity. The broader acceptance contract remains `tallyprime-parity-programme.md`.

## Corrected findings

| Finding | Severity | Correction and evidence |
|---|---|---|
| Voucher date parsing accepted impossible dates; raw account comparison permitted accounts equal after trimming | High | Strict Gregorian date validation and normalized account comparison; reproduced by failing regressions before correction |
| JS and SQL journal admission allowed a one-paise difference; unsafe JS totals and negative/clamped SQL values could pass | Critical | Exact integer-paise admission in JS and migration 0194; invalid amount and imbalance regressions |
| Reusing an existing journal source could silently return a journal with different content | High | Source lock plus exact replay-content checks in 0194; conflicting retry rejected without partial records |
| Existing posted journals accepted later line INSERTs; balance was not enforced on commit | Critical | Reproduced in isolated migrated database. Migration 0196 rejects later INSERTs and invalid posted journals at commit; database regressions verify rejection/rollback and valid operational posting |
| Receivable GET and mutations checked global permission without route scope; collection makers could reverse their own receipt | High | Route permission checks, approval requirement for reversals/voids, independent finance/admin database checks in 0195; handler and real-database negative tests |
| A credited invoice could be voided again after cash consequences were removed | High | Active customer credit notes block invoice void in 0195 |
| Current receivable KPI/register/collection selector ignored credit notes/refunds | High | Reuse canonical sales-ledger balance/refund values rather than a second gross-minus-collections calculation |
| No database-backed historical receivable report; negative customer credits and missing due dates needed explicit treatment | High | Single-snapshot adapter, dated reversals, separate credits, unaged legacy list and signed GL comparison; isolated database and calculation tests |

## Remaining work and release gates

| Priority | Remaining item | Concrete evidence / consequence | Required next action |
|---|---|---|---|
| P1 | Cash/collection amount precision | `vyndi_collections.amount_lakh` and canonical `vyndi_monthly_actuals.closing_cash` are `numeric(18,4)`. One storage unit is ₹10. Collection input also has a ₹0.01-lakh step, so current operations cannot reliably settle arbitrary paise balances. Read-only report precision does not repair storage. | Introduce/rehearse authoritative INR-paise storage and reconcile cash bridge, reversals, actual revisions, idempotency and bank close controls end to end. Do not enable paise-sensitive live collection workflows on the current storage contract. |
| P1 | Per-invoice concurrent allocation admission | Source inspection of the existing `post_vyndi_collection` shows a lock keyed by collection ID and an unlocked invoice/open-balance read. Different receipt IDs can therefore race on one bill. Credit-note admission likewise needs shared bill-level serialization. This is a source-based concurrency finding, not a claimed multi-session PostgreSQL reproduction. | Coordinate bill-level locks across collections, notes, refunds, voids and reversals, then prove concurrent over-allocation, duplicate-evidence, void/post and retry races in real PostgreSQL. The existing one-statement reporting snapshot detects inconsistent data but cannot prevent racing writes. |
| P1 | Live PostgreSQL migration and concurrency qualification | New triggers use PostgreSQL transaction IDs and deferred constraints. Isolated PGlite tests do not prove behavior/performance on the deployed PostgreSQL version, role grants or existing external writers. No local PostgreSQL/container command was available on PATH during this audit. | Rehearse 0194–0196 against a controlled staging copy, including historical corruption scan, atomic writers, source retry races, close/post races, backup/restore and rollback/cutover evidence. |
| P1 | Authenticated application and built-browser acceptance | Component interaction evidence is separate from a signed-in founder/accountant journey through the full application. Browser connection/viewport control was intermittent. | Run authenticated desktop/mobile journeys against the exact production-like build; verify both reports, errors, mutations, permission denials and browser console. |
| P1 | Legacy terms and party identity | Report explicitly marks invoices without evidenced terms unaged. Customer rows provide order/spare-sale references rather than a durable customer-master key. | Govern legacy terms and customer mapping with evidence and approval; add party-wide bill allocation/advances only on canonical identities. Never manufacture historical due dates. |
| P1 | Accountant acceptance and tax/portal qualification | No accountant-signed fixtures or government/bank sandbox acceptance were supplied/executed. | Validate GST/TDS/TCS, credit/debit notes, returns, reports, opening balances, inventory/COGS and portal exports under approved rules before live enablement. |
| P2 | Production scale and reporting completeness | Single-statement snapshots intentionally avoid silent limits but load complete source/journal history. Account codes outside the current application chart fail closed. Backdated entries can change old accounting-date reports. | Benchmark production-sized history and approved chart extensions; preserve complete snapshots while adding bounded transport/query strategies and evidence/version semantics. |

## Coverage boundaries

Local evidence covers calculations, real isolated migrations and transaction functions, permission admission, independent reversal, immutable audit behavior, exact posting, replay conflicts, report snapshots, and app compilation. The full suite also exercises existing hard-close, stocktake, supplier cash and recovery controls.

Synthetic browser checks exercise the production report component with an injected test transport. They do not change production records and are not evidence of live financial acceptance. Every final test/build/CI result must be tied to the final PR head in the accompanying verification record; this document does not promote a queued or skipped CI job.

No merge, deployment, live migration, production-data alteration, statutory filing or money transfer is authorized by this audit. Reporting work and corrected code can be tested while overall release qualification remains UNVERIFIED. Complete TallyPrime parity is not established.
