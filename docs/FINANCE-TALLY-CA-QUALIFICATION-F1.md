# F1 — Tally / CA audit qualification (incremental implementation)

## Delivered in this branch
- Pure read-only trial-balance reconciliation of VYNDI and Tally-normalized records.
- Explicit missing-account and mismatch exceptions; debit/credit net validation.
- Integer-paise comparisons; rejects duplicates, invalid numbers and imprecise monetary values.
- No voucher posting, remote Tally access, automatic statutory submission, or CA certification.
- Contract tests: `node --experimental-strip-types --test scripts/tally-trial-balance-reconciliation.test.mjs`.

- Added read-only voucher-line reconciliation (composite voucher type, reference, date and account code) with amount mismatch and missing-line blockers. Caller must provide normalized exports; this is not a live Tally API connector.
- Voucher tests: `node --test scripts/tally-voucher-reconciliation.test.mjs`.

- Added an offline invoice/period/GSTIN keyed comparison of VYNDI and an externally provided GST register; detects missing invoices, duplicate identities, and mismatched taxable/CGST/SGST/IGST/cess amounts. This does **not** call GSTN, verify GSTR-1/3B/2B returns, or attest correctness of the external evidence.
- GST tests: `node --test scripts/tally-gst-reconciliation.test.mjs`.

- Added a consolidated read-only CA reconciliation summary combining trial balance, voucher and GST reports, explicitly blocking missing inputs and inconsistencies. `review_candidate` is **not** CA sign-off or statutory readiness.
- Dashboard contract tests: `node --test scripts/ca-reconciliation-dashboard.test.mjs`.

## Mandatory gates before production activation
1. Design signed, approved Tally-to-VYNDI chart-of-accounts mappings (never fuzzy match by ledger name).
2. Implement a documented TallyPrime-supported import adapter with strict schema, provenance, period boundaries, checksum and replay handling.
3. Ensure every imported voucher is traceable to immutable source evidence; detect duplicate, missing or altered vouchers.
4. Cross-check voucher totals, opening and closing balances, GST/ITC, bank matching and period snapshots.
5. Review maker/checker permissions, independent CA evidence-pack sign-off, and exception resolution.
6. Add independent integration fixtures, CI gating and real Cloudflare staging acceptance before merging.
7. Keep the finance system source-authoritative; never write back to Tally or post journals from this comparison module.

## Reliance boundary
A matching trial balance is necessary but not sufficient for accounting completeness, GST return reconciliation, Companies Act compliance or a statutory audit opinion. The appointed CA must verify source evidence and approve the final accounts.
